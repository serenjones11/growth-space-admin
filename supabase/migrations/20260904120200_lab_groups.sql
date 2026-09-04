-- Lab groups: a real table instead of a hardcoded list in the frontend,
-- so an admin can add a new lab group without a code change.
create table lab_groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,        -- e.g. "Okafor Lab"
  pi_name     text not null,               -- e.g. "James Okafor"
  colour_hex  text,                        -- optional: pin a chart colour per lab
  created_at  timestamptz not null default now()
);
