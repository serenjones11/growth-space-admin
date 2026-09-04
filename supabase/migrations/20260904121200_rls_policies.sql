-- Row level security.
--
-- Everything except requisitions is readable by any logged-in user
-- (researchers need to see availability too, once they log in), but only
-- admins can write to inventory/maintenance data.
--
-- *** Temporary, pre-SSO note ***
-- Microsoft Entra ID SSO isn't wired up yet. Until it is, the Request Space
-- form is the one page non-admin users touch, and they have no session at
-- all — so `requisitions` gets an extra INSERT policy for the `anon` role,
-- with `researcher_id` required to be null (there's no authenticated user
-- to attach it to). Everything else stays locked to `authenticated`/admin;
-- the public form only ever needs to create a requisition, never read or
-- write anything else.
--
-- >>> Once Entra ID is live: drop the "public can submit a requisition"
-- policy below, require researcher_id = auth.uid() unconditionally on
-- insert, and start scoping the "amend my requisition" flow in the wizard
-- by the logged-in user. <<<

alter table lab_groups             enable row level security;
alter table profiles               enable row level security;
alter table maintenance_categories enable row level security;
alter table units                  enable row level security;
alter table requisitions           enable row level security;
alter table bookings               enable row level security;
alter table service_log            enable row level security;
alter table documents              enable row level security;

-- small helper so policies don't repeat this subquery everywhere
create function is_admin()
returns boolean as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin'
  );
$$ language sql security definer stable;

-- --- read access: any authenticated user, for the shared reference data ---
create policy "read lab_groups"             on lab_groups             for select using (auth.role() = 'authenticated');
create policy "read profiles"               on profiles               for select using (auth.role() = 'authenticated');
create policy "read maintenance_categories" on maintenance_categories for select using (auth.role() = 'authenticated');
create policy "read units"                  on units                  for select using (auth.role() = 'authenticated');
create policy "read bookings"               on bookings               for select using (auth.role() = 'authenticated');
create policy "read service_log"            on service_log            for select using (auth.role() = 'authenticated');
create policy "read documents"              on documents              for select using (auth.role() = 'authenticated');

-- --- write access: admins only, for inventory/maintenance data ---
create policy "admin write lab_groups"             on lab_groups             for all using (is_admin()) with check (is_admin());
create policy "admin write maintenance_categories" on maintenance_categories for all using (is_admin()) with check (is_admin());
create policy "admin write units"                  on units                  for all using (is_admin()) with check (is_admin());
create policy "admin write bookings"               on bookings               for all using (is_admin()) with check (is_admin());
create policy "admin write service_log"            on service_log            for all using (is_admin()) with check (is_admin());
create policy "admin write documents"              on documents              for all using (is_admin()) with check (is_admin());

-- profiles: a user can update their own row; only admins can change roles
create policy "update own profile" on profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

-- --- requisitions: the one researcher-writable table ---
create policy "read own or all requisitions" on requisitions for select using (
  is_admin() or researcher_id = auth.uid()
);
create policy "researcher creates own requisition" on requisitions for insert with check (
  researcher_id = auth.uid()
);
-- Temporary (pre-SSO): let an unauthenticated visitor submit the public
-- Request Space form. researcher_id must be null — there's no session to
-- attach it to yet. Remove once Entra ID SSO is live (see note above).
create policy "public can submit a requisition (pre-SSO)" on requisitions for insert
  to anon
  with check (researcher_id is null);
create policy "admin updates any requisition" on requisitions for update using (
  is_admin()
) with check (is_admin());
create policy "researcher amends own pending requisition" on requisitions for update using (
  researcher_id = auth.uid() and status = 'pending'
) with check (
  researcher_id = auth.uid() and status = 'pending'
);
