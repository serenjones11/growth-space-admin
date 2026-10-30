-- Recent activity, complete. Until now the dashboard feed inferred most
-- entries from current state (a requisition's status, a unit's latest
-- service entry), so it could only ever show the LATEST thing that
-- happened to each row: a requisition moved to another unit, its dates
-- changed, an amendment, a revert, an edit, a second maintenance entry -
-- none of those ever appeared. Now each change worth seeing is written to
-- activity_log as it happens, by triggers (whichever code path made it),
-- with who did it, and the feed reads activity_log alone. Left out on
-- purpose: CER renames and edits, maintenance edits/deletions, staff logins.

alter table activity_log
  add column if not exists requisition_id uuid,   -- not a FK: must outlive a deleted requisition
  add column if not exists actor_name text;       -- who did it, when someone signed in did

-- Name of the signed-in person making the current change (null for a
-- signed-out researcher, a scheduled job or the service role).
create or replace function activity_actor()
returns text as $$
  select nullif(full_name, '') from profiles where id = auth.uid();
$$ language sql stable security definer set search_path = public;
revoke execute on function activity_actor() from public, anon, authenticated;

create or replace function log_activity(p_type text, p_title text, p_subtitle text, p_unit_id text, p_requisition_id uuid)
returns void as $$
begin
  insert into activity_log (type, title, subtitle, unit_id, requisition_id, actor_name)
  values (p_type, p_title, p_subtitle, p_unit_id, p_requisition_id, activity_actor());
end;
$$ language plpgsql security definer set search_path = public;
revoke execute on function log_activity(text, text, text, text, uuid) from public, anon, authenticated;

-- ---- Requisitions ----
create or replace function log_requisition_change()
returns trigger as $$
declare
  who text := coalesce(new.code || ' · ', '') || new.researcher_name;
  dates text := to_char(new.start_date, 'DD/MM/YYYY') || ' to ' || to_char(new.end_date, 'DD/MM/YYYY');
  -- Details an edit can change (dates and unit are logged on their own;
  -- lab_group_id alone changes when a duplicate PI is merged).
  details constant text[] := array[
    'researcher_name', 'email', 'role', 'emergency_number', 'pi_name', 'unit_type', 'discipline',
    'species', 'containment_level', 'space_description', 'project_title', 'project_desc',
    'set_temp', 'night_temp', 'set_humidity', 'light_cycle', 'dawn_time', 'dusk_time',
    'pest_consent', 'invertebrate_welfare_ack', 'dimming_required', 'safety_compliance',
    'preferred_floor', 'hazard_notes', 'notes'
  ];
  o jsonb;
  n jsonb;
  k text;
  edited boolean := false;
