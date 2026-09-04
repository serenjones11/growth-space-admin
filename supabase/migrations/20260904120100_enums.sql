-- Enums for fields with a fixed, known set of values.
-- Note: there is deliberately no `unit_status` enum. A unit's free/occupied
-- state is never stored — it's computed at query time from bookings (see
-- the unit_current_bookings / unit_current_occupancy views migration). The
-- only independently-set fact stored on a unit is units.is_out_of_service.
create type user_role          as enum ('admin', 'researcher');
create type unit_type          as enum ('cabinet', 'reftech');
create type discipline_type    as enum ('plant', 'insect');
create type requisition_status as enum ('pending', 'approved', 'declined', 'completed');
create type maintenance_status as enum ('completed', 'scheduled');
