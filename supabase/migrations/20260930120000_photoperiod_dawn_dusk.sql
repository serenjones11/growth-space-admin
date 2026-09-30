-- Dawn/dusk times for a requisition's photoperiod (lights on / lights off),
-- alongside the existing free-text light_cycle. Optional on both tables.
-- Bookings carry the same denormalized snapshot as set_temp/light_cycle.

alter table requisitions
  add column if not exists dawn_time time,
  add column if not exists dusk_time time;

alter table bookings
  add column if not exists dawn_time time,
  add column if not exists dusk_time time;
