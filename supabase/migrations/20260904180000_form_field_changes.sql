-- Batch of small schema changes matching a round of form/UI feedback:
-- - last_bulb_fitting is dropped from units — bulb changes are logged as a
--   service_log entry instead of a dedicated field.
-- - number_of_plants is dropped from requisitions — no longer collected on
--   the Request Space form.
-- - admin_notes (requisitions) and notes (units) are new freeform fields
--   for admin-only internal notes, distinct from a researcher's own
--   `requisitions.notes`.
alter table units drop column last_bulb_fitting;
alter table units add column notes text;

alter table requisitions drop column number_of_plants;
alter table requisitions add column admin_notes text;
