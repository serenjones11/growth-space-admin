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
const DISCIPLINE_LABEL: Record<string, string> = { plant: "Plant Sciences", insect: "Insect Sciences" };

// Same palette as the app's TOKENS (src/App.jsx) — kept as plain hex here
// since CSS custom properties aren't reliable in email clients.
const COLOR = {
  ink: "#16211D", inkSoft: "#5C6D65", inkFaint: "#93A29B",
  surface: "#FFFFFF", surfaceSoft: "#F1F5F3", border: "#E3E8E5",
  accent: "#009E73", accentDark: "#007A5A", accentSoft: "#E1F7F0", accentInk: "#053D2C",
  warning: "#C97A2B", warningSoft: "#FBEDDD",
};
const FONT_STACK = "'Plus Jakarta Sans','Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif";

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string
  ));
}

function pill(text: string, bg: string, color: string): string {
  return `<span style="display:inline-block;padding:4px 10px;border-radius:999px;font-size:12px;font-weight:700;background:${bg};color:${color};margin:0 6px 6px 0;">${esc(text)}</span>`;
}

function detailRow(label: string, value: string): string {
  if (!value) return "";
  return `
    <tr>
      <td style="padding:6px 0;font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:${COLOR.inkFaint};width:150px;vertical-align:top;">${esc(label)}</td>
      <td style="padding:6px 0;font-size:14px;color:${COLOR.ink};font-weight:600;">${value}</td>
    </tr>`;
}

// A clean, modern card mirroring the app's own visual language (Plus
// Jakarta Sans display type, the warm-green accent, soft pill badges,
// muted uppercase field labels) — built with inline styles and a table
// layout throughout for compatibility with Outlook/older email clients,
// which don't support Flexbox/Grid or CSS custom properties.
function renderRequisitionPreview(r: Record<string, any>, unitTypeLabel: string, dateRange: string): string {
  const disciplineLabel = DISCIPLINE_LABEL[r.discipline] || r.discipline;
  const speciesHtml = (r.species && r.species.length)
    ? r.species.map((s: string) => pill(s, COLOR.accentSoft, COLOR.accentInk)).join("")
    : `<span style="font-size:13px;color:${COLOR.inkFaint};">None specified</span>`;

  const envParts = [
    r.set_temp != null ? `${r.set_temp}°C` : null,
    r.set_humidity != null ? `${r.set_humidity}% RH` : null,
  ].filter(Boolean).join(" / ");

  const flags = [
    r.pest_consent ? "Pest management consent given" : null,
    r.dimming_required ? "Corridor dimming required" : null,
    r.safety_compliance ? "Safety compliance confirmed" : null,
  ].filter(Boolean) as string[];

  const detailRows = [
    detailRow("Requested dates", esc(dateRange)),
    detailRow("Preferred floor", r.preferred_floor && r.preferred_floor !== "any" ? esc(r.preferred_floor) : "No preference"),
    detailRow("Containment level", esc(r.containment_level)),
    detailRow("Set temp / humidity", esc(envParts)),
    detailRow("Light cycle", esc(r.light_cycle)),
  ].join("");

  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLOR.surfaceSoft};padding:32px 16px;font-family:${FONT_STACK};">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:${COLOR.surface};border-radius:16px;border:1px solid ${COLOR.border};overflow:hidden;">
        <tr><td style="height:4px;background:${COLOR.accent};line-height:4px;font-size:0;">&nbsp;</td></tr>

        <tr><td style="padding:28px 28px 20px 28px;">
          <span style="display:inline-block;padding:4px 10px;border-radius:999px;font-size:11px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;background:${COLOR.accentSoft};color:${COLOR.accentInk};">New requisition</span>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;">
            <tr>
              <td style="font-family:${FONT_STACK};font-size:20px;font-weight:800;color:${COLOR.ink};line-height:1.3;">${esc(r.project_title)}</td>
              ${r.code ? `<td align="right" style="white-space:nowrap;vertical-align:top;"><span style="display:inline-block;padding:3px 8px;border-radius:6px;font-family:'IBM Plex Mono',monospace;font-size:11px;font-weight:700;background:${COLOR.surfaceSoft};color:${COLOR.inkFaint};">${esc(r.code)}</span></td>` : ""}
            </tr>
          </table>
          <div style="margin-top:6px;font-size:13px;color:${COLOR.inkSoft};">
            ${esc(r.researcher_name)}${r.pi_name ? ` &middot; PI: ${esc(r.pi_name)}` : ""}${r.role ? ` &middot; ${esc(r.role)}` : ""}
          </div>
          <div style="margin-top:14px;">
            ${pill(unitTypeLabel, COLOR.surfaceSoft, COLOR.ink)}
            ${pill(disciplineLabel, COLOR.surfaceSoft, COLOR.ink)}
          </div>
        </td></tr>

        <tr><td style="padding:0 28px;"><div style="border-top:1px solid ${COLOR.border};font-size:0;line-height:0;">&nbsp;</div></td></tr>

        <tr><td style="padding:20px 28px 28px 28px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${detailRows}</table>

          <div style="margin-top:14px;">
            <div style="font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:${COLOR.inkFaint};margin-bottom:6px;">Species</div>
            ${speciesHtml}
          </div>

          ${r.space_description ? `
          <div style="margin-top:16px;">
            <div style="font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:${COLOR.inkFaint};margin-bottom:4px;">Space requirements</div>
            <div style="font-size:13.5px;color:${COLOR.ink};line-height:1.5;">${esc(r.space_description)}</div>
          </div>` : ""}

          ${flags.length ? `
          <div style="margin-top:16px;">
            ${flags.map((f) => `<div style="font-size:13.5px;color:${COLOR.ink};padding:2px 0;">✓&nbsp;&nbsp;${esc(f)}</div>`).join("")}
          </div>` : ""}

          ${r.hazard_notes ? `
          <div style="margin-top:16px;padding:12px 14px;border-radius:10px;background:${COLOR.warningSoft};">
            <div style="font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:${COLOR.warning};margin-bottom:4px;">Hazard notes</div>
            <div style="font-size:13.5px;color:${COLOR.ink};line-height:1.5;">${esc(r.hazard_notes)}</div>
          </div>` : ""}

          ${r.notes ? `
          <div style="margin-top:16px;">
            <div style="font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:${COLOR.inkFaint};margin-bottom:4px;">Notes</div>
            <div style="font-size:13.5px;color:${COLOR.ink};line-height:1.5;">${esc(r.notes)}</div>
          </div>` : ""}

          ${APP_URL ? `
          <div style="margin-top:22px;">
            <a href="${APP_URL}" style="display:inline-block;padding:11px 20px;border-radius:10px;background:${COLOR.accentDark};color:#FFFFFF;font-family:${FONT_STACK};font-size:14px;font-weight:700;text-decoration:none;">Review in Growth Space Admin →</a>
          </div>` : ""}
        </td></tr>
      </table>
      <div style="max-width:560px;margin:16px auto 0 auto;font-size:11px;color:${COLOR.inkFaint};text-align:center;font-family:${FONT_STACK};">Growth Space Admin &middot; automated notification</div>
    </td></tr>
  </table>`;
}

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
      renderRequisitionPreview(req_, unitTypeLabel, dateRange),
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
