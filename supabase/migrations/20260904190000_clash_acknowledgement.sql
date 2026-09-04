-- Lets an admin dismiss the "overlapping requisitions" warning on a
-- cabinet when two bookings genuinely are meant to run concurrently
-- (e.g. a documented exception), rather than the warning being purely a
-- computed, unsuppressable fact every time the page loads.
--
-- Stores which specific set of booking ids was acknowledged, not just a
-- bare boolean — if the overlap later changes (a booking's dates move, a
-- third one joins it), that's a materially different situation and the
-- warning should reappear rather than staying silently dismissed forever.
alter table units add column acknowledged_clash_booking_ids uuid[] default array[]::uuid[];
