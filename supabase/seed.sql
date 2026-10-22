-- Sample data for the TEST project ("CER App (test)") only - never run this
-- on the live project. Everything here is made up. Run it after schema.sql,
-- in the test project's SQL editor. Dates are relative to today, so the app
-- always shows a mix of current, ending-soon, overdue, upcoming and pending.
--
-- Approved requisitions get their bookings from the
-- sync_booking_from_requisition trigger, and requisition codes come from
-- assign_requisition_code, so neither is inserted here. No emails are sent:
-- the test project has no webhook secret in Vault.

insert into units (id, type, floor, room, manufacturer, model, shelves, lighting_type, ballasts, co2_control, dimming_control,
                   temp_min, temp_max, humidity_min, humidity_max, install_date, set_day_temp, set_night_temp, set_humidity, set_light_cycle)
select v.id, v.type::unit_type, v.floor,
       coalesce((select name from rooms r where r.floor = v.floor and r.type = v.type::unit_type order by name limit 1), 'Room ' || v.floor),
       v.manufacturer, v.model, v.shelves, 'LED', 'Electronic', v.co2, v.dim, 4, 35, 30, 90, current_date - 400,
       v.day, v.night, v.rh, v.cycle
from (values
  ('TEST-GC-01', 'cabinet', 'L1',  'Conviron',  'E-15',    3, true,  false, 22, 18, 60, '16/8h (L/D)'),
  ('TEST-GC-02', 'cabinet', 'L1',  'Percival',  'AR-66',   4, false, false, null, null, null, null),
  ('TEST-GC-03', 'cabinet', 'L2A', 'Snijders',  'MLR-352', 3, true,  true,  25, 20, 65, '12/12h (L/D)'),
  ('TEST-GC-04', 'cabinet', 'L3',  'Conviron',  'GC-8',    5, false, false, null, null, null, null),
  ('TEST-R-01',  'reftech', 'LG',  'Conviron',  'Room',    null, true, true, null, null, null, null)
) as v(id, type, floor, manufacturer, model, shelves, co2, dim, day, night, rh, cycle);

insert into requisitions (researcher_name, email, role, emergency_number, lab_group_id, pi_name, unit_type, discipline,
                          species, containment_level, project_title, set_temp, night_temp, set_humidity, light_cycle,
                          pest_consent, invertebrate_welfare_ack, safety_compliance, preferred_floor, start_date, end_date,
                          status, assigned_unit_id, decided_date, completed_date, notes)
select v.researcher, v.email, 'PhD Student', '07000 000000', lg.id, lg.pi_name, v.unit_type::unit_type, v.discipline::discipline_type,
       v.species, case when v.discipline = 'plant' then 'Wild-Type' end, v.title, 22, 18, 60, '16/8h (L/D)',
       v.discipline = 'plant', v.discipline = 'insect', true, 'any', current_date + v.start_offset, current_date + v.end_offset,
       v.status::requisition_status, v.unit,
       case when v.status <> 'pending' then now() - interval '7 days' end,
       case when v.status = 'completed' then now() - interval '1 day' end,
       'Sample data'
from (values
  ('Test Researcher A', 'researcher.a@example.com', 'Okafor Lab',   'cabinet', 'plant',  array['Arabidopsis thaliana'], 'Salt stress trial',     -30,  60, 'approved',  'TEST-GC-01'),
  ('Test Researcher B', 'researcher.b@example.com', 'Petrova Lab',  'cabinet', 'plant',  array['Wheat'],                'Drought response',      -40,   1, 'approved',  'TEST-GC-03'),
  ('Test Researcher C', 'researcher.c@example.com', 'Chen Lab',     'cabinet', 'plant',  array['Tomato'],               'Fruit set timing',      -60,  -3, 'approved',  'TEST-GC-04'),
  ('Test Researcher D', 'researcher.d@example.com', 'Singh Lab',    'reftech', 'insect', array['Locusta migratoria'],   'Swarm behaviour',       -20, 120, 'approved',  'TEST-R-01'),
  ('Test Researcher E', 'researcher.e@example.com', 'Martins Lab',  'reftech', 'plant',  array['Barley'],               'Cold tolerance',         14,  90, 'approved',  'TEST-R-01'),
  ('Test Researcher F', 'researcher.f@example.com', 'Novak Lab',    'cabinet', 'plant',  array['Maize'],                'Root architecture',      10,  70, 'pending',   null),
  ('Test Researcher G', 'researcher.g@example.com', 'Al-Farsi Lab', 'reftech', 'insect', array['Bombus terrestris'],    'Pollination study',      21, 100, 'pending',   null),
  ('Test Researcher H', 'researcher.h@example.com', 'Whitfield Lab','cabinet', 'plant',  array['Rice'],                 'Flooding tolerance',   -200, -90, 'completed', 'TEST-GC-02'),
  ('Test Researcher I', 'researcher.i@example.com', 'Chen Lab',     'cabinet', 'plant',  array['Pea'],                  'Nodulation',           -100, -50, 'declined',  null)
) as v(researcher, email, lab, unit_type, discipline, species, title, start_offset, end_offset, status, unit)
join lab_groups lg on lg.name = v.lab;

-- A completed requisition's booking was made while it was approved; the
-- trigger only creates bookings for approved ones, so add this one directly.
insert into bookings (unit_id, requisition_id, researcher_name, role, lab_group_id, project_title, discipline, species, start_date, end_date)
select r.assigned_unit_id, r.id, r.researcher_name, r.role, r.lab_group_id, r.project_title, r.discipline, r.species, r.start_date, r.end_date
from requisitions r where r.status = 'completed' and r.notes = 'Sample data';

insert into service_log (unit_id, category_id, status, date, contractor, notes, cost)
select v.unit, (select id from maintenance_categories order by name limit 1 offset v.cat), v.status::maintenance_status,
       current_date + v.day_offset, v.contractor, v.notes, v.cost
from (values
  ('TEST-GC-01', 0, 'completed', -45, 'Sample Contractor Ltd', 'Annual service',   120.00),
  ('TEST-GC-03', 1, 'completed', -10, 'Sample Contractor Ltd', 'Replaced bulbs',    35.50),
  ('TEST-GC-04', 0, 'scheduled',  20, null,                    'Annual service due', null)
) as v(unit, cat, status, day_offset, contractor, notes, cost);
