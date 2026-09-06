-- Species lists (plant/insect) shown in the request form's species picker
-- were hardcoded frontend consts (PLANT_SPECIES/INSECT_SPECIES). Admins now
-- need to add/edit/delete entries themselves, and the picker is used by
-- anonymous researchers on the public request form — so, unlike rooms
-- (admin-only read), this needs public SELECT and admin-only writes.
create table species_options (
  id           uuid primary key default gen_random_uuid(),
  discipline   text not null check (discipline in ('plant', 'insect')),
  name         text not null,
  created_at   timestamptz not null default now(),
  unique (discipline, name)
);

alter table species_options enable row level security;
create policy "public read species_options" on species_options for select using (true);
create policy "admin write species_options" on species_options for all using (is_admin()) with check (is_admin());

insert into species_options (discipline, name) values
  ('plant', 'Arabidopsis thaliana'),
  ('plant', 'Triticum aestivum (Wheat)'),
  ('plant', 'Hordeum vulgare (Barley)'),
  ('plant', 'Physcomitrella patens (Moss)'),
  ('plant', 'Nicotiana benthamiana'),
  ('insect', 'Drosophila melanogaster'),
  ('insect', 'Tribolium castaneum'),
  ('insect', 'Bombyx mori'),
  ('insect', 'Apis mellifera'),
  ('insect', 'Tenebrio molitor')
on conflict (discipline, name) do nothing;
