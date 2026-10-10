-- Amended requisitions: record what a researcher's amendment changed, so
-- pending review can tell an amendment from a new requisition and show the
-- changed fields (and what they were). Also lets an admin decline an
-- amendment to an already-approved requisition without losing the
-- original approval, and emails admins when an amendment comes in.
--
-- An amendment is the Request Space wizard's amend path
-- (api.amendRequisition), the only update that sets submitted_date - admin
-- edits ("Edit details") never touch it, so they're not tracked here.

alter table requisitions
  add column if not exists amended_at timestamptz,
  -- column names changed since the version last reviewed
  add column if not exists amended_fields text[] not null default '{}',
  -- that reviewed version's values for those columns, plus the status,
  -- decision and submitted date it had - what decline_amendment() restores
  add column if not exists amended_previous jsonb;

create or replace function track_requisition_amendment()
returns trigger as $$
declare
  tracked constant text[] := array[
    'researcher_name', 'email', 'role', 'emergency_number', 'lab_group_id', 'pi_name',
    'unit_type', 'discipline', 'species', 'containment_level', 'space_description',
    'project_title', 'project_desc', 'set_temp', 'night_temp', 'set_humidity',
    'light_cycle', 'dawn_time', 'dusk_time', 'pest_consent', 'invertebrate_welfare_ack',
    'dimming_required', 'safety_compliance', 'preferred_floor', 'start_date', 'end_date',
    'hazard_notes', 'notes'
  ];
  o jsonb := to_jsonb(old);
  n jsonb := to_jsonb(new);
  prev jsonb;
  baseline jsonb;
  k text;
begin
  -- decline_amendment() restoring the reviewed version isn't an amendment.
  if current_setting('app.reverting_amendment', true) = 'on' then
    return new;
  end if;

  if new.submitted_date is not distinct from old.submitted_date then
    -- Not an amendment. Only admins may change the amendment record itself.
    if not is_admin() then
      new.amended_at := old.amended_at;
      new.amended_fields := old.amended_fields;
      new.amended_previous := old.amended_previous;
    end if;
    return new;
  end if;

  -- A second amendment before review builds on the first (compared against
  -- the same reviewed version); otherwise this starts a new review cycle.
  if old.status = 'pending' and old.amended_at is not null and old.amended_previous is not null then
    prev := old.amended_previous;
  else
    prev := jsonb_build_object(
      'status', old.status, 'decided_date', old.decided_date,
      'decided_by', old.decided_by, 'submitted_date', old.submitted_date
    );
  end if;

  new.amended_fields := '{}';
  foreach k in array tracked loop
    baseline := case when prev ? k then prev -> k else o -> k end;
    if (n -> k) is distinct from baseline then
      new.amended_fields := new.amended_fields || k;
      prev := prev || jsonb_build_object(k, baseline);
    else
      prev := prev - k;  -- changed back to what was reviewed
    end if;
  end loop;

  new.amended_previous := prev;
  new.amended_at := now();
  return new;
end;
$$ language plpgsql security definer set search_path = public;
revoke execute on function track_requisition_amendment() from public, anon, authenticated;

create trigger trg_track_requisition_amendment
  before update on requisitions
  for each row execute procedure track_requisition_amendment();

-- Admin email for an amendment, like the new-requisition one.
create or replace function trg_notify_requisition_amended_fn()
returns trigger as $$
begin
  if new.submitted_date is distinct from old.submitted_date
     and current_setting('app.reverting_amendment', true) is distinct from 'on' then
    perform notify_requisition_webhook(jsonb_build_object('type', 'requisition_amended', 'requisitionId', new.id));
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;
revoke execute on function trg_notify_requisition_amended_fn() from public, anon, authenticated;

create trigger trg_notify_requisition_amended
  after update on requisitions
  for each row execute procedure trg_notify_requisition_amended_fn();

-- Restoring the reviewed version (decline_amendment) puts the status back
-- to approved - that's not a new approval, so no "approved" email.
create or replace function trg_notify_requisition_assigned_fn()
returns trigger as $$
begin
  if current_setting('app.reverting_amendment', true) = 'on' then
    return new;
  end if;
  if new.status = 'approved' and new.assigned_unit_id is not null and (
    old.status is distinct from new.status
    or old.assigned_unit_id is distinct from new.assigned_unit_id
    or old.start_date is distinct from new.start_date
    or old.end_date is distinct from new.end_date
  ) then
    perform notify_requisition_webhook(jsonb_build_object('type', 'requisition_assigned', 'requisitionId', new.id));
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;
revoke execute on function trg_notify_requisition_assigned_fn() from public, anon, authenticated;

-- Declining an amendment to an already-approved requisition keeps the
-- original approval: every amended field, the status, decision and
-- submitted date go back to the reviewed version. Its booking was never
-- changed by the amendment, so the unit stays as it was.
create or replace function decline_amendment(p_requisition_id uuid)
returns void as $$
declare
  r requisitions;
  restored requisitions;
begin
  if not is_admin() then
    raise exception 'Only admins can decline an amendment';
  end if;
  select * into r from requisitions where id = p_requisition_id for update;
  if r.id is null or r.status <> 'pending' or r.amended_previous ->> 'status' is distinct from 'approved' then
    raise exception 'This requisition has no amendment to an approved requisition awaiting review';
  end if;

  restored := jsonb_populate_record(r, r.amended_previous);
  perform set_config('app.reverting_amendment', 'on', true);
  update requisitions set
    researcher_name = restored.researcher_name, email = restored.email, role = restored.role,
    emergency_number = restored.emergency_number, lab_group_id = restored.lab_group_id,
    pi_name = restored.pi_name, unit_type = restored.unit_type, discipline = restored.discipline,
    species = restored.species, containment_level = restored.containment_level,
    space_description = restored.space_description, project_title = restored.project_title,
    project_desc = restored.project_desc, set_temp = restored.set_temp, night_temp = restored.night_temp,
    set_humidity = restored.set_humidity, light_cycle = restored.light_cycle,
    dawn_time = restored.dawn_time, dusk_time = restored.dusk_time,
    pest_consent = restored.pest_consent, invertebrate_welfare_ack = restored.invertebrate_welfare_ack,
    dimming_required = restored.dimming_required, safety_compliance = restored.safety_compliance,
    preferred_floor = restored.preferred_floor, start_date = restored.start_date,
    end_date = restored.end_date, hazard_notes = restored.hazard_notes, notes = restored.notes,
    status = restored.status, decided_date = restored.decided_date, decided_by = restored.decided_by,
    submitted_date = restored.submitted_date,
    amended_fields = '{}', amended_previous = null
  where id = p_requisition_id;
  perform set_config('app.reverting_amendment', 'off', true);
end;
$$ language plpgsql security definer set search_path = public;
revoke execute on function decline_amendment(uuid) from public, anon;
grant execute on function decline_amendment(uuid) to authenticated;
