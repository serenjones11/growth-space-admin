-- Regression check for the requisition write guard and booking sync
-- (supabase/migrations/20261022120000_review_hardening.sql).
--
-- Paste into the Supabase SQL editor and run. It changes nothing: every
-- step runs inside one transaction that the final RAISE rolls back. The
-- error message it ends with IS the result - each step should read as
-- noted in the comments; anything else is a regression.
-- Needs at least one admin profile, and units GC-02 and GC-03 to exist
-- (swap in any two unit ids if not).
do $t$
declare
  admin_id uuid := (select id from profiles where role = 'admin' limit 1);
  rid uuid; r requisitions; b bookings; n int; out text := '';
begin
  -- 1. Anonymous visitor tries to submit an already-approved, back-dated
  --    requisition. Expect: status=pending unit=null decided=null submitted_today=t
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('role', 'anon', true);
  insert into requisitions (researcher_name, email, unit_type, discipline, project_title, start_date, end_date,
                            status, assigned_unit_id, decided_date, submitted_date)
  values ('Regression Test', 'test@example.com', 'cabinet', 'plant', 'zz regression test', '2030-01-01', '2030-02-01',
          'approved', 'GC-02', now(), '2020-01-01');
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  select * into r from requisitions where project_title = 'zz regression test';
  rid := r.id;
  out := out || format('1 anon insert: status=%s unit=%s decided=%s submitted_today=%s | ',
    r.status, coalesce(r.assigned_unit_id, 'null'), coalesce(r.decided_date::text, 'null'), r.submitted_date::date = current_date);

  -- From here on, act as an admin.
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', admin_id)::text, true);
  perform set_config('role', 'authenticated', true);

  -- 2. Approve. Expect: a booking on GC-02 for 2030-01-01..2030-02-01.
  update requisitions set status = 'approved', assigned_unit_id = 'GC-02', decided_date = now(), decided_by = admin_id where id = rid;
  select * into b from bookings where requisition_id = rid;
  out := out || format('2 approve: unit=%s %s..%s | ', b.unit_id, b.start_date, b.end_date);

  -- 3. Edit the approved requisition. Expect: booking start=2030-01-05.
  update requisitions set start_date = '2030-01-05' where id = rid;
  select * into b from bookings where requisition_id = rid;
  out := out || format('3 edit: start=%s | ', b.start_date);

  -- 4. Move it. Expect: unit=GC-03, still exactly 1 booking.
  update requisitions set assigned_unit_id = 'GC-03' where id = rid;
  select count(*) into n from bookings where requisition_id = rid;
  select * into b from bookings where requisition_id = rid;
  out := out || format('4 move: unit=%s bookings=%s | ', b.unit_id, n);

  -- 5. Amendment under review. Expect: booking end stays 2030-02-01.
  update requisitions set status = 'pending', end_date = '2030-03-01', submitted_date = now() + interval '1 minute' where id = rid;
  select * into b from bookings where requisition_id = rid;
  out := out || format('5 amend: booking end=%s | ', b.end_date);

  -- 6. Decline the amendment. Expect: status=approved, end back to 2030-02-01.
  perform decline_amendment(rid);
  select * into r from requisitions where id = rid;
  out := out || format('6 decline: status=%s end=%s | ', r.status, r.end_date);

  -- 7. Complete it, then edit. Expect: booking keeps the pre-edit name.
  update requisitions set status = 'completed', completed_date = now(), completed_by = admin_id where id = rid;
  update requisitions set researcher_name = 'Changed After Completion' where id = rid;
  select * into b from bookings where requisition_id = rid;
  out := out || format('7 completed: booking name=%s', b.researcher_name);

  raise exception 'RESULT (rolled back): %', out;
end
$t$;
