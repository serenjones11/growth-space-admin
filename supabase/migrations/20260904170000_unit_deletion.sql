-- Allows a unit (cabinet or reftech room) to be deleted even if it has
-- historical requisitions pointing at it. bookings/service_log/documents
-- already cascade-delete on unit removal; requisitions.assigned_unit_id
-- didn't, which would otherwise block deleting any unit that was ever
-- assigned to a requisition (i.e. almost any unit that's actually been
-- used) with a foreign key error. Switching to ON DELETE SET NULL
-- preserves the requisition record itself (researcher, PI, dates, status
-- — the audit trail) while just clearing the now-gone unit reference,
-- instead of either blocking the delete or cascading away requisition
-- history.
--
-- (Admins already have full DELETE access to units via the existing
-- "admin write units ... for all" policy — no RLS change needed here.)
alter table requisitions
  drop constraint requisitions_assigned_unit_id_fkey,
  add constraint requisitions_assigned_unit_id_fkey
    foreign key (assigned_unit_id) references units(id) on delete set null;
