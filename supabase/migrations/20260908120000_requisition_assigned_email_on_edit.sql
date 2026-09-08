-- The requester's "assigned" email only fired on the initial approval/
-- assignment (status or assigned_unit_id changing). If an admin later
-- edits an already-approved requisition's dates, or reassigns it to a
-- different unit, the requester never got an updated email — the one they
-- already had would silently go stale. Broaden the trigger to also fire
-- when the fields that email actually shows (dates, assigned unit) change
-- on an already-approved requisition, so the requester always has a
-- current copy. Not fired for every field (e.g. internal notes) — only
-- the ones the assigned-notification email surfaces.
create or replace function trg_notify_requisition_assigned_fn()
returns trigger as $$
begin
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
