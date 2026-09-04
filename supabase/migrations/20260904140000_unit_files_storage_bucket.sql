-- Storage bucket for unit photos and documents (manuals/certificates/risk
-- assessments), replacing the frontend's local blob-URL placeholders.
-- Private bucket — photos/documents are inventory data, same access tier
-- as units/service_log/documents under the RLS permission model
-- established earlier (admin-only), not public.
insert into storage.buckets (id, name, public)
values ('unit-files', 'unit-files', false)
on conflict (id) do nothing;

create policy "admin read unit-files" on storage.objects
  for select using (bucket_id = 'unit-files' and is_admin());

create policy "admin write unit-files" on storage.objects
  for insert with check (bucket_id = 'unit-files' and is_admin());

create policy "admin update unit-files" on storage.objects
  for update using (bucket_id = 'unit-files' and is_admin())
  with check (bucket_id = 'unit-files' and is_admin());

create policy "admin delete unit-files" on storage.objects
  for delete using (bucket_id = 'unit-files' and is_admin());
