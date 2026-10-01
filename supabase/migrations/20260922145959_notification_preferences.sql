-- Per-admin notification preferences: which automated emails they get, and
-- which discipline they want them scoped to. A missing row means defaults
-- (notify=true, scope='all') — enforced in application code (frontend and
-- the notify-requisition Edge Function), not via a proactive insert trigger.
create table notification_preferences (
  admin_id                 uuid primary key references profiles(id) on delete cascade,
  notify_new_requisition   boolean not null default true,
  notify_end_date_reminder boolean not null default true,
  discipline_scope         text not null default 'all' check (discipline_scope in ('all','plant','insect')),
  updated_at               timestamptz not null default now()
);

create trigger trg_notification_preferences_updated_at
  before update on notification_preferences for each row execute procedure set_updated_at();

alter table notification_preferences enable row level security;

-- Self-service only — an admin manages their own notification settings,
-- not anyone else's.
create policy "read own notification_preferences" on notification_preferences
  for select using (admin_id = auth.uid());
create policy "insert own notification_preferences" on notification_preferences
  for insert with check (is_admin() and admin_id = auth.uid());
create policy "update own notification_preferences" on notification_preferences
  for update using (admin_id = auth.uid()) with check (admin_id = auth.uid());
