-- ============================================================================
-- Growth Space Admin — Supabase schema
-- ============================================================================
-- Run this in Supabase → SQL Editor → New query, on a fresh project.
-- It's split into clearly labelled sections so you can run it all at once
-- now, or step through section-by-section while you're learning it.
--
-- Design notes (read this before running):
-- 1. Units keep their human-readable IDs ("GC-041", "RTR-03") as the primary
--    key, matching how the app already refers to them everywhere.
-- 2. The old React prototype modelled a cabinet's occupant and a reftech
--    room's bookings as two different shapes. Here they're unified into one
--    `bookings` table — a cabinet just happens to only ever have one active
--    row at a time. This also finally gives every booking a real, permanent
--    link back to the requisition that created it (the prototype had to
--    fake this after the fact with a "backfill" hack — that whole problem
--    disappears once there's a real database).
-- 3. Enums are used for fields with a fixed, known set of values (status,
--    discipline, unit type). Everything else that might reasonably grow
--    over time (light cycles, document types) is left as free text.
-- 4. `units.is_out_of_service` is the ONLY independently-set occupancy fact
--    stored on a unit. "Free" vs "occupied" is never stored — it's always
--    computed at query time from `bookings`, via the `unit_current_bookings`
--    / `unit_current_occupancy` views below (section 8). Storing a
--    free/occupied column invites drift between it and the actual booking
--    rows; the old prototype had exactly this problem and had to patch over
--    it with a "backfill" reconciliation hack.
-- 5. "Overdue" is not just "booking end_date has passed" — a booking only
--    counts as overdue if its end date has passed AND its linked
--    requisition hasn't been marked `completed` yet. A booking whose date
--    range ended but whose requisition was already completed is just
--    history, not something an admin needs to chase. See
--    `unit_current_bookings` in section 8.
-- 6. CO2 is a property of a *unit* (`units.co2_control`, already modelled),
--    not something duplicated onto a requisition. A future "CO2 required"
--    field on the request form should filter/match against
--    `units.co2_control` when picking a candidate unit — it should not
--    become its own column on `requisitions`.
-- 7. Auth: real login (Microsoft Entra ID SSO) isn't wired up yet — that's
--    a later piece of work for this org. Until it lands, the public Request
--    Space form needs to be submittable without a logged-in user. See the
--    RLS note in section 11 for exactly how that's handled, and what to
--    tighten once Entra ID is live.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 0. EXTENSIONS
-- ----------------------------------------------------------------------------
create extension if not exists pgcrypto;   -- gives us gen_random_uuid()


-- ----------------------------------------------------------------------------
-- 1. ENUMS
-- ----------------------------------------------------------------------------
create type user_role        as enum ('admin', 'researcher');
create type unit_type        as enum ('cabinet', 'reftech');
create type discipline_type  as enum ('plant', 'insect');
create type requisition_status as enum ('pending', 'approved', 'declined', 'completed');
create type maintenance_status as enum ('completed', 'scheduled');

-- Note: there is deliberately no `unit_status` enum. A unit's free/occupied
-- state is never stored — see design note 4 above and section 8.


-- ----------------------------------------------------------------------------
-- 2. LAB GROUPS
-- ----------------------------------------------------------------------------
-- A real table instead of a hardcoded list in the frontend, so an admin can
-- add a new lab group without a code change.
create table lab_groups (
  id           uuid primary key default gen_random_uuid(),
  name         text not null unique,        -- e.g. "Okafor Lab"
  pi_name      text not null,               -- e.g. "James Okafor"
  pi_email     text,                        -- used to de-duplicate self-registered PIs
  colour_hex   text,                        -- optional: pin a chart colour per lab
  -- Seeded rows are verified on creation. A lab group created via
  -- find_or_create_lab_group() (a PI self-registering, or a researcher
  -- picking "My PI isn't listed") starts unverified — see section 15.
  is_verified  boolean not null default true,
  created_at   timestamptz not null default now()
);


-- ----------------------------------------------------------------------------
-- 3. PROFILES  (one row per person who can log in)
-- ----------------------------------------------------------------------------
-- Supabase Auth already stores login identity in auth.users. This table adds
-- the app-specific bits: role, and (for researchers) which lab they're in.
-- Not wired up to real SSO yet (Entra ID, later) — this table and the trigger
-- below are ready and waiting for that, but nothing in the app creates
-- logged-in users today.
create table profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  full_name     text not null,
  role          user_role not null default 'researcher',
  lab_group_id  uuid references lab_groups(id),
  phone         text,
  created_at    timestamptz not null default now()
);

