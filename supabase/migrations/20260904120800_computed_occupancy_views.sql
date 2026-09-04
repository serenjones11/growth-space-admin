-- Computed occupancy views. Nothing here is stored — a unit's free/occupied
-- state and a booking's overdue/ending-soon state are always derived.
--
-- A booking counts as "current" once its requisition has been approved and
-- its start date has arrived — and it STAYS current (even past its end
-- date) until the requisition is marked completed. That's what lets a
-- lapsed booking show up as overdue instead of silently freeing the unit:
-- overdue = end date has passed AND the linked requisition isn't completed
-- yet, not just "end date < today".
create or replace view unit_current_bookings as
select
  b.*,
  r.status as requisition_status,
  (b.end_date < current_date) as is_overdue,
  (b.end_date >= current_date and b.end_date <= current_date + 2) as is_ending_soon
from bookings b
join requisitions r on r.id = b.requisition_id
where r.status = 'approved'
  and b.start_date <= current_date;

comment on view unit_current_bookings is
  'Bookings that currently occupy their unit: requisition approved (not yet completed) and already started. is_overdue means the end date has passed but nobody has completed the requisition yet.';

-- One row per unit with a single computed status — the direct equivalent of
-- the old prototype's unit.status ('free'/'occupied'/'service'), just
-- computed instead of stored.
create or replace view unit_current_occupancy as
select
  u.id as unit_id,
  case
    when u.is_out_of_service then 'service'
    when exists (select 1 from unit_current_bookings b where b.unit_id = u.id) then 'occupied'
    else 'free'
  end as computed_status,
  exists (
    select 1 from unit_current_bookings b where b.unit_id = u.id and b.is_overdue
  ) as has_overdue_booking,
  exists (
    select 1 from unit_current_bookings b where b.unit_id = u.id and b.is_ending_soon
  ) as has_ending_soon_booking
from units u;

comment on view unit_current_occupancy is
  'Computed free/occupied/service status per unit. Never read units.is_out_of_service directly to answer "is this unit free" — always go through this view (or unit_current_bookings) so occupancy reflects live booking data.';
