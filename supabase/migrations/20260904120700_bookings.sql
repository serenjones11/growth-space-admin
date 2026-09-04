-- Bookings: one row per person's time in a unit — replaces the prototype's
-- split "cabinet occupant" vs "reftech bookings array" with a single table.
-- Every booking has a real, permanent link back to the requisition that
-- created it.
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
