-- Owners can do everything admins can (is_admin() is what every RLS policy
-- and admin-only function checks), plus manage users (is_owner(), checked
-- by the manage-users Edge Function). In the app, role 'admin' is shown as
-- "User".
create or replace function is_admin() returns boolean as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role in ('admin', 'owner')
  );
$$ language sql stable security definer set search_path = public;

create or replace function is_owner() returns boolean as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'owner'
  );
$$ language sql stable security definer set search_path = public;
revoke execute on function is_owner() from public, anon;
grant execute on function is_owner() to authenticated;

-- Every existing admin becomes an owner, so someone can manage users.
update profiles set role = 'owner' where role = 'admin';
