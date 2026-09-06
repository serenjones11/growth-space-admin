-- Human-readable requisition codes ("R26-0001") assigned automatically on
-- submission — a stable short reference researchers/admins can say out loud
-- or search for, instead of a UUID or "whichever one titled X".
create table requisition_code_counters (
  year      int primary key,
  next_seq  int not null default 1
);

-- BEFORE INSERT (not after) so new.code is set on the row as it's written,
-- in the same statement — no follow-up update needed. The UPDATE below
-- takes a row lock on that year's counter row, so concurrent submissions
-- in the same year can never be handed the same sequence number.
create or replace function assign_requisition_code()
returns trigger as $$
declare
  v_year int := extract(year from now())::int;
  v_seq  int;
begin
  insert into requisition_code_counters (year, next_seq) values (v_year, 1)
    on conflict (year) do nothing;

  update requisition_code_counters
    set next_seq = next_seq + 1
    where year = v_year
    returning next_seq - 1 into v_seq;

  new.code := 'R' || lpad((v_year % 100)::text, 2, '0') || '-' || lpad(v_seq::text, 4, '0');
  return new;
end;
$$ language plpgsql security definer set search_path = public;
revoke execute on function assign_requisition_code() from public, anon, authenticated;

alter table requisitions add column code text unique;

create trigger trg_assign_requisition_code
  before insert on requisitions
  for each row execute procedure assign_requisition_code();

-- Backfill existing rows in submission order, then fast-forward each
-- year's counter past what backfill just used so the next real submission
-- continues the sequence instead of colliding with it. A no-op on a fresh
-- database with no existing requisitions.
do $$
declare
  r record;
  v_year int;
  v_seq int;
begin
  for r in select id, submitted_date from requisitions order by submitted_date asc loop
    v_year := extract(year from r.submitted_date)::int;
    insert into requisition_code_counters (year, next_seq) values (v_year, 1)
      on conflict (year) do nothing;
    update requisition_code_counters set next_seq = next_seq + 1 where year = v_year returning next_seq - 1 into v_seq;
    update requisitions set code = 'R' || lpad((v_year % 100)::text, 2, '0') || '-' || lpad(v_seq::text, 4, '0') where id = r.id;
  end loop;
end $$;
