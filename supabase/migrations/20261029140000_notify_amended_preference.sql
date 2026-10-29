-- Amended-requisition emails get their own switch on the Settings page's
-- email preferences (until now they followed notify_new_requisition).
-- No preference rows existed on either project when this was applied, so
-- there was nothing to carry over.
alter table notification_preferences
  add column if not exists notify_amended_requisition boolean not null default true;
