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
  -- ON DELETE SET NULL: deleting a lab group/PI (e.g. they've left) clears
  -- this reference instead of being blocked by it.
  lab_group_id  uuid references lab_groups(id) on delete set null,
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
-- Discipline (plant/insect) is not a unit column — it's purely a
-- requisition/booking-level concept (see requisitions and bookings below).
-- A cabinet isn't permanently "a plant cabinet" or "an insect cabinet"; it
-- grows whatever it's currently booked for, so any cabinet can be assigned
-- to any requisition regardless of discipline. What a unit is "doing"
-- right now is derived live from its current occupant/booking.
create table units (
  id                     text primary key,             -- "GC-041", "RTR-03"
  type                   unit_type not null,
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
  notes                  text,                          -- freeform admin notes, shown above Maintenance History
  -- Which specific set of booking ids an admin has dismissed the
  -- "overlapping requisitions" warning for on this unit (cabinets only in
  -- practice). Not a bare boolean: if the overlap changes (a booking's
  -- dates move, a third one joins), that's a different situation and the
  -- warning should reappear rather than staying dismissed forever.
  acknowledged_clash_booking_ids uuid[] default array[]::uuid[],

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
  -- Human-readable reference ("R26-0001"), assigned by a trigger on insert
  -- — see section 19. Never set directly by application code.
  code              text unique,

  -- who's asking
  researcher_id     uuid references profiles(id),       -- who submitted it, IF logged in.
                                                          -- Null for now — no SSO yet, see
                                                          -- section 11's RLS note.
  researcher_name   text not null,
  email             text not null,
  role              text,                                -- "PhD Student", "Postdoc", ...
  emergency_number  text,
  -- ON DELETE SET NULL: deleting a PI/lab group clears this reference
  -- rather than being blocked by it or losing the requisition's history.
  lab_group_id      uuid references lab_groups(id) on delete set null,
  pi_name           text,

  -- what they need
  unit_type         unit_type not null,
  discipline        discipline_type not null,
  species           text[] default array[]::text[],
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
  -- Admin-only internal note (e.g. "TH may want to extend by 2 weeks"),
  -- distinct from the researcher's own `notes` above. Shown in small,
  -- deliberately understated text on the unit's occupant bar in Inventory.
  admin_notes       text,

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
  -- ON DELETE CASCADE (unlike unit/lab_group references elsewhere): a
  -- booking only exists as a direct consequence of the requisition that
  -- got it approved, so if the requisition itself is deleted there's
  -- nothing left for the booking to be a record of.
  requisition_id  uuid references requisitions(id) on delete cascade,      -- always set once created via the app

  researcher_name text not null,
  role            text,                                  -- "PhD Student", "Postdoc", ...
  -- ON DELETE SET NULL: deleting a PI/lab group clears this reference
  -- rather than being blocked by it or losing the booking's history.
  lab_group_id    uuid references lab_groups(id) on delete set null,
  project_title   text,
  discipline      discipline_type,
  -- Denormalized from the requisition at approval time (same reasoning as
  -- project_title/discipline above) — a Reftech room can hold several
  -- ongoing requisitions at once, and its inventory tile lists each one's
  -- species without a separate lookup.
  species         text[] default array[]::text[],

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
-- admin_notes must also be null: it's meant to be admin-authored only
-- (see its column comment), and RLS doesn't restrict individual column
-- VALUES on its own — a raw request straight to the REST API, bypassing
-- the app's own JS entirely, could otherwise plant fake admin-looking
-- text there. This is enforced here, not just by app code, for exactly
-- that reason.
create policy "public can submit a requisition (pre-SSO)" on requisitions for insert
  to anon
  with check (researcher_id is null and admin_notes is null);
create policy "admin updates any requisition" on requisitions for update using (
  is_admin()
) with check (is_admin());
create policy "researcher amends own pending requisition" on requisitions for update using (
  researcher_id = auth.uid() and status = 'pending'
) with check (
  researcher_id = auth.uid() and status = 'pending'
);
create policy "admin deletes any requisition" on requisitions for delete using (is_admin());


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


-- ----------------------------------------------------------------------------
-- 16. ACTIVITY LOG  (durable events that live inference can't recover)
-- ----------------------------------------------------------------------------
-- The dashboard's "Recent activity" was entirely inferred from current table
-- state (a unit's occupant, a requisition's status) — fine for anything
-- still there, but it can never recover an event whose row is now gone: a
-- deleted unit, a deleted PI, a deleted requisition. This table + triggers
-- cover exactly those events, written automatically regardless of which
-- code path caused the change (admin action or the anon self-registration
-- RPC) rather than by scattering manual logging calls through the app.
-- Booking-assigned and requisition status-change events are deliberately
-- NOT logged here — those still work via live inference (the row is still
-- there), so logging them too would just duplicate every entry.
create table activity_log (
  id          uuid primary key default gen_random_uuid(),
  type        text not null,   -- 'unit_added' | 'unit_deleted' | 'lab_group_added' | 'lab_group_deleted' | 'requisition_deleted'
  title       text not null,
  subtitle    text,
  -- Deliberately NOT a foreign key: this row must survive the referenced
  -- unit being deleted (that's the entire point of this table).
  unit_id     text,
  created_at  timestamptz not null default now()
);

alter table activity_log enable row level security;
create policy "read activity_log" on activity_log for select using (is_admin());
-- No insert/update/delete policy for any client role — only the trigger
-- functions below write to it, running as SECURITY DEFINER (bypassing RLS
-- as the table owner, the same pattern as is_admin() itself).

create or replace function log_unit_insert()
returns trigger as $$
begin
  insert into activity_log (type, title, subtitle, unit_id, created_at)
  values (
    'unit_added',
    new.id || ' added to inventory',
    (case when new.type = 'reftech' then 'Reftech room' else 'Growth cabinet' end) || ' · ' || new.floor || ', ' || new.room,
    new.id,
    new.created_at
  );
  return new;
end;
$$ language plpgsql security definer set search_path = public;
create trigger trg_log_unit_insert after insert on units for each row execute procedure log_unit_insert();

create or replace function log_unit_delete()
returns trigger as $$
begin
  insert into activity_log (type, title, subtitle, unit_id, created_at)
  values (
    'unit_deleted',
    old.id || ' removed from inventory',
    (case when old.type = 'reftech' then 'Reftech room' else 'Growth cabinet' end) || ' · was ' || old.floor || ', ' || old.room,
    old.id,
    now()
  );
  return old;
end;
$$ language plpgsql security definer set search_path = public;
create trigger trg_log_unit_delete after delete on units for each row execute procedure log_unit_delete();

create or replace function log_lab_group_insert()
returns trigger as $$
begin
  insert into activity_log (type, title, subtitle, created_at)
  values (
    'lab_group_added',
    new.pi_name || ' added as a PI',
    new.name || (case when not new.is_verified then ' · pending review' else '' end),
    new.created_at
  );
  return new;
end;
$$ language plpgsql security definer set search_path = public;
create trigger trg_log_lab_group_insert after insert on lab_groups for each row execute procedure log_lab_group_insert();

create or replace function log_lab_group_delete()
returns trigger as $$
begin
  insert into activity_log (type, title, subtitle, created_at)
  values ('lab_group_deleted', old.pi_name || ' removed from PI list', old.name, now());
  return old;
end;
$$ language plpgsql security definer set search_path = public;
create trigger trg_log_lab_group_delete after delete on lab_groups for each row execute procedure log_lab_group_delete();

create or replace function log_requisition_delete()
returns trigger as $$
begin
  insert into activity_log (type, title, subtitle, created_at)
  values ('requisition_deleted', old.project_title || ' requisition deleted', old.researcher_name, now());
  return old;
end;
$$ language plpgsql security definer set search_path = public;
create trigger trg_log_requisition_delete after delete on requisitions for each row execute procedure log_requisition_delete();


-- ----------------------------------------------------------------------------
-- 17. ROOMS  (admin-manageable, same pattern as maintenance_categories)
-- ----------------------------------------------------------------------------
-- Previously a hardcoded frontend list (ROOMS_BY_FLOOR / REFTECH_ROOMS_BY_FLOOR
-- in App.jsx) with no way to add one beyond a redeploy, and no way to remove
-- one at all. units.room stays free text (deliberately not a foreign key to
-- this table) — a unit's room is a snapshot at creation time, so deleting a
-- room here must never cascade into or block existing units.
create table rooms (
  id          uuid primary key default gen_random_uuid(),
  floor       text not null,
  type        unit_type not null,
  name        text not null,
  created_at  timestamptz not null default now(),
  unique (floor, type, name)
);

alter table rooms enable row level security;
create policy "read rooms" on rooms for select using (is_admin());
create policy "admin write rooms" on rooms for all using (is_admin()) with check (is_admin());

-- Seeded from the exact set the frontend previously hardcoded.
insert into rooms (floor, type, name) values
  ('LG',  'cabinet', 'Room LG.03'),
  ('LG',  'cabinet', 'Room LG.07'),
  ('L1',  'cabinet', 'Room 1.04'),
  ('L1',  'cabinet', 'Room 1.09'),
  ('L1',  'cabinet', 'Room 1.15'),
  ('L2A', 'cabinet', 'Room 2A.02'),
  ('L2A', 'cabinet', 'Room 2A.11'),
  ('L2B', 'cabinet', 'Room 2B.05'),
  ('L2B', 'cabinet', 'Room 2B.14'),
  ('L3',  'cabinet', 'Room 3.06'),
  ('L3',  'cabinet', 'Room 3.12'),
  ('L3',  'cabinet', 'Room 3.20'),
  ('LG',  'reftech', 'Reftech Room LG-A'),
  ('L1',  'reftech', 'Reftech Room 1-A'),
  ('L2A', 'reftech', 'Reftech Room 2A-A'),
  ('L2A', 'reftech', 'Reftech Room 2A-B'),
  ('L2B', 'reftech', 'Reftech Room 2B-A'),
  ('L3',  'reftech', 'Reftech Room 3-A'),
  ('L3',  'reftech', 'Reftech Room 3-B');


-- ----------------------------------------------------------------------------
-- 18. REQUISITION EMAIL NOTIFICATIONS
-- ----------------------------------------------------------------------------
-- Admins get emailed when a new requisition comes in; the requester gets
-- emailed once it's approved and assigned a unit. Sending itself happens in
-- the notify-requisition Edge Function (supabase/functions/notify-requisition),
-- which calls Resend — these triggers just fire it asynchronously via
-- pg_net whenever the right change happens, so no application code path can
-- forget to send the notification.
create extension if not exists pg_net with schema extensions;

-- Posts to the Edge Function, authenticated by a secret stored in Vault
-- (supabase_vault) rather than hardcoded here or passed from the client —
-- set separately via vault.create_secret('...', 'requisition_webhook_secret'),
-- never committed to a migration file. If it hasn't been set yet, skip
-- quietly: a requisition insert/update must never fail just because email
-- delivery isn't configured.
create or replace function notify_requisition_webhook(payload jsonb)
returns void as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'requisition_webhook_secret';
  if v_secret is null then
    return;
  end if;
  perform net.http_post(
    url := 'https://ttyyttkdezvlyldtrcpx.supabase.co/functions/v1/notify-requisition',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_secret),
    body := payload
  );
end;
$$ language plpgsql security definer set search_path = public, net, vault;
revoke execute on function notify_requisition_webhook(jsonb) from public, anon, authenticated;

create or replace function trg_notify_new_requisition_fn()
returns trigger as $$
begin
  perform notify_requisition_webhook(jsonb_build_object('type', 'new_requisition', 'requisitionId', new.id));
  return new;
end;
$$ language plpgsql security definer set search_path = public;
revoke execute on function trg_notify_new_requisition_fn() from public, anon, authenticated;
create trigger trg_notify_new_requisition
  after insert on requisitions
  for each row execute procedure trg_notify_new_requisition_fn();

create or replace function trg_notify_requisition_assigned_fn()
returns trigger as $$
begin
  if new.status = 'approved' and new.assigned_unit_id is not null
     and (old.status is distinct from new.status or old.assigned_unit_id is distinct from new.assigned_unit_id) then
    perform notify_requisition_webhook(jsonb_build_object('type', 'requisition_assigned', 'requisitionId', new.id));
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;
revoke execute on function trg_notify_requisition_assigned_fn() from public, anon, authenticated;
create trigger trg_notify_requisition_assigned
  after update on requisitions
  for each row execute procedure trg_notify_requisition_assigned_fn();


-- ----------------------------------------------------------------------------
-- 19. REQUISITION CODES  (human-readable reference — "R26-0001")
-- ----------------------------------------------------------------------------
-- A stable short reference researchers/admins can say out loud or search
-- for, instead of a UUID or "whichever one titled X". requisitions.code
-- (declared in section 6) is set by this trigger, never by application code.
create table requisition_code_counters (
  year      int primary key,
  next_seq  int not null default 1
);

-- BEFORE INSERT (not after) so new.code is set on the row as it's written,
-- in the same statement — no follow-up update needed. The UPDATE below
-- takes a row lock on that year's counter row, so concurrent submissions
-- in the same year can never be handed the same sequence number.
create or replace function assign_requisition_code()
returns trigger as $$
declare
  v_year int := extract(year from now())::int;
  v_seq  int;
begin
  insert into requisition_code_counters (year, next_seq) values (v_year, 1)
    on conflict (year) do nothing;

  update requisition_code_counters
    set next_seq = next_seq + 1
    where year = v_year
    returning next_seq - 1 into v_seq;

  new.code := 'R' || lpad((v_year % 100)::text, 2, '0') || '-' || lpad(v_seq::text, 4, '0');
  return new;
end;
$$ language plpgsql security definer set search_path = public;
revoke execute on function assign_requisition_code() from public, anon, authenticated;

create trigger trg_assign_requisition_code
  before insert on requisitions
  for each row execute procedure assign_requisition_code();

-- ============================================================================
-- End of schema. Next steps once this has run cleanly:
--   1. Supabase → Authentication → add your 4-6 admin users for now (magic
--      link is easiest); Entra ID SSO for researchers comes later.
--   2. Manually set the admin user(s) to role = 'admin' in the profiles table.
--   3. Supabase → Storage → create a bucket called "unit-files" for photos/PDFs.
--   4. Swap the React app's mock generators for real Supabase queries —
--      remember to read occupancy through unit_current_occupancy /
--      unit_current_bookings, never units.is_out_of_service alone.
--   5. Email notifications (section 18): set two Edge Function secrets on
--      notify-requisition — RESEND_API_KEY (from resend.com) and
--      WEBHOOK_SECRET (must match the value passed to
--      vault.create_secret('<value>', 'requisition_webhook_secret') in the
--      database). Optionally NOTIFY_FROM_EMAIL once a sending domain is
--      verified in Resend, and APP_URL to link back into the app from the
--      admin notification email.
-- ============================================================================
