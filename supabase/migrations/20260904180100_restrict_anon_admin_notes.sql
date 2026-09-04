-- requisitions.admin_notes is meant to be admin-authored only. The
-- app's own JS never lets an anonymous submission set it (see api.js's
-- updateAdminNotes, the only code path that writes this column), but that
-- alone doesn't stop a raw/crafted request sent directly to the REST API
-- bypassing the app entirely — the "public can submit a requisition
-- (pre-SSO)" INSERT policy's with check only required researcher_id is
-- null, not anything about admin_notes. A malicious anonymous submitter
-- could otherwise plant fake admin-looking text in a field admins trust
-- as admin-authored. Require it to be null at insert time too, enforced
-- by Postgres itself regardless of what any client sends.
drop policy "public can submit a requisition (pre-SSO)" on requisitions;
create policy "public can submit a requisition (pre-SSO)" on requisitions for insert
  to anon
  with check (researcher_id is null and admin_notes is null);
