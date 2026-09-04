-- Security hardening picked up by Supabase's advisor after the initial
-- schema was applied:
--
-- 1. unit_current_bookings / unit_current_occupancy were created as
--    SECURITY DEFINER views by default, which would bypass RLS on the
--    underlying bookings/requisitions/units tables for whoever queries
--    them. Switch them to SECURITY INVOKER so they respect the querying
--    user's own permissions instead.
-- 2. handle_new_user / set_updated_at / is_admin had a mutable search_path
--    (a function search-path-hijacking risk) — pin it explicitly.
-- 3. handle_new_user and is_admin were directly callable via the public
--    RPC endpoint by anon/authenticated, which isn't intended:
--      - handle_new_user only needs to run as the trigger on auth.users
--        inserts, never as a direct client call.
--      - is_admin is only meant to be evaluated inside RLS policies for
--        authenticated users; anon never needs to call it directly.

alter view unit_current_bookings set (security_invoker = true);
alter view unit_current_occupancy set (security_invoker = true);

alter function handle_new_user() set search_path = public;
alter function set_updated_at() set search_path = public;
alter function is_admin() set search_path = public;

revoke execute on function handle_new_user() from public, anon, authenticated;
revoke execute on function is_admin() from anon;