-- Auto-create a profile row the moment someone signs up, so you never have
-- to remember to do it manually.
create function handle_new_user()
returns trigger as $$
begin
  insert into profiles (id, full_name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email), 'researcher');
  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- Only the trigger itself ever needs to run this — never a direct client
-- call — so it doesn't need to be reachable via the public RPC endpoint.
revoke execute on function handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();


-- ----------------------------------------------------------------------------
-- 4. MAINTENANCE CATEGORIES  (admin-manageable, matches the app's "Manage
--    categories" feature — Calibration, Routine Maintenance, etc.)
-- ----------------------------------------------------------------------------
create table maintenance_categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  bg_hex      text not null default '#EFF6FF',
  ink_hex     text not null default '#1D4ED8',
  border_hex  text not null default '#C7DDFB',
  created_at  timestamptz not null default now()
);

insert into maintenance_categories (name, bg_hex, ink_hex, border_hex) values
  ('Calibration',         '#F5F3FF', '#6D28D9', '#DDD6FE'),
  ('Routine Maintenance', '#EFF6FF', '#1D4ED8', '#C7DDFB'),
  ('Inspection',          '#FEF9EC', '#92400E', '#FBE7B8'),
  ('Repair',               '#FDF2F2', '#B23A34', '#F5D0CE'),
  ('Cleaning',            '#ECFDF3', '#15803D', '#BBF0CE');


