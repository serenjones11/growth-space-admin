-- Lets an admin delete a PI/lab group (e.g. a PI has left) even if it has
-- historical requisitions/bookings/profiles pointing at it — same
-- rationale as requisitions.assigned_unit_id's earlier ON DELETE SET NULL:
-- preserve the requisition/booking/profile record itself, just clear the
-- now-gone lab group reference, instead of blocking the delete or
-- cascading away history.
alter table requisitions
  drop constraint requisitions_lab_group_id_fkey,
  add constraint requisitions_lab_group_id_fkey
    foreign key (lab_group_id) references lab_groups(id) on delete set null;

alter table bookings
  drop constraint bookings_lab_group_id_fkey,
  add constraint bookings_lab_group_id_fkey
    foreign key (lab_group_id) references lab_groups(id) on delete set null;

alter table profiles
  drop constraint profiles_lab_group_id_fkey,
  add constraint profiles_lab_group_id_fkey
    foreign key (lab_group_id) references lab_groups(id) on delete set null;
