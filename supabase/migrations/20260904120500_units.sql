-- Units: growth cabinets & Reftech rooms.
-- Human-readable IDs ("GC-041", "RTR-03") are the primary key, matching how
-- the app already refers to them everywhere.
--
-- is_out_of_service is the ONLY occupancy fact ever stored on a unit.
-- Free vs occupied is never stored — it's always computed at query time
-- from bookings (see the unit_current_bookings / unit_current_occupancy
-- views migration). Storing a free/occupied column invites drift between it
-- and the actual booking rows.
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
