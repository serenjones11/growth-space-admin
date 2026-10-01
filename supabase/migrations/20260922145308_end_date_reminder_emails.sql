-- Automated "requisition ending soon" email, sent once per requisition when
-- its end_date is ~2 weeks out. Time-based (not row-trigger-based like the
-- existing new_requisition/requisition_assigned emails), so this needs
-- pg_cron rather than an AFTER INSERT/UPDATE trigger.

alter table requisitions add column end_date_reminder_sent_at timestamptz;

create extension if not exists pg_cron;

-- Claims due requisitions and fires the webhook per id, reusing the existing
-- notify_requisition_webhook() helper (silently no-ops if the vault secret
-- isn't set — never blocks anything). The UPDATE...RETURNING claims and
-- marks-sent in the same statement, and the whole function runs in one
-- transaction, so a failure can't leave "sent" set without the webhook
-- actually having been enqueued, or vice versa. A 2-day window (not a
-- single-day match) means a missed daily run still catches it the next day;
-- end_date_reminder_sent_at IS NULL guarantees it only ever fires once.
create or replace function send_end_date_reminders()
returns void as $$
declare
  r record;
begin
  for r in
    update requisitions
    set end_date_reminder_sent_at = now()
    where status = 'approved'
      and end_date_reminder_sent_at is null
      and end_date between current_date + 13 and current_date + 14
    returning id
  loop
    perform notify_requisition_webhook(
      jsonb_build_object('type', 'end_date_reminder', 'requisitionId', r.id)
    );
  end loop;
end;
$$ language plpgsql security definer set search_path = public;
revoke execute on function send_end_date_reminders() from public, anon, authenticated;

select cron.schedule('send-end-date-reminders', '0 7 * * *', $$select send_end_date_reminders();$$);
