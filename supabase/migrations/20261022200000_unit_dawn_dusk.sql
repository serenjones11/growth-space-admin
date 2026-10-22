-- A unit's current lights-on (dawn) and lights-off (dusk) times, set on the
-- add/edit CER form alongside its other current settings and shown on its
-- inventory tile as a day bar.
alter table units
  add column if not exists set_dawn_time time,
  add column if not exists set_dusk_time time;
