// Sends requisition notification emails via Resend.
// Called by Postgres triggers (see supabase/migrations/*_requisition_email_notifications.sql)
// through pg_net, not by the frontend — authenticated by a shared secret
// (x-webhook-secret header) rather than a Supabase JWT, since Postgres has
// no user session to attach one from. That's also why verify_jwt is off
// for this function.
import { createClient } from "jsr:@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET");
// Resend's shared test sender — works with no domain setup, but real
// deliverability (and sending to arbitrary recipients without it landing in
// spam) needs a verified sending domain. Set NOTIFY_FROM_EMAIL once one's
// ready (e.g. "Growth Space Admin <notifications@yourdomain.ac.uk>").
const FROM_EMAIL = Deno.env.get("NOTIFY_FROM_EMAIL") || "Growth Space Admin <onboarding@resend.dev>";
// Optional: link back into the app from the email body.
const APP_URL = Deno.env.get("APP_URL") || "";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const UNIT_TYPE_LABEL: Record<string, string> = { cabinet: "Growth Cabinet", reftech: "Reftech Room" };

async function sendEmail(to: string[], subject: string, html: string) {
  if (!RESEND_API_KEY) {
    console.error("RESEND_API_KEY is not set — email not sent. Subject:", subject);
    return;
  }
  if (to.length === 0) {
    console.error("No recipients — email not sent. Subject:", subject);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
  });
  if (!res.ok) {
    console.error("Resend API error", res.status, await res.text());
  }
}

Deno.serve(async (req) => {
  if (req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET) {
    return new Response("unauthorized", { status: 401 });
  }

  let body: { type?: string; requisitionId?: string };
  try {
    body = await req.json();
  } catch {
    return new Response("invalid json", { status: 400 });
  }
  const { type, requisitionId } = body;
  if (!type || !requisitionId) {
    return new Response("missing type or requisitionId", { status: 400 });
  }

  const { data: req_, error } = await supabase
    .from("requisitions")
    .select("*, unit:units!assigned_unit_id(id, floor, room, type)")
    .eq("id", requisitionId)
    .single();
  if (error || !req_) {
    console.error("requisition lookup failed", error);
    return new Response("requisition not found", { status: 404 });
  }

  const dateRange = `${req_.start_date} to ${req_.end_date}`;
  const unitTypeLabel = UNIT_TYPE_LABEL[req_.unit_type] || req_.unit_type;

  if (type === "new_requisition") {
    const { data: admins, error: adminErr } = await supabase
      .from("profiles")
      .select("id")
      .eq("role", "admin");
    if (adminErr) {
      console.error("admin lookup failed", adminErr);
      return new Response("admin lookup failed", { status: 500 });
    }
    const emails: string[] = [];
    for (const admin of admins ?? []) {
      const { data } = await supabase.auth.admin.getUserById(admin.id);
      if (data?.user?.email) emails.push(data.user.email);
    }

    await sendEmail(
      emails,
      `New requisition: ${req_.project_title}`,
      `<p><strong>${req_.researcher_name}</strong> submitted a new ${unitTypeLabel} requisition awaiting review.</p>
       <p><strong>Project:</strong> ${req_.project_title}<br/>
       <strong>Requested dates:</strong> ${dateRange}</p>
       ${APP_URL ? `<p><a href="${APP_URL}">Review it in Growth Space Admin</a></p>` : ""}`,
    );
  } else if (type === "requisition_assigned") {
    const unit = req_.unit as { id: string; room: string; type: string } | null;
    await sendEmail(
      [req_.email],
      `Your space request has been approved — ${req_.project_title}`,
      `<p>Hi ${req_.researcher_name},</p>
       <p>Your requisition <strong>${req_.project_title}</strong> has been approved and assigned to
       <strong>${unit?.id ?? "a unit"}</strong>${unit ? ` (${UNIT_TYPE_LABEL[unit.type] || unit.type}, ${unit.room})` : ""}.</p>
       <p><strong>Dates:</strong> ${dateRange}</p>`,
    );
  } else {
    return new Response("unknown type", { status: 400 });
  }

  return new Response("ok", { status: 200 });
});
