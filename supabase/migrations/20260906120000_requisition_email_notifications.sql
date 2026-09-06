-- Automated emails: admins get notified when a new requisition comes in,
-- and the requester gets notified once it's approved and assigned a unit.
-- Actual sending happens in the notify-requisition Edge Function (calls
-- Resend); these triggers just fire it asynchronously via pg_net whenever
-- the right change happens on requisitions, so no application code path
-- (admin UI, future API, etc.) can forget to send the notification.
create extension if not exists pg_net with schema extensions;

-- Shared helper: posts to the Edge Function, authenticated by a secret
-- stored in Vault (supabase_vault) rather than hardcoded here or passed
-- from the client — set separately via vault.create_secret(), never
-- committed to a migration file. If it hasn't been set yet, skip quietly:
-- a requisition insert/update must never fail just because email delivery
-- isn't configured yet.
create or replace function notify_requisition_webhook(payload jsonb)
returns void as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'requisition_webhook_secret';
  if v_secret is null then
    return;
  end if;
  perform net.http_post(
    url := 'https://ttyyttkdezvlyldtrcpx.supabase.co/functions/v1/notify-requisition',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_secret),
    body := payload
  );
end;
$$ language plpgsql security definer set search_path = public, net, vault;
revoke execute on function notify_requisition_webhook(jsonb) from public, anon, authenticated;

create or replace function trg_notify_new_requisition_fn()
returns trigger as $$
begin
  perform notify_requisition_webhook(jsonb_build_object('type', 'new_requisition', 'requisitionId', new.id));
  return new;
end;
$$ language plpgsql security definer set search_path = public;
revoke execute on function trg_notify_new_requisition_fn() from public, anon, authenticated;
create trigger trg_notify_new_requisition
  after insert on requisitions
  for each row execute procedure trg_notify_new_requisition_fn();

create or replace function trg_notify_requisition_assigned_fn()
returns trigger as $$
begin
  if new.status = 'approved' and new.assigned_unit_id is not null
     and (old.status is distinct from new.status or old.assigned_unit_id is distinct from new.assigned_unit_id) then
    perform notify_requisition_webhook(jsonb_build_object('type', 'requisition_assigned', 'requisitionId', new.id));
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;
revoke execute on function trg_notify_requisition_assigned_fn() from public, anon, authenticated;
create trigger trg_notify_requisition_assigned
  after update on requisitions
  for each row execute procedure trg_notify_requisition_assigned_fn();
