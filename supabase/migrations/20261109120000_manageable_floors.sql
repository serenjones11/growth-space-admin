-- Floors become a managed list (add / rename / remove from the add/edit unit
-- form), like rooms and manufacturers. Previously a hardcoded list in
-- App.jsx (FLOORS / FLOOR_LABEL) and in the notify-requisition email function.
--
-- `code` is the fixed key stored in units.floor, rooms.floor and
-- requisitions.preferred_floor; renaming a floor only changes `label`, so
-- nothing else needs rewriting. Public read: the anonymous request form
-- offers floors as a preference.
create table if not exists floors (
  code        text primary key,
  label       text not null unique,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);

alter table floors enable row level security;
create policy "public read floors" on floors for select using (true);
create policy "admin write floors" on floors for all using (is_admin()) with check (is_admin());

insert into floors (code, label, sort_order) values
  ('LG', 'LG', 0), ('L1', 'Level 1', 1), ('L2A', 'Level 2a', 2), ('L2B', 'Level 2b', 3), ('L3', 'Level 3', 4)
on conflict (code) do nothing;

-- A floor that still has units can't be removed (the delete fails and the
-- app says why); its rooms list goes with it.
alter table units add constraint units_floor_fkey foreign key (floor) references floors (code) on update cascade on delete restrict;
alter table rooms add constraint rooms_floor_fkey foreign key (floor) references floors (code) on update cascade on delete cascade;
