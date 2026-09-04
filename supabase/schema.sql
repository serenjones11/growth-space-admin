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
create type unit_status      as enum ('free', 'occupied', 'service');
create type requisition_status as enum ('pending', 'approved', 'declined', 'completed');
create type maintenance_status as enum ('completed', 'scheduled');


-- ----------------------------------------------------------------------------
-- 2. LAB GROUPS
-- ----------------------------------------------------------------------------
-- A real table instead of a hardcoded list in the frontend, so an admin can
-- add a new lab group without a code change.
create table lab_groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,        -- e.g. "Okafor Lab"
  pi_name     text not null,               -- e.g. "James Okafor"
  colour_hex  text,                        -- optional: pin a chart colour per lab
  created_at  timestamptz not null default now()
);


-- ----------------------------------------------------------------------------
-- 3. PROFILES  (one row per person who can log in)
-- ----------------------------------------------------------------------------
-- Supabase Auth already stores login identity in auth.users. This table adds
-- the app-specific bits: role, and (for researchers) which lab they're in.
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
$$ language plpgsql security definer;

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

  status                 unit_status not null default 'free',
  install_date           date,
  service_frequency_months int not null default 6,
  next_service_due       date,

  photo_url              text,                          -- Supabase Storage path

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index idx_units_floor on units(floor);
create index idx_units_type on units(type);
create index idx_units_status on units(status);


-- ----------------------------------------------------------------------------
-- 6. REQUISITIONS  (the request-space form submissions + their lifecycle)
-- ----------------------------------------------------------------------------
create table requisitions (
  id                uuid primary key default gen_random_uuid(),

  -- who's asking
  researcher_id     uuid references profiles(id),       -- who submitted it, if logged in
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
  assigned_unit_id  text references units(id),
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

-- A cabinet can only hold one booking whose date range overlaps another —
-- Reftech rooms are allowed to stack multiple bookings, cabinets are not.
-- (Enforced in the application layer via unitAvailableForWindow-style checks,
-- since a DB-level exclusion constraint would need the unit's type looked up
-- per-row — doable with a trigger later if you want belt-and-braces safety.)


-- ----------------------------------------------------------------------------
-- 8. SERVICE LOG  (Maintenance History)
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
-- 9. DOCUMENTS  (PDFs attached to a unit)
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
-- 10. keep updated_at fresh
-- ----------------------------------------------------------------------------
create function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_units_updated_at
  before update on units for each row execute procedure set_updated_at();

create trigger trg_requisitions_updated_at
  before update on requisitions for each row execute procedure set_updated_at();


-- ----------------------------------------------------------------------------
-- 11. ROW LEVEL SECURITY
-- ----------------------------------------------------------------------------
-- Everything is readable by any logged-in user (researchers need to see
-- availability too), but only admins can write to inventory/maintenance
-- data. Requisitions are the one place researchers can write — but only
-- their own, and only while still pending.

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
create policy "admin updates any requisition" on requisitions for update using (
  is_admin()
) with check (is_admin());
create policy "researcher amends own pending requisition" on requisitions for update using (
  researcher_id = auth.uid() and status = 'pending'
) with check (
  researcher_id = auth.uid() and status = 'pending'
);


-- ----------------------------------------------------------------------------
-- 12. SEED DATA — your 8 lab groups from the prototype, so the app has
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

-- ============================================================================
-- End of schema. Next steps once this has run cleanly:
--   1. Supabase → Authentication → add your 4-6 users (magic link is easiest).
--   2. Manually set one of them to role = 'admin' in the profiles table.
--   3. Supabase → Storage → create a bucket called "unit-files" for photos/PDFs.
--   4. Swap the React app's mock generators for real Supabase queries.
-- ============================================================================
