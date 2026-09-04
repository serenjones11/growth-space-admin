-- Tightens RLS to match the real permission model: 4-6 admins with full
-- access, 40-60 researchers who only ever touch the request form, all
-- signing in via Microsoft Entra ID.
--
-- Fix 1: the read policies on profiles/maintenance_categories/units/
-- bookings/service_log/documents were "any authenticated user", which was
-- a fine stand-in while only admins could ever be logged in (the pre-SSO
-- placeholder). Once researchers also authenticate via Entra ID, that
-- assumption breaks — a researcher could otherwise call the Supabase API
-- directly and read the full inventory/bookings/maintenance data even
-- though the frontend never shows them that page. Gate these on
-- is_admin() instead. lab_groups is intentionally left as-is (any
-- authenticated user) — the request form's lab-group dropdown needs it,
-- and it isn't sensitive data. profiles allows admins OR the user's own
-- row, so a researcher can still read their own profile (name/role/lab
-- group) to drive frontend role-gating and prefill the request form.

drop policy "read profiles" on profiles;
create policy "read profiles" on profiles for select using (
  is_admin() or id = auth.uid()
);

drop policy "read maintenance_categories" on maintenance_categories;
create policy "read maintenance_categories" on maintenance_categories for select using (is_admin());

drop policy "read units" on units;
create policy "read units" on units for select using (is_admin());

drop policy "read bookings" on bookings;
create policy "read bookings" on bookings for select using (is_admin());

drop policy "read service_log" on service_log;
create policy "read service_log" on service_log for select using (is_admin());

drop policy "read documents" on documents;
create policy "read documents" on documents for select using (is_admin());

-- Fix 2: the "update own profile" RLS policy restricts which ROW a user
-- can touch (their own) but not which COLUMNS — as written, a researcher
-- could update their own profiles row and set role = 'admin' via a direct
-- API call. Column-level privileges are the right tool for this in
-- Postgres: revoke UPDATE on profiles from authenticated entirely, then
-- grant it back only on the columns a user should be able to change about
-- themselves. role and lab_group_id can now only be changed by an admin
-- (via the Supabase dashboard/SQL editor, which runs as the service role
-- and bypasses table grants and RLS both).
revoke update on profiles from authenticated;
grant update (full_name, phone) on profiles to authenticated;
