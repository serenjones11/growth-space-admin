-- Renaming a CER (its ID) from the edit form. units.id is the primary key
-- that bookings, service_log, documents and requisitions point to, so the
-- unit and every reference must change together. Making those foreign keys
-- DEFERRABLE lets rename_unit() update them all in one transaction, checked
-- at commit; they behave exactly as before everywhere else (INITIALLY
-- IMMEDIATE).
alter table bookings alter constraint bookings_unit_id_fkey deferrable initially immediate;
alter table service_log alter constraint service_log_unit_id_fkey deferrable initially immediate;
alter table documents alter constraint documents_unit_id_fkey deferrable initially immediate;
alter table requisitions alter constraint requisitions_assigned_unit_id_fkey deferrable initially immediate;

-- Renaming moves a requisition's assigned_unit_id, which would otherwise
-- look like a reassignment and re-send the "approved and assigned" email.
create or replace function trg_notify_requisition_assigned_fn()
returns trigger as $$
begin
  if current_setting('app.reverting_amendment', true) = 'on'
     or current_setting('app.renaming_unit', true) = 'on' then
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

create or replace function rename_unit(p_old text, p_new text)
returns void as $$
begin
  if not is_admin() then
    raise exception 'Only admins can rename units';
  end if;
  p_new := trim(p_new);
  if p_new is null or p_new = '' then
    raise exception 'Enter a cabinet / room ID.';
  end if;
  if p_new = p_old then
    return;
  end if;
  if exists (select 1 from units where id = p_new) then
    raise exception 'A unit with the ID "%" already exists.', p_new;
  end if;

  set constraints bookings_unit_id_fkey, service_log_unit_id_fkey, documents_unit_id_fkey,
    requisitions_assigned_unit_id_fkey deferred;
  perform set_config('app.renaming_unit', 'on', true);
  update units set id = p_new where id = p_old;
  if not found then
    raise exception 'That unit wasn''t found.';
  end if;
  update bookings set unit_id = p_new where unit_id = p_old;
  update service_log set unit_id = p_new where unit_id = p_old;
  update documents set unit_id = p_new where unit_id = p_old;
  update requisitions set assigned_unit_id = p_new where assigned_unit_id = p_old;
  update activity_log set unit_id = p_new where unit_id = p_old; -- keeps feed links working
  perform set_config('app.renaming_unit', 'off', true);
end;
$$ language plpgsql security definer set search_path = public;
revoke execute on function rename_unit(text, text) from public, anon;
grant execute on function rename_unit(text, text) to authenticated;
