-- Fixes a gap found while testing find_or_create_lab_group(): when a call
-- matched an existing row by NAME (not a fresh create), any email supplied
-- on that call was never saved to the row. A later call with a
-- differently-spelled name but the same email therefore couldn't match by
-- email either, and created an avoidable duplicate pending row — exactly
-- the kind of "obvious duplicate" this feature is meant to prevent.
--
-- Fix: backfill the email onto a name-matched row when it doesn't have one
-- yet, so later email-based matching actually works for it.
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

  if p_pi_email is not null then
    select id into v_id from lab_groups where lower(pi_email) = lower(p_pi_email) limit 1;
    if v_id is not null then
      return v_id;
    end if;
  end if;

  v_norm_name := regexp_replace(lower(p_pi_name), '\s+', ' ', 'g');
  select id into v_id from lab_groups
    where regexp_replace(lower(pi_name), '\s+', ' ', 'g') = v_norm_name
    limit 1;
  if v_id is not null then
    if p_pi_email is not null then
      update lab_groups set pi_email = p_pi_email where id = v_id and pi_email is null;
    end if;
    return v_id;
  end if;

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