begin
  if tg_op = 'INSERT' then
    perform log_activity('requisition_submitted', 'New requisition - ' || new.project_title,
      who || coalesce(' · PI ' || new.pi_name, ''), null, new.id);
    return new;
  end if;

  -- A unit being renamed moves assigned_unit_id; that's logged as the rename.
  if current_setting('app.renaming_unit', true) = 'on' then
    return new;
  end if;

  if old.status is distinct from new.status then
    if new.status = 'pending' and new.amended_at is distinct from old.amended_at then
      perform log_activity('requisition_amended', 'Requisition amended - ' || new.project_title, who, new.assigned_unit_id, new.id);
    elsif old.status = 'pending' and new.status = 'approved' and current_setting('app.reverting_amendment', true) = 'on' then
      perform log_activity('amendment_declined', 'Amendment declined - ' || new.project_title, who || ' · kept the approved version', new.assigned_unit_id, new.id);
    elsif old.status = 'pending' and new.status = 'approved' and old.amended_previous ->> 'status' = 'approved' then
      perform log_activity('amendment_approved', 'Amendment approved - ' || new.project_title, who || ' · ' || coalesce(new.assigned_unit_id, '') || ', ' || dates, new.assigned_unit_id, new.id);
    elsif new.status = 'approved' and old.status = 'pending' then
      perform log_activity('requisition_approved', 'Requisition approved - ' || new.project_title, who || ' · assigned ' || coalesce(new.assigned_unit_id, 'no unit'), new.assigned_unit_id, new.id);
    elsif new.status = 'declined' then
      perform log_activity('requisition_declined', 'Requisition declined - ' || new.project_title, who, null, new.id);
    elsif new.status = 'completed' then
      perform log_activity('requisition_completed', 'Requisition completed - ' || new.project_title, who || coalesce(' · freed ' || new.assigned_unit_id, ''), new.assigned_unit_id, new.id);
    elsif old.status = 'completed' and new.status = 'approved' then
      perform log_activity('requisition_reverted', 'Requisition back to active - ' || new.project_title, who || coalesce(' · on ' || new.assigned_unit_id, ''), new.assigned_unit_id, new.id);
    else
      perform log_activity('requisition_edited', 'Requisition status changed to ' || new.status || ' - ' || new.project_title, who, new.assigned_unit_id, new.id);
    end if;
    return new;
  end if;

  -- A pending request amended again before review.
  if new.amended_at is distinct from old.amended_at and new.status = 'pending' then
    perform log_activity('requisition_amended', 'Requisition amended - ' || new.project_title, who, new.assigned_unit_id, new.id);
    return new;
  end if;

  if new.status = 'approved' and new.assigned_unit_id is distinct from old.assigned_unit_id then
    perform log_activity('requisition_moved', 'Requisition moved - ' || new.project_title,
      who || ' · ' || coalesce(old.assigned_unit_id, 'no unit') || ' to ' || coalesce(new.assigned_unit_id, 'no unit'), new.assigned_unit_id, new.id);
  end if;
  if new.start_date is distinct from old.start_date or new.end_date is distinct from old.end_date then
    perform log_activity('requisition_dates_changed', 'Dates changed - ' || new.project_title, who || ' · now ' || dates, new.assigned_unit_id, new.id);
  end if;

  o := to_jsonb(old);
  n := to_jsonb(new);
  foreach k in array details loop
    if o -> k is distinct from n -> k then edited := true; end if;
  end loop;
  if edited then
    perform log_activity('requisition_edited', 'Requisition details edited - ' || new.project_title, who, new.assigned_unit_id, new.id);
  end if;
  if new.admin_notes is distinct from old.admin_notes then
    perform log_activity('requisition_note', 'Admin notes updated - ' || new.project_title, who, new.assigned_unit_id, new.id);
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;
revoke execute on function log_requisition_change() from public, anon, authenticated;
create or replace trigger trg_log_requisition_change after insert or update on requisitions
  for each row execute procedure log_requisition_change();

-- ---- Units (added/removed are already logged by trg_log_unit_insert/delete;
-- renames and other edits are deliberately left out of the feed) ----
create or replace function log_unit_change()
returns trigger as $$
begin
  if old.is_out_of_service is distinct from new.is_out_of_service then
    if new.is_out_of_service then
      perform log_activity('unit_out_of_service', new.id || ' marked out of service', new.floor || ', ' || new.room, new.id, null);
    else
      perform log_activity('unit_in_service', new.id || ' back in service', new.floor || ', ' || new.room, new.id, null);
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;
revoke execute on function log_unit_change() from public, anon, authenticated;
create or replace trigger trg_log_unit_change after update on units
  for each row execute procedure log_unit_change();

-- ---- Maintenance: logged, scheduled, and scheduled work done (edits and
-- deletions are left out of the feed; the app re-saves every entry when one
-- changes, so only a real scheduled -> completed change is logged) ----
create or replace function log_service_change()
returns trigger as $$
declare
  cat text := (select name from maintenance_categories where id = new.category_id);
  what text := coalesce(cat, 'Maintenance') || coalesce(' · ' || nullif(new.contractor, ''), '');
begin
  if tg_op = 'INSERT' then
    if new.status = 'scheduled' then
      perform log_activity('service_scheduled', new.unit_id || ' maintenance scheduled for ' || to_char(new.date, 'DD/MM/YYYY'), what, new.unit_id, null);
    else
      perform log_activity('service_logged', new.unit_id || ' maintenance logged', what || coalesce(' · ' || nullif(new.notes, ''), ''), new.unit_id, null);
    end if;
  elsif old.status = 'scheduled' and new.status = 'completed' then
    perform log_activity('service_logged', new.unit_id || ' scheduled maintenance done', what, new.unit_id, null);
  end if;
  return null;
end;
$$ language plpgsql security definer set search_path = public;
revoke execute on function log_service_change() from public, anon, authenticated;
create or replace trigger trg_log_service_change after insert or update on service_log
  for each row execute procedure log_service_change();

