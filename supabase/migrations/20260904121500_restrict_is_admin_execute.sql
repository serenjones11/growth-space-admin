-- The prior migration revoked execute on is_admin() from `anon` specifically,
-- but Postgres grants EXECUTE to the implicit PUBLIC pseudo-role by default
-- at creation time, so anon (and every other role) still had access through
-- that blanket grant. Revoke it from PUBLIC instead, then explicitly
-- re-grant only to `authenticated`, which genuinely needs to call it as
-- part of RLS policy evaluation on its own queries.
revoke execute on function is_admin() from public;
grant execute on function is_admin() to authenticated;
