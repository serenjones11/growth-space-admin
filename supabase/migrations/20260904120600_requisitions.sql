-- Requisitions: the request-space form submissions + their lifecycle
-- (pending -> approved/declined -> (approved only) completed).
--
-- Note: no `co2` column here on purpose — CO2 is a unit property
-- (units.co2_control), not something duplicated onto a requisition. A
-- future "CO2 required" field on the request form should filter/match
-- against units.co2_control when picking a candidate unit.
create table requisitions (
  id                uuid primary key default gen_random_uuid(),

  -- who's asking
  researcher_id     uuid references profiles(id),       -- who submitted it, IF logged in.
                                                          -- Null for now — no SSO yet, see
                                                          -- the RLS policies migration.
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
