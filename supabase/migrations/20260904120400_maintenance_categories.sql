-- Maintenance categories: admin-manageable, matches the app's "Manage
-- categories" feature (Calibration, Routine Maintenance, etc.)
create table maintenance_categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  bg_hex      text not null default '#EFF6FF',
  ink_hex     text not null default '#1D4ED8',
  border_hex  text not null default '#C7DDFB',
  created_at  timestamptz not null default now()
);

insert into maintenance_categories (name, bg_hex, ink_hex, border_hex) values
  ('Calibration',         '#F5F3FF', '#6D28D9', '#DDD6FE'),
  ('Routine Maintenance', '#EFF6FF', '#1D4ED8', '#C7DDFB'),
  ('Inspection',          '#FEF9EC', '#92400E', '#FBE7B8'),
  ('Repair',               '#FDF2F2', '#B23A34', '#F5D0CE'),
  ('Cleaning',            '#ECFDF3', '#15803D', '#BBF0CE');
