-- NOT YET APPLIED to the live project: the Supabase connector holds
-- statements like these for the owner to approve. Apply it from the Supabase
-- SQL editor, then mirror it into schema.sql (FKs in their create tables,
-- and remove the seven "read <table>" policies listed below).
--
-- Hardening from a full code review (part 2 of 2; see
-- 20261022120000_review_hardening.sql):
--   1. Profiles referenced as decided_by/completed_by/created_by/added_by
--      no longer block deleting that user (ON DELETE SET NULL).
--   2. Duplicate SELECT policies dropped.

-- ---------------------------------------------------------------------------
-- 1. Deleting a user no longer fails on the records they touched
-- ---------------------------------------------------------------------------
alter table requisitions drop constraint requisitions_decided_by_fkey,
  add constraint requisitions_decided_by_fkey foreign key (decided_by) references profiles(id) on delete set null;
alter table requisitions drop constraint requisitions_completed_by_fkey,
  add constraint requisitions_completed_by_fkey foreign key (completed_by) references profiles(id) on delete set null;
alter table requisitions drop constraint requisitions_researcher_id_fkey,
  add constraint requisitions_researcher_id_fkey foreign key (researcher_id) references profiles(id) on delete set null;
alter table service_log drop constraint service_log_created_by_fkey,
  add constraint service_log_created_by_fkey foreign key (created_by) references profiles(id) on delete set null;
alter table documents drop constraint documents_added_by_fkey,
  add constraint documents_added_by_fkey foreign key (added_by) references profiles(id) on delete set null;

-- ---------------------------------------------------------------------------
-- 2. Duplicate policies
-- ---------------------------------------------------------------------------
-- Each of these duplicated the SELECT half of the table's "admin write"
-- (FOR ALL, is_admin()) policy.
drop policy "read bookings" on bookings;
drop policy "read documents" on documents;
drop policy "read maintenance_categories" on maintenance_categories;
drop policy "read manufacturers" on manufacturers;
drop policy "read rooms" on rooms;
drop policy "read service_log" on service_log;
drop policy "read units" on units;
