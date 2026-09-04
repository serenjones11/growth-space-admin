-- Discipline (plant/insect) is now purely a requisition/booking-level
-- concept, never a fixed property of a unit — any cabinet can be assigned
-- to any requisition regardless of discipline (a cabinet grows whatever
-- it's currently booked for, not one thing forever). What discipline a
-- unit is "doing" right now is derived live from its current
-- occupant/booking, not stored.
alter table units drop column discipline;
