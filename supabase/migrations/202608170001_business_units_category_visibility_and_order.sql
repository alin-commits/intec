alter table public.business_units
  add column sort_order integer not null default 0,
  add column visible_in_consultas boolean not null default true,
  add column visible_in_leads boolean not null default true;

with ranked as (
  select id, row_number() over (order by name) - 1 as rn
  from public.business_units
)
update public.business_units bu
set sort_order = ranked.rn
from ranked
where ranked.id = bu.id;

create index business_units_sort_order_idx on public.business_units(sort_order);
