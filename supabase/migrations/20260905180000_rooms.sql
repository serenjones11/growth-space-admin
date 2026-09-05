-- Rooms were previously a hardcoded frontend list (ROOMS_BY_FLOOR /
-- REFTECH_ROOMS_BY_FLOOR in App.jsx) with no way to add one beyond a
-- redeploy, and no way to remove one at all. This makes them a real
-- admin-manageable lookup table, the same pattern as maintenance_categories.
--
-- units.room stays a free-text column (deliberately not a foreign key here)
-- — a unit's room is a snapshot at creation time, so deleting a room from
-- this lookup table must never cascade into or block existing units.
create table rooms (
  id          uuid primary key default gen_random_uuid(),
  floor       text not null,
  type        unit_type not null,
  name        text not null,
  created_at  timestamptz not null default now(),
  unique (floor, type, name)
);

alter table rooms enable row level security;
create policy "read rooms" on rooms for select using (is_admin());
create policy "admin write rooms" on rooms for all using (is_admin()) with check (is_admin());

-- Seeded from the exact set the frontend previously hardcoded, so no
-- currently-selectable room disappears from the dropdown on this migration.
insert into rooms (floor, type, name) values
  ('LG',  'cabinet', 'Room LG.03'),
  ('LG',  'cabinet', 'Room LG.07'),
  ('L1',  'cabinet', 'Room 1.04'),
  ('L1',  'cabinet', 'Room 1.09'),
  ('L1',  'cabinet', 'Room 1.15'),
  ('L2A', 'cabinet', 'Room 2A.02'),
  ('L2A', 'cabinet', 'Room 2A.11'),
  ('L2B', 'cabinet', 'Room 2B.05'),
  ('L2B', 'cabinet', 'Room 2B.14'),
  ('L3',  'cabinet', 'Room 3.06'),
  ('L3',  'cabinet', 'Room 3.12'),
  ('L3',  'cabinet', 'Room 3.20'),
  ('LG',  'reftech', 'Reftech Room LG-A'),
  ('L1',  'reftech', 'Reftech Room 1-A'),
  ('L2A', 'reftech', 'Reftech Room 2A-A'),
  ('L2A', 'reftech', 'Reftech Room 2A-B'),
  ('L2B', 'reftech', 'Reftech Room 2B-A'),
  ('L3',  'reftech', 'Reftech Room 3-A'),
  ('L3',  'reftech', 'Reftech Room 3-B');