-- ----------------------------------------------------------------------------
-- 5. UNITS  (growth cabinets & Reftech rooms)
-- ----------------------------------------------------------------------------
create table units (
  id                     text primary key,             -- "GC-041", "RTR-03"
  type                   unit_type not null,
  discipline             discipline_type,               -- cabinets only; null for reftech
  floor                  text not null,                 -- "LG","L1","L2A","L2B","L3"
  room                   text not null,
  manufacturer           text not null,
  model                  text not null,
  serial_number          text,
  asset_number           text,
  tscan_id               text,

  shelves                int,                           -- cabinets only
  lighting_type          text,
  ballasts               text,
  co2_control            boolean not null default false,
  dimming_control        boolean not null default false,
  last_bulb_fitting      date,
  available_light_cycles text[] default array[
    '8/16 h (L/D)', '12/12 h (L/D)', '16/8 h (L/D)', '24 h dark', 'Continuous light'
  ],

  temp_min               numeric not null default 4,
  temp_max               numeric not null default 40,
  humidity_min           numeric not null default 20,
  humidity_max           numeric not null default 95,

  -- The only occupancy fact ever stored on a unit — see design note 4.
  -- Free vs occupied is always computed, never stored (section 8).
  is_out_of_service      boolean not null default false,

  install_date           date,
  service_frequency_months int not null default 6,
  next_service_due       date,

  photo_url              text,                          -- Supabase Storage path

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index idx_units_floor on units(floor);
create index idx_units_type on units(type);
create index idx_units_out_of_service on units(is_out_of_service) where is_out_of_service;


-- ----------------------------------------------------------------------------
-- 6. REQUISITIONS  (the request-space form submissions + their lifecycle)
-- ----------------------------------------------------------------------------
create table requisitions (
  id                uuid primary key default gen_random_uuid(),

  -- who's asking
  researcher_id     uuid references profiles(id),       -- who submitted it, IF logged in.
                                                          -- Null for now — no SSO yet, see
                                                          -- section 11's RLS note.
  researcher_name   text not null,
  email             text not null,
  role              text,                                -- "PhD Student", "Postdoc", ...
  emergency_number  text,
  lab_group_id      uuid references lab_groups(id),
  pi_name           text,

  -- what they need
  unit_type         unit_type not null,
  discipline        discipline_type not null,
  species           text[] default array[]::text[],
  number_of_plants  int,
  containment_level text,
  space_description text,
  project_title     text not null,
  project_desc      text,

  -- environment
  -- Note: no `co2` column here on purpose — CO2 is a unit property
  -- (units.co2_control). See design note 6.
  set_temp          numeric,
  set_humidity      numeric,
  light_cycle       text,
  pest_consent      boolean not null default false,
  dimming_required  boolean not null default false,
  safety_compliance boolean not null default false,

  -- schedule
  preferred_floor   text,                                -- floor code, or 'any'
  start_date        date not null,
  end_date          date not null,

  -- free text
  hazard_notes      text,
  notes             text,

  -- lifecycle
  status            requisition_status not null default 'pending',
  -- ON DELETE SET NULL: deleting a unit (see units' delete policy) clears
  -- this reference rather than being blocked by, or cascading away, the
  -- requisition's own history (researcher, PI, dates, status).
  assigned_unit_id  text references units(id) on delete set null,
  submitted_date    timestamptz not null default now(),
  decided_date      timestamptz,
  decided_by        uuid references profiles(id),
  completed_date    timestamptz,
  completed_by      uuid references profiles(id),

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint end_after_start check (end_date >= start_date)
);

create index idx_requisitions_status on requisitions(status);
create index idx_requisitions_researcher on requisitions(researcher_id);
create index idx_requisitions_unit on requisitions(assigned_unit_id);


-- ----------------------------------------------------------------------------
-- 7. BOOKINGS  (one row per person's time in a unit — replaces the
--    prototype's split "cabinet occupant" vs "reftech bookings array")
-- ----------------------------------------------------------------------------
create table bookings (
  id              uuid primary key default gen_random_uuid(),
  unit_id         text not null references units(id) on delete cascade,
  requisition_id  uuid references requisitions(id),      -- always set once created via the app

  researcher_name text not null,
  role            text,                                  -- "PhD Student", "Postdoc", ...
  lab_group_id    uuid references lab_groups(id),
  project_title   text,
  discipline      discipline_type,

  set_temp        numeric,
  set_humidity    numeric,
  light_cycle     text,

  start_date      date not null,
  end_date        date not null,

  created_at      timestamptz not null default now(),

  constraint booking_end_after_start check (end_date >= start_date)
);

create index idx_bookings_unit on bookings(unit_id);
create index idx_bookings_dates on bookings(start_date, end_date);
create index idx_bookings_requisition on bookings(requisition_id);

-- A cabinet can only hold one booking whose date range overlaps another —
-- Reftech rooms are allowed to stack multiple bookings, cabinets are not.
-- (Enforced in the application layer via unitAvailableForWindow-style checks,
-- since a DB-level exclusion constraint would need the unit's type looked up
-- per-row — doable with a trigger later if you want belt-and-braces safety.)


-- ----------------------------------------------------------------------------
-- 8. COMPUTED OCCUPANCY  (views — nothing here is stored; see design notes
--    4 and 5)
-- ----------------------------------------------------------------------------
-- A booking counts as "current" once its requisition has been approved and
-- its start date has arrived — and it STAYS current (even past its end
-- date) until the requisition is marked completed. That's what lets a
-- lapsed booking show up as overdue instead of silently freeing the unit.
create or replace view unit_current_bookings
with (security_invoker = true)
as
select
  b.*,
  r.status as requisition_status,
  (b.end_date < current_date) as is_overdue,
  (b.end_date >= current_date and b.end_date <= current_date + 2) as is_ending_soon
from bookings b
join requisitions r on r.id = b.requisition_id
where r.status = 'approved'
  and b.start_date <= current_date;

comment on view unit_current_bookings is
  'Bookings that currently occupy their unit: requisition approved (not yet completed) and already started. is_overdue means the end date has passed but nobody has completed the requisition yet — see design note 5 in this file.';

-- One row per unit with a single computed status — this is the direct
-- equivalent of the old prototype's `unit.status` ('free'/'occupied'/
-- 'service'), just computed instead of stored.
create or replace view unit_current_occupancy
with (security_invoker = true)
as
select
  u.id as unit_id,
  case
    when u.is_out_of_service then 'service'
    when exists (select 1 from unit_current_bookings b where b.unit_id = u.id) then 'occupied'
    else 'free'
  end as computed_status,
  exists (
    select 1 from unit_current_bookings b where b.unit_id = u.id and b.is_overdue
  ) as has_overdue_booking,
  exists (
    select 1 from unit_current_bookings b where b.unit_id = u.id and b.is_ending_soon
  ) as has_ending_soon_booking
from units u;

comment on view unit_current_occupancy is
  'Computed free/occupied/service status per unit. Never read units.is_out_of_service directly to answer "is this unit free" — always go through this view (or unit_current_bookings) so occupancy reflects live booking data.';


-- ----------------------------------------------------------------------------
-- 9. SERVICE LOG  (Maintenance History)
-- ----------------------------------------------------------------------------
create table service_log (
  id           uuid primary key default gen_random_uuid(),
  unit_id      text not null references units(id) on delete cascade,
  category_id  uuid references maintenance_categories(id),
  status       maintenance_status not null default 'completed',
  date         date not null,
  contractor   text,
  notes        text,
  cost         numeric,
  created_by   uuid references profiles(id),
  created_at   timestamptz not null default now()
);

create index idx_service_log_unit on service_log(unit_id);


-- ----------------------------------------------------------------------------
-- 10. DOCUMENTS  (PDFs attached to a unit)
-- ----------------------------------------------------------------------------
create table documents (
  id          uuid primary key default gen_random_uuid(),
  unit_id     text not null references units(id) on delete cascade,
  name        text not null,
  type        text not null default 'Manual',   -- Manual / Certificate / Risk Assessment / ...
  storage_path text,                             -- path in the Supabase Storage bucket
  added_by    uuid references profiles(id),
  date        date not null default current_date,
  created_at  timestamptz not null default now()
);

create index idx_documents_unit on documents(unit_id);


-- ----------------------------------------------------------------------------
-- 11. keep updated_at fresh
-- ----------------------------------------------------------------------------
create function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql set search_path = public;

create trigger trg_units_updated_at
  before update on units for each row execute procedure set_updated_at();

create trigger trg_requisitions_updated_at
  before update on requisitions for each row execute procedure set_updated_at();


-- ----------------------------------------------------------------------------
-- 12. ROW LEVEL SECURITY
-- ----------------------------------------------------------------------------
-- Everything except requisitions is readable by any logged-in user
-- (researchers need to see availability too, once they log in), but only
-- admins can write to inventory/maintenance data.
--
-- *** Temporary, pre-SSO note ***
-- Entra ID SSO isn't wired up yet (see design note 7). Until it is, the
-- Request Space form is the one page non-admin users touch, and they have
-- no session at all — so `requisitions` gets an extra INSERT policy for the
-- `anon` role, with `researcher_id` required to be null (there's no
-- authenticated user to attach it to). Everything else stays locked to
-- `authenticated`/admin as before; the public form only ever needs to
-- create a requisition, never read or write anything else.
--
-- >>> Once Entra ID is live: drop the "public can submit a requisition"
-- policy below, require `researcher_id = auth.uid()` unconditionally on
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
$$ language sql security definer stable set search_path = public;

-- Only `authenticated` needs to call this (it's evaluated as part of RLS
-- policies on their own queries). Revoke the default PUBLIC grant so it
-- isn't reachable by `anon` at all, then re-grant to `authenticated` only.
-- (`authenticated` being able to invoke it directly via the public RPC
-- endpoint is an accepted, low-risk tradeoff of this pattern — it only
-- returns a boolean, no row data.)
revoke execute on function is_admin() from public;
grant execute on function is_admin() to authenticated;

-- --- read access ---
-- lab_groups is readable by any authenticated user — the request form's
-- lab-group dropdown needs it, and it isn't sensitive data. Everything
-- else here is admin/inventory data that a researcher never needs (they
-- only ever touch the request form), so it's gated on is_admin() rather
-- than just "authenticated" — see the note above requisitions' pre-SSO
-- insert policy for why this distinction matters once researchers also
-- log in via Entra ID. profiles is admin-or-self, so a user can still
-- read their own profile (role/lab group) to drive frontend routing.
create policy "read lab_groups"             on lab_groups             for select using (auth.role() = 'authenticated');
create policy "read profiles"               on profiles               for select using (is_admin() or id = auth.uid());
create policy "read maintenance_categories" on maintenance_categories for select using (is_admin());
create policy "read units"                  on units                  for select using (is_admin());
create policy "read bookings"               on bookings               for select using (is_admin());
create policy "read service_log"            on service_log            for select using (is_admin());
create policy "read documents"              on documents              for select using (is_admin());

-- --- write access: admins only, for inventory/maintenance data ---
create policy "admin write lab_groups"             on lab_groups             for all using (is_admin()) with check (is_admin());
create policy "admin write maintenance_categories" on maintenance_categories for all using (is_admin()) with check (is_admin());
create policy "admin write units"                  on units                  for all using (is_admin()) with check (is_admin());
create policy "admin write bookings"               on bookings               for all using (is_admin()) with check (is_admin());
create policy "admin write service_log"            on service_log            for all using (is_admin()) with check (is_admin());
create policy "admin write documents"              on documents              for all using (is_admin()) with check (is_admin());

-- profiles: a user can update their own row, but the RLS policy alone only
-- restricts which ROW they can touch — not which COLUMNS. Without a
-- column-level grant too, a researcher could set their own `role` to
-- 'admin' via a direct API call. Revoke UPDATE entirely and grant it back
-- only on the columns a user should be able to change about themselves;
-- role and lab_group_id can then only be changed by an admin (via the
-- Supabase dashboard/SQL editor, which bypasses table grants and RLS as
-- the service role).
create policy "update own profile" on profiles for update
  using (id = auth.uid()) with check (id = auth.uid());
revoke update on profiles from authenticated;
grant update (full_name, phone) on profiles to authenticated;

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


-- ----------------------------------------------------------------------------
-- 13. STORAGE  (unit photos and requisition/unit documents)
-- ----------------------------------------------------------------------------
-- Private bucket — photos/documents are inventory data, same access tier as
-- units/service_log/documents under the permission model above, not public.
insert into storage.buckets (id, name, public)
values ('unit-files', 'unit-files', false)
on conflict (id) do nothing;

create policy "admin read unit-files" on storage.objects
  for select using (bucket_id = 'unit-files' and is_admin());

create policy "admin write unit-files" on storage.objects
  for insert with check (bucket_id = 'unit-files' and is_admin());

create policy "admin update unit-files" on storage.objects
  for update using (bucket_id = 'unit-files' and is_admin())
  with check (bucket_id = 'unit-files' and is_admin());

create policy "admin delete unit-files" on storage.objects
  for delete using (bucket_id = 'unit-files' and is_admin());


-- ----------------------------------------------------------------------------
-- 14. SEED DATA — your 8 lab groups from the prototype, so the app has
--     something real to point at on day one. Replace/extend freely.
-- ----------------------------------------------------------------------------
insert into lab_groups (name, pi_name) values
  ('Okafor Lab',    'James Okafor'),
  ('Petrova Lab',   'Elena Petrova'),
  ('Chen Lab',      'Wei Chen'),
  ('Singh Lab',     'Amrit Singh'),
  ('Martins Lab',   'Sofia Martins'),
  ('Whitfield Lab', 'Rachel Whitfield'),
  ('Al-Farsi Lab',  'Yousef Al-Farsi'),
  ('Novak Lab',     'Tomas Novak');


-- ----------------------------------------------------------------------------
-- 15. LAB GROUP / PI LOOKUP FUNCTIONS
-- ----------------------------------------------------------------------------
-- Supports the Request Space form's PI field: a PI filling in the form
-- themselves (role = "PI / Academic Staff") has the requisition attached
-- directly to them, or a researcher filling it in on someone else's behalf
-- can pick "My PI isn't listed". Either way, if the PI isn't already in
-- the database, find_or_create_lab_group() creates a new row for them with
-- is_verified = false, checking first for a confident (exact, not fuzzy)
-- name or email match so the same PI submitting more than once doesn't
-- spawn duplicate pending rows. An admin reviews pending entries via the
-- app's pending-PIs view — approving (flip is_verified) or merging a
-- duplicate into an existing verified lab group both happen as plain
-- authenticated writes, no dedicated RPC needed, since admins already have
-- full RLS write access to lab_groups/requisitions/bookings.
--
-- The anonymous Request Space form can't read or write lab_groups directly
-- (RLS requires `authenticated` for reads, `is_admin()` for writes) — these
-- two SECURITY DEFINER functions give it a narrow, safe surface instead of
-- broadening the table's RLS itself. list_lab_groups() only ever returns
-- verified rows (it's for the public PI picker); admins list pending ones
-- by reading the table directly (`select * from lab_groups where not
-- is_verified`), which their existing RLS access already allows.
create or replace function list_lab_groups()
returns table(id uuid, name text, pi_name text)
language sql
security definer
stable
set search_path = public
as $$
  select id, name, pi_name from lab_groups where is_verified = true order by pi_name;
$$;

revoke execute on function list_lab_groups() from public;
grant execute on function list_lab_groups() to anon, authenticated;

create or replace function find_or_create_lab_group(p_pi_name text, p_pi_email text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_norm_name text;
  v_surname text;
  v_name text;
  v_suffix int := 0;
begin
  p_pi_name := trim(p_pi_name);
  if p_pi_name = '' then
    raise exception 'PI name must not be empty';
  end if;
  p_pi_email := nullif(trim(p_pi_email), '');

  -- Strongest identity signal first: an exact email match, verified or not
  -- (so the same not-yet-verified PI submitting again reuses their pending
  -- row instead of spawning another one).
  if p_pi_email is not null then
    select id into v_id from lab_groups where lower(pi_email) = lower(p_pi_email) limit 1;
    if v_id is not null then
      return v_id;
    end if;
  end if;

  -- Otherwise, an exact (whitespace/case-normalized) name match — avoids an
  -- obvious duplicate for the same PI. Deliberately NOT fuzzy/similarity
  -- matching: a near-miss (e.g. "J. Okafor" vs "James Okafor") still
  -- creates a new pending row rather than risking a wrong auto-merge —
  -- that's what the admin merge tool is for.
  v_norm_name := regexp_replace(lower(p_pi_name), '\s+', ' ', 'g');
  select id into v_id from lab_groups
    where regexp_replace(lower(pi_name), '\s+', ' ', 'g') = v_norm_name
    limit 1;
  if v_id is not null then
    -- Backfill the email if this row doesn't have one yet, so a later call
    -- with a differently-spelled name but the same email can still match
    -- by email instead of creating an avoidable duplicate.
    if p_pi_email is not null then
      update lab_groups set pi_email = p_pi_email where id = v_id and pi_email is null;
    end if;
    return v_id;
  end if;

  -- No confident match — create a new, unverified entry for an admin to
  -- review. Name matches the existing seed convention ("James Okafor" ->
  -- "Okafor Lab").
  v_surname := (regexp_match(p_pi_name, '(\S+)$'))[1];
  v_name := v_surname || ' Lab';
  while exists (select 1 from lab_groups where name = v_name) loop
    v_suffix := v_suffix + 1;
    v_name := v_surname || ' Lab ' || v_suffix;
  end loop;

  insert into lab_groups (name, pi_name, pi_email, is_verified)
    values (v_name, p_pi_name, p_pi_email, false)
    returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function find_or_create_lab_group(text, text) from public;
grant execute on function find_or_create_lab_group(text, text) to anon, authenticated;

-- ============================================================================
-- End of schema. Next steps once this has run cleanly:
--   1. Supabase → Authentication → add your 4-6 admin users for now (magic
--      link is easiest); Entra ID SSO for researchers comes later.
--   2. Manually set the admin user(s) to role = 'admin' in the profiles table.
--   3. Supabase → Storage → create a bucket called "unit-files" for photos/PDFs.
--   4. Swap the React app's mock generators for real Supabase queries —
--      remember to read occupancy through unit_current_occupancy /
--      unit_current_bookings, never units.is_out_of_service alone.
-- ============================================================================
