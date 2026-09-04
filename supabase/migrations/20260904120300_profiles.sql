-- Profiles: one row per person who can log in. Supabase Auth already stores
-- login identity in auth.users; this table adds the app-specific bits: role,
-- and (for researchers) which lab they're in.
--
-- Not wired up to real SSO yet (Microsoft Entra ID, later) — this table and
-- the trigger below are ready and waiting for that, but nothing in the app
-- creates logged-in users today.
create table profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  full_name     text not null,
  role          user_role not null default 'researcher',
  lab_group_id  uuid references lab_groups(id),
  phone         text,
  created_at    timestamptz not null default now()
);

-- Auto-create a profile row the moment someone signs up, so you never have
-- to remember to do it manually.
create function handle_new_user()
returns trigger as $$
begin
  insert into profiles (id, full_name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email), 'researcher');
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();