-- ---- Documents ----
create or replace function log_document_change()
returns trigger as $$
begin
  if tg_op = 'INSERT' then
    perform log_activity('document_added', new.name || ' added to ' || new.unit_id, new.type, new.unit_id, null);
  else
    perform log_activity('document_removed', old.name || ' removed from ' || old.unit_id, old.type, old.unit_id, null);
  end if;
  return null;
end;
$$ language plpgsql security definer set search_path = public;
revoke execute on function log_document_change() from public, anon, authenticated;
create or replace trigger trg_log_document_change after insert or delete on documents
  for each row execute procedure log_document_change();

-- ---- PIs (added/removed are already logged) ----
create or replace function log_lab_group_change()
returns trigger as $$
begin
  if not old.is_verified and new.is_verified then
    perform log_activity('lab_group_approved', new.pi_name || ' approved as a PI', new.name, null, null);
  elsif (old.name, old.pi_name, old.pi_email) is distinct from (new.name, new.pi_name, new.pi_email) then
    perform log_activity('lab_group_edited', new.pi_name || '''s PI details updated', new.name, null, null);
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;
revoke execute on function log_lab_group_change() from public, anon, authenticated;
create or replace trigger trg_log_lab_group_change after update on lab_groups
  for each row execute procedure log_lab_group_change();

-- ---- Backfill: what the old feed used to work out, kept as history ----
insert into activity_log (type, title, subtitle, unit_id, requisition_id, actor_name, created_at)
select 'requisition_submitted', 'New requisition - ' || r.project_title,
       coalesce(r.code || ' · ', '') || r.researcher_name || coalesce(' · PI ' || r.pi_name, ''),
       null, r.id, null, r.created_at
from requisitions r
where not exists (select 1 from activity_log a where a.requisition_id = r.id and a.type = 'requisition_submitted');

insert into activity_log (type, title, subtitle, unit_id, requisition_id, actor_name, created_at)
select case when r.status = 'declined' then 'requisition_declined' else 'requisition_approved' end,
       case when r.status = 'declined' then 'Requisition declined - ' else 'Requisition approved - ' end || r.project_title,
       coalesce(r.code || ' · ', '') || r.researcher_name || case when r.status = 'declined' then '' else ' · assigned ' || coalesce(r.assigned_unit_id, 'no unit') end,
       case when r.status = 'declined' then null else r.assigned_unit_id end, r.id,
       (select nullif(full_name, '') from profiles where id = r.decided_by), r.decided_date
from requisitions r
where r.status in ('approved', 'declined', 'completed') and r.decided_date is not null
  and not exists (select 1 from activity_log a where a.requisition_id = r.id and a.type in ('requisition_approved', 'requisition_declined'));

insert into activity_log (type, title, subtitle, unit_id, requisition_id, actor_name, created_at)
select 'requisition_completed', 'Requisition completed - ' || r.project_title,
       coalesce(r.code || ' · ', '') || r.researcher_name || coalesce(' · freed ' || r.assigned_unit_id, ''),
       r.assigned_unit_id, r.id, (select nullif(full_name, '') from profiles where id = r.completed_by), r.completed_date
from requisitions r
where r.status = 'completed' and r.completed_date is not null
  and not exists (select 1 from activity_log a where a.requisition_id = r.id and a.type = 'requisition_completed');

insert into activity_log (type, title, subtitle, unit_id, requisition_id, actor_name, created_at)
select case when s.status = 'scheduled' then 'service_scheduled' else 'service_logged' end,
       s.unit_id || case when s.status = 'scheduled' then ' maintenance scheduled for ' || to_char(s.date, 'DD/MM/YYYY') else ' maintenance logged' end,
       coalesce(c.name, 'Maintenance') || coalesce(' · ' || nullif(s.contractor, ''), ''),
       s.unit_id, null, (select nullif(full_name, '') from profiles where id = s.created_by), s.created_at
from service_log s left join maintenance_categories c on c.id = s.category_id
where not exists (select 1 from activity_log a where a.unit_id = s.unit_id and a.type in ('service_logged', 'service_scheduled') and a.created_at = s.created_at);

insert into activity_log (type, title, subtitle, unit_id, requisition_id, actor_name, created_at)
select 'document_added', d.name || ' added to ' || d.unit_id, d.type, d.unit_id, null,
       (select nullif(full_name, '') from profiles where id = d.added_by), d.created_at
from documents d
where not exists (select 1 from activity_log a where a.unit_id = d.unit_id and a.type = 'document_added' and a.created_at = d.created_at);

create index if not exists idx_activity_log_created_at on activity_log (created_at desc);
