-- "Recent activity" on the dashboard was entirely inferred from current
-- table state (a unit's occupant, a requisition's status) — which works
-- for anything that's still there, but can never recover an event whose
-- row is now gone: a deleted unit, a deleted PI, a deleted requisition.
-- This adds a real, durable log for exactly the events that inference
-- can't cover, written by triggers so it's correct regardless of which
-- code path (admin action, anon self-registration RPC, etc.) caused the
-- change — not by scattering manual logging calls through the app.
--
-- Booking-assigned and requisition status-change events are deliberately
-- NOT logged here — those still work fine via live inference (the row is
-- still there), so logging them too would just duplicate every entry.
create table activity_log (
  id          uuid primary key default gen_random_uuid(),
  type        text not null,   -- 'unit_added' | 'unit_deleted' | 'lab_group_added' | 'lab_group_deleted' | 'requisition_deleted'
  title       text not null,
  subtitle    text,
  -- Deliberately NOT a foreign key: this row must survive the referenced
  -- unit/etc. being deleted (that's the entire point of this table), so it
  -- can't have a constraint that would block or cascade with the delete.
  unit_id     text,
  created_at  timestamptz not null default now()
);

alter table activity_log enable row level security;
create policy "read activity_log" on activity_log for select using (is_admin());
-- No insert/update/delete policy for any client role — only the trigger
-- functions below write to it, running as SECURITY DEFINER (so they
-- bypass RLS as the table owner, the same pattern as is_admin() itself).

create or replace function log_unit_insert()
returns trigger as $$
begin
  insert into activity_log (type, title, subtitle, unit_id, created_at)
  values (
    'unit_added',
    new.id || ' added to inventory',
    (case when new.type = 'reftech' then 'Reftech room' else 'Growth cabinet' end) || ' · ' || new.floor || ', ' || new.room,
    new.id,
    new.created_at
  );
  return new;
end;
$$ language plpgsql security definer set search_path = public;
create trigger trg_log_unit_insert after insert on units for each row execute procedure log_unit_insert();

create or replace function log_unit_delete()
returns trigger as $$
begin
  insert into activity_log (type, title, subtitle, unit_id, created_at)
  values (
    'unit_deleted',
    old.id || ' removed from inventory',
    (case when old.type = 'reftech' then 'Reftech room' else 'Growth cabinet' end) || ' · was ' || old.floor || ', ' || old.room,
    old.id,
    now()
  );
  return old;
end;
$$ language plpgsql security definer set search_path = public;
create trigger trg_log_unit_delete after delete on units for each row execute procedure log_unit_delete();

create or replace function log_lab_group_insert()
returns trigger as $$
begin
  insert into activity_log (type, title, subtitle, created_at)
  values (
    'lab_group_added',
    new.pi_name || ' added as a PI',
    new.name || (case when not new.is_verified then ' · pending review' else '' end),
    new.created_at
  );
  return new;
end;
$$ language plpgsql security definer set search_path = public;
create trigger trg_log_lab_group_insert after insert on lab_groups for each row execute procedure log_lab_group_insert();

create or replace function log_lab_group_delete()
returns trigger as $$
begin
  insert into activity_log (type, title, subtitle, created_at)
  values ('lab_group_deleted', old.pi_name || ' removed from PI list', old.name, now());
  return old;
end;
$$ language plpgsql security definer set search_path = public;
create trigger trg_log_lab_group_delete after delete on lab_groups for each row execute procedure log_lab_group_delete();

create or replace function log_requisition_delete()
returns trigger as $$
begin
  insert into activity_log (type, title, subtitle, created_at)
  values ('requisition_deleted', old.project_title || ' requisition deleted', old.researcher_name, now());
  return old;
end;
$$ language plpgsql security definer set search_path = public;
create trigger trg_log_requisition_delete after delete on requisitions for each row execute procedure log_requisition_delete();
