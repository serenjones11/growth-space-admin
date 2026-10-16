-- One row per "Full backup" an admin downloads from the Dashboard. The
-- newest row is the "Last full backup" date shown next to the button,
-- shared across all admins; the rest is a simple history of who exported
-- when. The backup file itself is downloaded to the admin's computer and
-- never stored here.
create table backup_log (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  created_by   uuid references profiles(id) on delete set null
);

alter table backup_log enable row level security;
create policy "admin read backup_log" on backup_log for select using (is_admin());
create policy "admin insert backup_log" on backup_log for insert with check (is_admin() and created_by = auth.uid());
