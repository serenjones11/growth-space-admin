-- Approving bookings on a cabinet to overlap ("Approve clash", or sharing a
-- cabinet between two requisitions) adds their ids to
-- units.acknowledged_clash_booking_ids. Done here in one UPDATE rather than
-- a read-then-write from the browser, so two admins doing it at once can't
-- overwrite each other's. p_requisition_id adds that requisition's booking
-- too (made by sync_booking_from_requisition when it was approved/moved).
-- SECURITY INVOKER: the "admin write units" policy still decides who can.
create or replace function approve_unit_overlap(p_unit_id text, p_booking_ids uuid[], p_requisition_id uuid default null)
returns void as $$
  update units set acknowledged_clash_booking_ids = array(
    select distinct x from unnest(
      coalesce(acknowledged_clash_booking_ids, '{}'::uuid[])
      || coalesce(p_booking_ids, '{}'::uuid[])
      || coalesce((select array_agg(b.id) from bookings b where b.requisition_id = p_requisition_id), '{}'::uuid[])
    ) as x
  )
  where id = p_unit_id;
$$ language sql security invoker set search_path = public;
revoke execute on function approve_unit_overlap(text, uuid[], uuid) from public, anon;
grant execute on function approve_unit_overlap(text, uuid[], uuid) to authenticated;
