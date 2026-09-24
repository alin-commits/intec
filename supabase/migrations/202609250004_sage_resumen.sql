-- Resumen mensual de las ventas de Sage, para que lo pida el panel.
--
-- En la tabla hay una fila por día, serie y comercial: con cuatro años de
-- histórico son decenas de miles. Traérselas todas al navegador para sumarlas
-- allí sería lento y absurdo, así que la base de datos las agrupa por mes y
-- devuelve solo lo que el panel va a pintar.
--
-- Es security invoker a propósito: se aplican las reglas de quien pregunta, así
-- que solo dirección y administración obtienen algo.

create or replace function public.sage_sales_summary(
  p_from date,
  p_to date,
  p_basis text default 'albaran'
)
returns table (
  month text,
  company_code smallint,
  series text,
  rep_code integer,
  documents bigint,
  net_amount numeric,
  cost_amount numeric,
  net_without_cost numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    to_char(s.day, 'YYYY-MM') as month,
    s.company_code,
    s.series,
    s.rep_code,
    sum(s.documents)::bigint    as documents,
    sum(s.net_amount)           as net_amount,
    sum(s.cost_amount)          as cost_amount,
    sum(s.net_without_cost)     as net_without_cost
  from public.sage_sales_daily s
  where s.basis = p_basis
    and s.day >= p_from
    and s.day <= p_to
  group by to_char(s.day, 'YYYY-MM'), s.company_code, s.series, s.rep_code;
$$;

grant execute on function public.sage_sales_summary(date, date, text) to authenticated;

-- Qué años tienen datos, para el selector del panel: sin esto habría que
-- adivinarlos o traerse la tabla entera.
create or replace function public.sage_sales_years()
returns table (year integer, days bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select extract(year from s.day)::integer as year, count(distinct s.day)::bigint as days
  from public.sage_sales_daily s
  where s.basis = 'albaran'
  group by extract(year from s.day)
  order by 1 desc;
$$;

grant execute on function public.sage_sales_years() to authenticated;

create index if not exists sage_sales_daily_basis_day_idx on public.sage_sales_daily (basis, day);
