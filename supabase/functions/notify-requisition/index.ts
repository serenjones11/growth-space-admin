// Sends requisition notification emails via Resend.
// Called by Postgres triggers (see supabase/migrations/*_requisition_email_notifications.sql)
// through pg_net, not by the frontend - authenticated by a shared secret
// (x-webhook-secret header) rather than a Supabase JWT, since Postgres has
// no user session to attach one from. That's also why verify_jwt is off
// for this function.
import { createClient } from "jsr:@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET");
// Resend's shared test sender - works with no domain setup, but real
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
const FLOOR_LABEL: Record<string, string> = { LG: "LG", L1: "Level 1", L2A: "Level 2a", L2B: "Level 2b", L3: "Level 3" };

// Same palette as the app's TOKENS (src/App.jsx) - kept as plain hex here
// since CSS custom properties aren't reliable in email clients. `occupied`
// is the same blue the app uses for an "Ongoing/Approved" status pill.
const COLOR = {
  ink: "#16211D", inkSoft: "#5C6D65", inkFaint: "#93A29B",
  surface: "#FFFFFF", surfaceSoft: "#F1F5F3", border: "#E3E8E5",
  accent: "#009E73", accentDark: "#007A5A", accentSoft: "#E1F7F0", accentInk: "#053D2C",
  warning: "#C97A2B", warningSoft: "#FBEDDD",
  occupied: "#3B6EA5", occupiedSoft: "#E4EDF6", occupiedInk: "#1D3A57",
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

// Shared card shell for all the notification emails - mirrors the app's own
// visual language (Plus Jakarta Sans display type, soft pill badges/status
// colors, muted uppercase field labels). Built with inline styles and a
// table layout throughout for compatibility with Outlook/older email
// clients, which don't support Flexbox/Grid or CSS custom properties.
function emailCard(opts: {
  topBarColor: string;
  eyebrowText: string; eyebrowBg: string; eyebrowColor: string;
  title: string; code?: string | null;
  metaHtml?: string; badgesHtml?: string;
  bodyHtml: string;
}): string {
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLOR.surfaceSoft};padding:32px 16px;font-family:${FONT_STACK};">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:${COLOR.surface};border-radius:16px;border:1px solid ${COLOR.border};overflow:hidden;">
        <tr><td style="height:4px;background:${opts.topBarColor};line-height:4px;font-size:0;">&nbsp;</td></tr>

        <tr><td style="padding:28px 28px 20px 28px;">
          <span style="display:inline-block;padding:4px 10px;border-radius:999px;font-size:11px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;background:${opts.eyebrowBg};color:${opts.eyebrowColor};">${esc(opts.eyebrowText)}</span>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;">
            <tr>
              <td style="font-family:${FONT_STACK};font-size:20px;font-weight:800;color:${COLOR.ink};line-height:1.3;">${esc(opts.title)}</td>
              ${opts.code ? `<td align="right" style="white-space:nowrap;vertical-align:top;"><span style="display:inline-block;padding:3px 8px;border-radius:6px;font-family:'IBM Plex Mono',monospace;font-size:11px;font-weight:700;background:${COLOR.surfaceSoft};color:${COLOR.inkFaint};">${esc(opts.code)}</span></td>` : ""}
            </tr>
          </table>
          ${opts.metaHtml ? `<div style="margin-top:6px;font-size:13px;color:${COLOR.inkSoft};">${opts.metaHtml}</div>` : ""}
          ${opts.badgesHtml ? `<div style="margin-top:14px;">${opts.badgesHtml}</div>` : ""}
        </td></tr>

        <tr><td style="padding:0 28px;"><div style="border-top:1px solid ${COLOR.border};font-size:0;line-height:0;">&nbsp;</div></td></tr>

        <tr><td style="padding:20px 28px 28px 28px;">${opts.bodyHtml}</td></tr>
      </table>
      <div style="max-width:560px;margin:16px auto 0 auto;font-size:11px;color:${COLOR.inkFaint};text-align:center;font-family:${FONT_STACK};">Growth Space Admin &middot; automated notification</div>
    </td></tr>
  </table>`;
}

function ctaButton(): string {
  if (!APP_URL) return "";
  return `<div style="margin-top:22px;"><a href="${APP_URL}" style="display:inline-block;padding:11px 20px;border-radius:10px;background:${COLOR.accentDark};color:#FFFFFF;font-family:${FONT_STACK};font-size:14px;font-weight:700;text-decoration:none;">Open in Growth Space Admin →</a></div>`;
}

// Admin-facing "a new requisition came in" preview - the full picture, so
// an admin can review and decide without switching to the app first.
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
    detailRow("Dawn / dusk", esc([r.dawn_time ? `Dawn ${String(r.dawn_time).slice(0, 5)}` : null, r.dusk_time ? `Dusk ${String(r.dusk_time).slice(0, 5)}` : null].filter(Boolean).join(" / "))),
  ].join("");

  const bodyHtml = `
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

    ${ctaButton()}`;

  return emailCard({
    topBarColor: COLOR.accent,
    eyebrowText: "New requisition", eyebrowBg: COLOR.accentSoft, eyebrowColor: COLOR.accentInk,
    title: r.project_title, code: r.code,
    metaHtml: `${esc(r.researcher_name)}${r.pi_name ? ` &middot; PI: ${esc(r.pi_name)}` : ""}${r.role ? ` &middot; ${esc(r.role)}` : ""}`,
    badgesHtml: `${pill(unitTypeLabel, COLOR.surfaceSoft, COLOR.ink)}${pill(disciplineLabel, COLOR.surfaceSoft, COLOR.ink)}`,
    bodyHtml,
  });
}

// Requester-facing "you've been assigned a space" preview. Deliberately
// slim - just what changes for the requester (dates, code, the assigned
// unit and its location) rather than the full admin picture above. Reads
// straight from the live requisitions row, so it always reflects the
// requisition's current, possibly admin-edited values - never a stale
// snapshot of what the requester originally submitted (see the trigger in
// 20260908120000_requisition_assigned_email_on_edit.sql, which re-fires
// this email if an admin edits the dates or unit after the fact too).
function renderAssignedPreview(r: Record<string, any>, unit: { id: string; floor: string; room: string; type: string } | null, unitTypeLabel: string, dateRange: string): string {
  const floorLabel = unit ? (FLOOR_LABEL[unit.floor] || unit.floor) : "";

  const bodyHtml = `
    <div style="padding:16px 18px;border-radius:12px;background:${COLOR.occupiedSoft};margin-bottom:18px;">
      <div style="font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:${COLOR.occupiedInk};margin-bottom:4px;">Assigned to</div>
      <div style="font-family:${FONT_STACK};font-size:22px;font-weight:800;color:${COLOR.ink};">${esc(unit?.id ?? "-")}</div>
      <div style="font-size:13px;color:${COLOR.inkSoft};margin-top:2px;">${esc(unitTypeLabel)}${unit ? ` &middot; ${esc(floorLabel)}, ${esc(unit.room)}` : ""}</div>
    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
      ${detailRow("Requested dates", esc(dateRange))}
    </table>
    ${ctaButton()}`;

  return emailCard({
    topBarColor: COLOR.occupied,
    eyebrowText: "Approved", eyebrowBg: COLOR.occupiedSoft, eyebrowColor: COLOR.occupiedInk,
    title: r.project_title, code: r.code,
    metaHtml: `Hi ${esc(r.researcher_name)}, your space request has been approved.`,
    bodyHtml,
  });
}

// Admin-facing "this requisition ends in ~2 weeks" heads-up, queued daily by
// send_end_date_reminders() (pg_cron, see
// 20260922145308_end_date_reminder_emails.sql). Gives an admin what they
// need to chase it up: which unit frees up, when, and who to contact.
function renderEndDateReminder(r: Record<string, any>, unit: { id: string; floor: string; room: string; type: string } | null, unitTypeLabel: string, dateRange: string): string {
  const floorLabel = unit ? (FLOOR_LABEL[unit.floor] || unit.floor) : "";
  const daysLeft = daysUntil(r.end_date);
  const endsIn = daysLeft === 0 ? "today" : daysLeft === 1 ? "tomorrow" : `in ${daysLeft} days`;

  const bodyHtml = `
    <div style="padding:16px 18px;border-radius:12px;background:${COLOR.warningSoft};margin-bottom:18px;">
      <div style="font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:${COLOR.warning};margin-bottom:4px;">Ends ${esc(endsIn)}</div>
      <div style="font-family:${FONT_STACK};font-size:22px;font-weight:800;color:${COLOR.ink};">${esc(r.end_date)}</div>
      <div style="font-size:13px;color:${COLOR.inkSoft};margin-top:2px;">${esc(unit?.id ?? "No unit assigned")}${unit ? ` &middot; ${esc(unitTypeLabel)} &middot; ${esc(floorLabel)}, ${esc(unit.room)}` : ""}</div>
    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
      ${detailRow("Booked dates", esc(dateRange))}
      ${detailRow("Researcher", esc(r.researcher_name))}
      ${detailRow("Contact", r.email ? `<a href="mailto:${esc(r.email)}" style="color:${COLOR.accentDark};">${esc(r.email)}</a>` : "")}
      ${detailRow("PI", esc(r.pi_name))}
    </table>
    ${ctaButton()}`;

  return emailCard({
    topBarColor: COLOR.warning,
    eyebrowText: "Ending soon", eyebrowBg: COLOR.warningSoft, eyebrowColor: COLOR.warning,
    title: r.project_title, code: r.code,
    metaHtml: `${esc(r.researcher_name)}${r.pi_name ? ` &middot; PI: ${esc(r.pi_name)}` : ""}`,
    bodyHtml,
  });
}

// Whole days from today (UTC, matching the cron job's current_date) to a
// yyyy-mm-dd date.
function daysUntil(isoDate: string): number {
  const today = new Date(new Date().toISOString().slice(0, 10));
  return Math.round((new Date(isoDate).getTime() - today.getTime()) / 86_400_000);
}

// Admin recipients for an admin-facing email, honouring each admin's
// notification_preferences row. A missing row means the defaults (every
// email, every discipline) - see 20260922145959_notification_preferences.sql.
async function adminRecipients(pref: "notify_new_requisition" | "notify_end_date_reminder", discipline: string): Promise<string[]> {
  const { data: admins, error } = await supabase
    .from("profiles")
    .select("id, prefs:notification_preferences(notify_new_requisition, notify_end_date_reminder, discipline_scope)")
    .eq("role", "admin");
  if (error) throw error;

  const emails: string[] = [];
  for (const admin of admins ?? []) {
    const prefs = Array.isArray(admin.prefs) ? admin.prefs[0] : admin.prefs;
    if (prefs && prefs[pref] === false) continue;
    if (prefs && prefs.discipline_scope !== "all" && prefs.discipline_scope !== discipline) continue;
    const { data } = await supabase.auth.admin.getUserById(admin.id);
    if (data?.user?.email) emails.push(data.user.email);
  }
  return emails;
}

async function sendEmail(to: string[], subject: string, html: string) {
  if (!RESEND_API_KEY) {
    console.error("RESEND_API_KEY is not set - email not sent. Subject:", subject);
    return;
  }
  if (to.length === 0) {
    console.error("No recipients - email not sent. Subject:", subject);
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

  const unit = req_.unit as { id: string; floor: string; room: string; type: string } | null;
  const assignedUnitTypeLabel = unit ? (UNIT_TYPE_LABEL[unit.type] || unit.type) : unitTypeLabel;

  if (type === "new_requisition" || type === "end_date_reminder") {
    let emails: string[];
    try {
      emails = await adminRecipients(
        type === "new_requisition" ? "notify_new_requisition" : "notify_end_date_reminder",
        req_.discipline,
      );
    } catch (adminErr) {
      console.error("admin lookup failed", adminErr);
      return new Response("admin lookup failed", { status: 500 });
    }

    if (type === "new_requisition") {
      await sendEmail(
        emails,
        `New requisition: ${req_.project_title}`,
        renderRequisitionPreview(req_, unitTypeLabel, dateRange),
      );
    } else {
      await sendEmail(
        emails,
        `Ending soon: ${req_.project_title}${unit ? ` (${unit.id})` : ""} - ends ${req_.end_date}`,
        renderEndDateReminder(req_, unit, assignedUnitTypeLabel, dateRange),
      );
    }
  } else if (type === "requisition_assigned") {
    await sendEmail(
      [req_.email],
      `Your space request has been approved - ${req_.project_title}`,
      renderAssignedPreview(req_, unit, assignedUnitTypeLabel, dateRange),
    );
  } else {
    return new Response("unknown type", { status: 400 });
  }

  return new Response("ok", { status: 200 });
});
