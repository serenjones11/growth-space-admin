-- Redesigns how new PIs get added, replacing the previous (reverted at the
-- frontend level) find_or_create_lab_group. That version silently attached
-- a requisition to an existing lab group on an exact name match, or created
-- a brand-new one outright — fine for exact matches, but with no way for an
-- admin to review/merge near-duplicates, and no way to tell a legitimately
-- new PI from one who mistyped an existing name.
--
-- New model: any lab group created by self-registration (a PI filling in
-- the Request Space form themselves, or a researcher using "My PI isn't
-- listed") starts unverified. The public PI picker only ever shows
-- verified entries plus the "not listed" escape hatch, so nothing pending
-- is visible/selectable until an admin reviews it.

alter table lab_groups add column is_verified boolean not null default false;
alter table lab_groups add column pi_email text;

-- Existing (seeded) lab groups are the legitimate, already-established set
-- — mark them verified so they don't vanish from the picker.
update lab_groups set is_verified = true;

-- Superseded by the 2-argument version below (adds email-based matching).
drop function if exists find_or_create_lab_group(text);

-- Public-facing listing: verified entries only. Admins read the full table
-- (including pending ones) directly via their existing RLS access — this
-- function is only for the anonymous/researcher-facing PI picker.
create or replace function list_lab_groups()
returns table(id uuid, name text, pi_name text)
language sql
security definer
stable
set search_path = public
as $$
  select id, name, pi_name from lab_groups where is_verified = true order by pi_name;
$$;

create or replace function find_or_create_lab_group(p_pi_name text, p_pi_email text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_norm_name text;
  v_surname text;
  v_name text;
  v_suffix int := 0;
begin
  p_pi_name := trim(p_pi_name);
  if p_pi_name = '' then
    raise exception 'PI name must not be empty';
  end if;
  p_pi_email := nullif(trim(p_pi_email), '');

  -- Strongest identity signal first: an exact email match, verified or not
  -- (so the same not-yet-verified PI submitting again reuses their pending
  -- row instead of spawning another one).
  if p_pi_email is not null then
    select id into v_id from lab_groups where lower(pi_email) = lower(p_pi_email) limit 1;
    if v_id is not null then
      return v_id;
    end if;
  end if;

  -- Otherwise, an exact (whitespace/case-normalized) name match — avoids an
  -- obvious duplicate for the same PI. Deliberately NOT fuzzy/similarity
  -- matching: a near-miss (e.g. "J. Okafor" vs "James Okafor") still
  -- creates a new pending row rather than risking a wrong auto-merge —
  -- that's what the admin merge tool is for.
  v_norm_name := regexp_replace(lower(p_pi_name), '\s+', ' ', 'g');
  select id into v_id from lab_groups
    where regexp_replace(lower(pi_name), '\s+', ' ', 'g') = v_norm_name
    limit 1;
  if v_id is not null then
    return v_id;
  end if;

  -- No confident match — create a new, unverified entry for an admin to
  -- review. Name matches the existing seed convention ("James Okafor" ->
  -- "Okafor Lab").
  v_surname := (regexp_match(p_pi_name, '(\S+)$'))[1];
  v_name := v_surname || ' Lab';
  while exists (select 1 from lab_groups where name = v_name) loop
    v_suffix := v_suffix + 1;
    v_name := v_surname || ' Lab ' || v_suffix;
  end loop;

  insert into lab_groups (name, pi_name, pi_email, is_verified)
    values (v_name, p_pi_name, p_pi_email, false)
    returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function find_or_create_lab_group(text, text) from public;
grant execute on function find_or_create_lab_group(text, text) to anon, authenticated;

-- list_lab_groups()'s grants were already anon+authenticated from the prior
-- migration and are unaffected by create or replace.
