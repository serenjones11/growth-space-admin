-- Allows an admin to permanently delete a requisition (e.g. a mistaken
-- entry, or plain cleanup) — previously there was deliberately no DELETE
-- path at all, kept as an audit trail. The user has now decided that
-- trade-off isn't worth the inconvenience of not being able to remove one.
--
-- bookings.requisition_id switches to ON DELETE CASCADE (not SET NULL like
-- units/lab_groups elsewhere): a booking only exists as a direct
-- consequence of the requisition that got it approved, unlike a unit or
-- lab group which are independent entities merely referenced by it. If
-- the requisition itself is gone, there's nothing left for that booking to
-- be a record of, so it should go with it rather than become an orphan
-- with no requisition behind it.
alter table bookings
  drop constraint bookings_requisition_id_fkey,
  add constraint bookings_requisition_id_fkey
    foreign key (requisition_id) references requisitions(id) on delete cascade;

create policy "admin deletes any requisition" on requisitions for delete using (is_admin());
