-- If an admin moves a requisition's end date after its "ending soon"
-- reminder has gone out (typically an extension), clear the sent marker so
-- send_end_date_reminders() reminds again ahead of the new end date.
create or replace function reset_end_date_reminder()
returns trigger as $$
begin
  if new.end_date is distinct from old.end_date then
    new.end_date_reminder_sent_at := null;
  end if;
  return new;
end;
$$ language plpgsql set search_path = public;
revoke execute on function reset_end_date_reminder() from public, anon, authenticated;

create trigger trg_reset_end_date_reminder
  before update of end_date on requisitions
  for each row execute procedure reset_end_date_reminder();
