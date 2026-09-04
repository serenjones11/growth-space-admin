-- Service log: Maintenance History entries per unit.
create table service_log (
  id           uuid primary key default gen_random_uuid(),
  unit_id      text not null references units(id) on delete cascade,
  category_id  uuid references maintenance_categories(id),
  status       maintenance_status not null default 'completed',
  date         date not null,
  contractor   text,
  notes        text,
  cost         numeric,
  created_by   uuid references profiles(id),
  created_at   timestamptz not null default now()
);

create index idx_service_log_unit on service_log(unit_id);
