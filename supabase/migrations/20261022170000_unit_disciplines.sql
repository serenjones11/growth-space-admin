-- A unit's research area(s), set by owners/users on the add/edit CER form
-- (Plant Sciences, Insect Sciences, or both for a shared reftech room). It
-- drives the discipline pill on the unit tile and the inventory filter, so
-- an empty unit can be filtered too - previously both came from whatever
-- requisitions were booked on it.
alter table units add column disciplines discipline_type[] not null default '{}';

-- Start each unit from what's booked on it now.
update units u set disciplines = sub.d
from (
  select b.unit_id, array_agg(distinct b.discipline order by b.discipline) as d
  from bookings b join requisitions r on r.id = b.requisition_id
  where r.status = 'approved' and b.discipline is not null and b.start_date <= current_date
  group by b.unit_id
) sub
where sub.unit_id = u.id;
