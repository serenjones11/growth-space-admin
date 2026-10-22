// User management for the Settings page: list, add, change role, reset
// password, remove. Creating and deleting logins needs the service-role key,
// which must never reach the browser - so the app calls this function with
// the signed-in user's own JWT, and this checks who they are first:
//   - any admin or owner may list users;
//   - only owners may change anything.
// Roles: 'owner' (everything, plus managing users) and 'admin' (shown as
// "User" in the app: everything except managing users).
import { createClient } from "jsr:@supabase/supabase-js@2";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const STAFF_ROLES = ["admin", "owner"];
const MIN_PASSWORD = 10;

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
// Errors the person using the Settings page should see, worded for them.
class UserError extends Error {}

function checkPassword(password: unknown): string {
  if (typeof password !== "string" || password.length < MIN_PASSWORD) {
    throw new UserError(`Passwords need at least ${MIN_PASSWORD} characters.`);
  }
  return password;
}
function checkRole(role: unknown): "admin" | "owner" {
  if (role !== "admin" && role !== "owner") throw new UserError("Unknown role.");
  return role;
}

async function listUsers() {
  const { data: profiles, error } = await admin
    .from("profiles").select("id, full_name, role, created_at").in("role", STAFF_ROLES).order("full_name");
  if (error) throw error;
  const users = [];
  for (const p of profiles ?? []) {
    const { data } = await admin.auth.admin.getUserById(p.id);
    users.push({
      id: p.id, fullName: p.full_name || "", role: p.role, createdAt: p.created_at,
      email: data?.user?.email || "", lastSignInAt: data?.user?.last_sign_in_at || null,
    });
  }
  return users;
}

async function ownerCount() {
  const { count, error } = await admin.from("profiles").select("id", { count: "exact", head: true }).eq("role", "owner");
  if (error) throw error;
  return count ?? 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);

  try {
    // Who's asking? (verify_jwt already rejected requests without a valid
    // token; this resolves it to a user and their role.)
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: who, error: whoError } = await admin.auth.getUser(token);
    if (whoError || !who?.user) return reply({ error: "Please sign in again." }, 401);
    const callerId = who.user.id;
    const { data: callerProfile } = await admin.from("profiles").select("role").eq("id", callerId).single();
    const callerRole = callerProfile?.role;
    if (!STAFF_ROLES.includes(callerRole)) return reply({ error: "You don't have access to this." }, 403);

    const body = await req.json().catch(() => ({}));
    const action = body.action;

    if (action === "list") return reply({ users: await listUsers() });

    if (callerRole !== "owner") return reply({ error: "Only owners can add, change or remove users." }, 403);

    if (action === "create") {
      const email = String(body.email || "").trim().toLowerCase();
      const fullName = String(body.fullName || "").trim();
      const role = checkRole(body.role);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new UserError("Enter a valid email address.");
      if (!fullName) throw new UserError("Enter the person's name.");
      const password = checkPassword(body.password);

      const { data: created, error } = await admin.auth.admin.createUser({
        email, password, email_confirm: true, user_metadata: { full_name: fullName },
      });
      if (error) {
        if (/already|registered|exists/i.test(error.message)) throw new UserError("Someone with that email already has an account.");
        throw error;
      }
      // handle_new_user() has created their profile as 'researcher'.
      const { error: profileError } = await admin.from("profiles")
        .update({ role, full_name: fullName }).eq("id", created.user.id);
      if (profileError) {
        await admin.auth.admin.deleteUser(created.user.id); // don't leave a half-made account
        throw profileError;
      }
      return reply({ users: await listUsers() });
    }

    const userId = String(body.userId || "");
    const { data: target } = await admin.from("profiles").select("id, role").eq("id", userId).single();
    if (!target || !STAFF_ROLES.includes(target.role)) throw new UserError("That user wasn't found.");

    if (action === "setRole") {
      const role = checkRole(body.role);
      if (userId === callerId) throw new UserError("You can't change your own role - ask another owner.");
      const { error } = await admin.from("profiles").update({ role }).eq("id", userId);
      if (error) throw error;
      return reply({ users: await listUsers() });
    }

    if (action === "resetPassword") {
      const password = checkPassword(body.password);
      const { error } = await admin.auth.admin.updateUserById(userId, { password });
      if (error) throw error;
      return reply({ users: await listUsers() });
    }

    if (action === "remove") {
      if (userId === callerId) throw new UserError("You can't remove yourself - ask another owner.");
      if (target.role === "owner" && (await ownerCount()) <= 1) throw new UserError("There must always be at least one owner.");
      // Their past decisions and log entries stay, just without their name
      // (the same as ON DELETE SET NULL on these columns).
      for (const [table, column] of [
        ["requisitions", "decided_by"], ["requisitions", "completed_by"], ["requisitions", "researcher_id"],
        ["service_log", "created_by"], ["documents", "added_by"], ["backup_log", "created_by"],
      ]) {
        const { error } = await admin.from(table).update({ [column]: null }).eq(column, userId);
        if (error) throw error;
      }
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) throw error;
      return reply({ users: await listUsers() });
    }

    return reply({ error: "Unknown action." }, 400);
  } catch (err) {
    if (err instanceof UserError) return reply({ error: err.message }, 400);
    console.error(err);
    return reply({ error: "Something went wrong - please try again." }, 500);
  }
});
