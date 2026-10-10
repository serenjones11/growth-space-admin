-- Day/night temperatures: set_temp is now the day temperature (existing
-- values carry over as-is) and night_temp is the new night-time setpoint.
-- Optional, like set_temp. Bookings carry the same denormalized snapshot.
alter table requisitions add column if not exists night_temp numeric;
alter table bookings     add column if not exists night_temp numeric;

-- Insect requisitions: "I have read and understood the Invertebrate
-- Welfare Policy" acknowledgement, alongside the plant-only pest_consent.
alter table requisitions add column if not exists invertebrate_welfare_ack boolean not null default false;
