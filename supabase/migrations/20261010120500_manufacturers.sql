-- Admin-manageable unit manufacturers - previously a hardcoded frontend
-- list (MANUFACTURERS in App.jsx). Same pattern as rooms: units.manufacturer
-- stays free text (deliberately not a foreign key), so removing a
-- manufacturer here only stops it being offered for new units and never
-- touches existing ones.
create table manufacturers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  created_at  timestamptz not null default now()
);

alter table manufacturers enable row level security;
create policy "read manufacturers" on manufacturers for select using (is_admin());
create policy "admin write manufacturers" on manufacturers for all using (is_admin()) with check (is_admin());

-- Seeded from the list the frontend previously hardcoded, plus any
-- manufacturer already in use on a unit.
insert into manufacturers (name)
select name from (values ('Conviron'), ('Percival'), ('Sanyo/Panasonic'), ('Snijders'), ('BioChambers')) as v(name)
union
select distinct manufacturer from units where manufacturer is not null and manufacturer <> ''
on conflict (name) do nothing;
