-- What each unit is currently set to (shown on its inventory tile), all
-- optional - independent of whichever requisition is using it. Light
-- intensity is in µmol/m²/s (PPFD).
alter table units
  add column if not exists set_day_temp numeric,
  add column if not exists set_night_temp numeric,
  add column if not exists set_humidity numeric,
  add column if not exists set_light_cycle text,
  add column if not exists set_light_intensity numeric;

-- Admin-manageable light cycle list, previously hardcoded (LIGHT_CYCLES in
-- App.jsx). Public read, like species_options: the anonymous request form
-- offers it. Values stay free text wherever they're used (requisitions,
-- bookings, units) - a custom one-off cycle is still allowed on the form.
create table light_cycle_options (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  created_at  timestamptz not null default now()
);

alter table light_cycle_options enable row level security;
create policy "public read light_cycle_options" on light_cycle_options for select using (true);
create policy "admin write light_cycle_options" on light_cycle_options for all using (is_admin()) with check (is_admin());

insert into light_cycle_options (name) values
  ('8/16 h (L/D)'), ('12/12 h (L/D)'), ('16/8 h (L/D)'), ('24 h dark'), ('Continuous light')
on conflict (name) do nothing;

-- Renames carry through to records already using the old name, like rooms
-- and manufacturers do: a fixed misspelling is fixed everywhere. One
-- transaction each, so a clash with an existing name changes nothing.
create or replace function rename_species_option(p_id uuid, p_name text)
returns void as $$
declare
  opt species_options;
begin
  if not is_admin() then
    raise exception 'Only admins can rename species';
  end if;
  select * into opt from species_options where id = p_id;
  if opt.id is null then
    raise exception 'Species not found';
  end if;
  update species_options set name = p_name where id = p_id;
  update requisitions set species = array_replace(species, opt.name, p_name)
    where discipline::text = opt.discipline and opt.name = any(species);
  update bookings set species = array_replace(species, opt.name, p_name)
    where discipline::text = opt.discipline and opt.name = any(species);
end;
$$ language plpgsql security definer set search_path = public;
revoke execute on function rename_species_option(uuid, text) from public, anon;
grant execute on function rename_species_option(uuid, text) to authenticated;

create or replace function rename_light_cycle_option(p_id uuid, p_name text)
returns void as $$
declare
  old_name text;
begin
  if not is_admin() then
    raise exception 'Only admins can rename light cycles';
  end if;
  select name into old_name from light_cycle_options where id = p_id;
  if old_name is null then
    raise exception 'Light cycle not found';
  end if;
  update light_cycle_options set name = p_name where id = p_id;
  update units set set_light_cycle = p_name where set_light_cycle = old_name;
  update requisitions set light_cycle = p_name where light_cycle = old_name;
  update bookings set light_cycle = p_name where light_cycle = old_name;
end;
$$ language plpgsql security definer set search_path = public;
revoke execute on function rename_light_cycle_option(uuid, text) from public, anon;
grant execute on function rename_light_cycle_option(uuid, text) to authenticated;
