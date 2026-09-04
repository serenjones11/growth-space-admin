-- Documents: PDFs attached to a unit (manuals, certificates, risk
-- assessments).
create table documents (
  id          uuid primary key default gen_random_uuid(),
  unit_id     text not null references units(id) on delete cascade,
  name        text not null,
  type        text not null default 'Manual',   -- Manual / Certificate / Risk Assessment / ...
  storage_path text,                             -- path in the Supabase Storage bucket
  added_by    uuid references profiles(id),
  date        date not null default current_date,
  created_at  timestamptz not null default now()
);

create index idx_documents_unit on documents(unit_id);
