-- Hardening from a full code review (part 1 of 2; part 2 is
-- 20261022120100_review_hardening_part2.sql):
--   1. Non-admins (the anonymous request form) can no longer insert or
--      update the admin-only columns of a requisition.
--   2. A requisition's booking is kept in sync by a trigger, so approving,
--      moving or editing an approved requisition is one atomic write.
--   3. Linter clean-up: FK indexes, cached auth.uid() in policies, trigger
--      functions not callable over the API.

-- ---------------------------------------------------------------------------
-- 1. Guard admin-only requisition columns
-- ---------------------------------------------------------------------------
-- The anonymous INSERT policy only checks researcher_id/admin_notes, and anon
-- holds column privileges on every column - so a crafted request could insert
-- a requisition that was already "approved" with a unit assigned. Anything
-- not coming from an admin over the API is reset to what a fresh submission
-- (or a researcher's own amendment) may set. Direct SQL, pg_cron and
-- SECURITY DEFINER functions (no API role) are left alone.
create or replace function guard_requisition_write()
returns trigger as $$
begin
  if coalesce(auth.role(), '') not in ('anon', 'authenticated') then
    return new;
  end if;
  if auth.role() = 'authenticated' and is_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.status := 'pending';
    new.assigned_unit_id := null;
    new.decided_date := null;
    new.decided_by := null;
    new.completed_date := null;
    new.completed_by := null;
    new.admin_notes := null;
    new.amended_at := null;
    new.amended_fields := '{}';
    new.amended_previous := null;
    new.end_date_reminder_sent_at := null;
    new.submitted_date := now();
    new.created_at := now();
  else
    new.researcher_id := old.researcher_id;
    new.code := old.code;
    new.assigned_unit_id := old.assigned_unit_id;
    new.decided_date := old.decided_date;
    new.decided_by := old.decided_by;
    new.completed_date := old.completed_date;
    new.completed_by := old.completed_by;
    new.admin_notes := old.admin_notes;
    new.end_date_reminder_sent_at := old.end_date_reminder_sent_at;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;
revoke execute on function guard_requisition_write() from public, anon, authenticated;

create trigger trg_guard_requisition_write
  before insert or update on requisitions
  for each row execute function guard_requisition_write();

-- ---------------------------------------------------------------------------
-- 2. Keep each approved requisition's booking in sync
-- ---------------------------------------------------------------------------
-- Approving used to be two client requests (write the booking, then the
-- requisition), and editing/moving an approved one likewise - a failure in
-- between left a booking for a pending requisition, or a stale booking. Now
-- the client only writes the requisition and this mirrors it onto its
-- booking in the same transaction. Only while approved: during an
-- amendment's review (status back to pending) the booking deliberately keeps
-- the approved version, and completed/declined bookings are history.
create or replace function sync_booking_from_requisition()
returns trigger as $$
begin
  if new.status <> 'approved' or new.assigned_unit_id is null then
    return null;
  end if;
  update bookings set
    unit_id = new.assigned_unit_id, researcher_name = new.researcher_name, role = new.role,
    lab_group_id = new.lab_group_id, project_title = new.project_title, discipline = new.discipline,
    species = coalesce(new.species, '{}'), set_temp = new.set_temp, night_temp = new.night_temp,
    set_humidity = new.set_humidity, light_cycle = new.light_cycle,
    dawn_time = new.dawn_time, dusk_time = new.dusk_time,
    start_date = new.start_date, end_date = new.end_date
  where requisition_id = new.id;
  if not found then
    insert into bookings (
      unit_id, requisition_id, researcher_name, role, lab_group_id, project_title, discipline,
      species, set_temp, night_temp, set_humidity, light_cycle, dawn_time, dusk_time,
      start_date, end_date
    ) values (
      new.assigned_unit_id, new.id, new.researcher_name, new.role, new.lab_group_id, new.project_title, new.discipline,
      coalesce(new.species, '{}'), new.set_temp, new.night_temp, new.set_humidity, new.light_cycle, new.dawn_time, new.dusk_time,
      new.start_date, new.end_date
    );
  end if;
  return null;
end;
$$ language plpgsql set search_path = public;
revoke execute on function sync_booking_from_requisition() from public, anon, authenticated;

create trigger trg_sync_booking_from_requisition
  after insert or update on requisitions
  for each row execute function sync_booking_from_requisition();

-- Bring existing approved bookings in line (e.g. a researcher name edited
-- on the requisition after approval that never reached its booking).
update requisitions set status = status where status = 'approved' and assigned_unit_id is not null;

-- ---------------------------------------------------------------------------
-- 3. Linter clean-up
-- ---------------------------------------------------------------------------
create index if not exists idx_backup_log_created_by on backup_log(created_by);
create index if not exists idx_bookings_lab_group on bookings(lab_group_id);
create index if not exists idx_documents_added_by on documents(added_by);
create index if not exists idx_profiles_lab_group on profiles(lab_group_id);
create index if not exists idx_requisitions_completed_by on requisitions(completed_by);
create index if not exists idx_requisitions_decided_by on requisitions(decided_by);
create index if not exists idx_requisitions_lab_group on requisitions(lab_group_id);
create index if not exists idx_service_log_category on service_log(category_id);
create index if not exists idx_service_log_created_by on service_log(created_by);

-- auth.uid()/auth.role() evaluated once per query, not once per row.
alter policy "read lab_groups" on lab_groups using ((select auth.role()) = 'authenticated');
alter policy "read profiles" on profiles using (is_admin() or id = (select auth.uid()));
alter policy "update own profile" on profiles using (id = (select auth.uid())) with check (id = (select auth.uid()));
alter policy "read own or all requisitions" on requisitions using (is_admin() or researcher_id = (select auth.uid()));
alter policy "researcher creates own requisition" on requisitions with check (researcher_id = (select auth.uid()));
alter policy "researcher amends own pending requisition" on requisitions
  using (researcher_id = (select auth.uid()) and status = 'pending')
  with check (researcher_id = (select auth.uid()) and status = 'pending');
alter policy "read own notification_preferences" on notification_preferences using (admin_id = (select auth.uid()));
alter policy "insert own notification_preferences" on notification_preferences with check (is_admin() and admin_id = (select auth.uid()));
alter policy "update own notification_preferences" on notification_preferences
  using (admin_id = (select auth.uid())) with check (admin_id = (select auth.uid()));
alter policy "admin insert backup_log" on backup_log with check (is_admin() and created_by = (select auth.uid()));

-- Trigger functions, never meant to be called over /rest/v1/rpc.
revoke execute on function log_lab_group_delete() from public, anon, authenticated;
revoke execute on function log_lab_group_insert() from public, anon, authenticated;
revoke execute on function log_requisition_delete() from public, anon, authenticated;
revoke execute on function log_unit_delete() from public, anon, authenticated;
revoke execute on function log_unit_insert() from public, anon, authenticated;
revoke execute on function set_updated_at() from public, anon, authenticated;
