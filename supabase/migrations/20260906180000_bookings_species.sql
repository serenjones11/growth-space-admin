-- Reftech rooms can hold several ongoing requisitions at once, and the
-- inventory tile needs to show each one's species without a separate
-- lookup — same reasoning as project_title/discipline/set_temp already
-- being denormalized onto bookings at approval time (see
-- bookingFieldsFromRequisition in src/lib/api.js).
alter table bookings add column species text[] default array[]::text[];
