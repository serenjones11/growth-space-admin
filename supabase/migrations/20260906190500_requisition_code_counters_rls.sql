-- requisition_code_counters (added in 20260906180500_requisition_codes.sql)
-- never had RLS enabled, so it was directly exposed over PostgREST to any
-- role. It's only ever touched by assign_requisition_code(), a SECURITY
-- DEFINER trigger that runs as the table owner and so bypasses RLS
-- regardless — enabling RLS with no policies just stops anon/authenticated
-- reading or writing it directly.
alter table requisition_code_counters enable row level security;
