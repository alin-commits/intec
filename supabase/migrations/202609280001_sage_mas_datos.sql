-- Más datos de Sage y una recepción que no deja días a medias.
--
-- 1. Lo nuevo que manda el agente, siempre en totales (ni clientes con nombre,
--    ni documentos, ni precios):
--      - ofertas y pedidos por día, serie y comercial;
--      - venta por familia de artículo y día;
--      - clientes activos y nuevos por mes;
--      - dos fotos del día: la cartera de pedidos pendientes de servir y los
--        clientes que han dejado de comprar;
--      - la estructura de las tablas de Sage que interesan (solo nombres de
--        columnas), para poder ampliar la lectura sin entrar en el servidor.
--
-- 2. `sage_ingest`: el envío entero se guarda en una sola transacción. Antes se
--    borraban los días y luego se escribían por trozos; si el envío se cortaba
--    a mitad (pasó dos veces el 25/09), esos días se quedaban vacíos hasta la
--    siguiente lectura. Ahora o entra todo o no se toca nada. Y dos envíos a la
--    vez (el de la noche y el de cada hora) se ponen en fila en vez de pisarse.
--
-- Quién lo ve: dirección y administración, como las ventas. Escribir, solo el
-- servidor con el rol de servicio.

-- ---------- Ofertas y pedidos por día ----------
create table if not exists public.sage_orders_daily (
  id bigint generated always as identity primary key,
  company_code smallint not null references public.sage_companies(code) on delete cascade,
  kind text not null check (kind in ('oferta', 'pedido')),
  day date not null,
  series text not null default '',
  rep_code integer,
  documents integer not null default 0,
  net_amount numeric(14, 2) not null default 0
);
-- Como en las ventas: un índice único para las filas con comercial y otro para
-- las que no, porque un índice único normal considera distintos dos nulos.
create unique index if not exists sage_orders_daily_con_comercial_idx
  on public.sage_orders_daily (company_code, kind, day, series, rep_code) where rep_code is not null;
create unique index if not exists sage_orders_daily_sin_comercial_idx
  on public.sage_orders_daily (company_code, kind, day, series) where rep_code is null;
create index if not exists sage_orders_daily_kind_day_idx on public.sage_orders_daily (kind, day);

-- ---------- Venta por familia de artículo y día ----------
-- Sale de las líneas de los albaranes, fechadas por el albarán. Puede no cuadrar
-- al euro con la venta total por los descuentos que se aplican en la cabecera.
create table if not exists public.sage_family_sales_daily (
  id bigint generated always as identity primary key,
  company_code smallint not null references public.sage_companies(code) on delete cascade,
  day date not null,
  family_code text not null default '',
  units numeric(14, 2) not null default 0,
  net_amount numeric(14, 2) not null default 0,
  cost_amount numeric(14, 2) not null default 0
);
create unique index if not exists sage_family_sales_daily_key_idx
  on public.sage_family_sales_daily (company_code, day, family_code);
create index if not exists sage_family_sales_daily_day_idx on public.sage_family_sales_daily (day);

create table if not exists public.sage_families (
  company_code smallint not null references public.sage_companies(code) on delete cascade,
  code text not null,
  name text not null,
  updated_at timestamptz not null default now(),
  primary key (company_code, code)
);

-- ---------- Clientes por mes (solo cuántos) ----------
-- "Nuevo" es el que compra por primera vez ese mes en esa sociedad. Los primeros
-- meses del histórico todos parecen nuevos, porque antes no hay datos en Sage:
-- el panel no los cuenta como tales.
create table if not exists public.sage_customers_monthly (
  company_code smallint not null references public.sage_companies(code) on delete cascade,
  month date not null check (extract(day from month) = 1),
  active_customers integer not null default 0,
  new_customers integer not null default 0,
  primary key (company_code, month)
);

-- ---------- Fotos del día ----------
-- 'pedidos_pendientes': pedidos de los últimos 12 meses con algo por servir.
-- 'clientes_dormidos': clientes que compraron en los 12 meses anteriores a los
-- últimos 90 días y desde entonces nada; `amount` es lo que compraban.
create table if not exists public.sage_snapshots (
  id bigint generated always as identity primary key,
  taken_on date not null,
  company_code smallint not null references public.sage_companies(code) on delete cascade,
  metric text not null check (metric in ('pedidos_pendientes', 'clientes_dormidos')),
  rep_code integer,
  count integer not null default 0,
  amount numeric(14, 2) not null default 0
);
create unique index if not exists sage_snapshots_con_comercial_idx
  on public.sage_snapshots (taken_on, company_code, metric, rep_code) where rep_code is not null;
create unique index if not exists sage_snapshots_sin_comercial_idx
  on public.sage_snapshots (taken_on, company_code, metric) where rep_code is null;
create index if not exists sage_snapshots_metric_idx on public.sage_snapshots (metric, taken_on desc);

-- ---------- Estructura de Sage (solo nombres, ningún dato) ----------
create table if not exists public.sage_schema_columns (
  table_name text not null,
  column_name text not null,
  data_type text not null default '',
  reported_at timestamptz not null default now(),
  primary key (table_name, column_name)
);

-- ---------- Quién puede ver esto ----------
alter table public.sage_orders_daily enable row level security;
alter table public.sage_family_sales_daily enable row level security;
alter table public.sage_families enable row level security;
alter table public.sage_customers_monthly enable row level security;
alter table public.sage_snapshots enable row level security;
alter table public.sage_schema_columns enable row level security;

drop policy if exists sage_orders_daily_read on public.sage_orders_daily;
create policy sage_orders_daily_read on public.sage_orders_daily
for select to authenticated
  using ((select public.current_user_has_any_role(ARRAY['admin','direction']::app_role[])));

drop policy if exists sage_family_sales_daily_read on public.sage_family_sales_daily;
create policy sage_family_sales_daily_read on public.sage_family_sales_daily
for select to authenticated
  using ((select public.current_user_has_any_role(ARRAY['admin','direction']::app_role[])));

drop policy if exists sage_families_read on public.sage_families;
create policy sage_families_read on public.sage_families
for select to authenticated
  using ((select public.current_user_has_any_role(ARRAY['admin','direction']::app_role[])));

drop policy if exists sage_customers_monthly_read on public.sage_customers_monthly;
create policy sage_customers_monthly_read on public.sage_customers_monthly
for select to authenticated
  using ((select public.current_user_has_any_role(ARRAY['admin','direction']::app_role[])));

drop policy if exists sage_snapshots_read on public.sage_snapshots;
create policy sage_snapshots_read on public.sage_snapshots
for select to authenticated
  using ((select public.current_user_has_any_role(ARRAY['admin','direction']::app_role[])));

-- La estructura de Sage solo le sirve a administración.
drop policy if exists sage_schema_columns_read on public.sage_schema_columns;
create policy sage_schema_columns_read on public.sage_schema_columns
for select to authenticated
  using ((select public.current_user_has_any_role(ARRAY['admin']::app_role[])));

-- ---------- La recepción, en una sola transacción ----------
-- Cada bloque del envío solo se toca si viene en `p`: un agente antiguo que no
-- manda familias no borra las familias que ya hay. Los días se reescriben
-- enteros dentro de la ventana, así una corrección o un borrado en Sage dejan
-- de contar sin tener que adivinarlo. Devuelve cuántas filas entraron de cada.
create or replace function public.sage_ingest(p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_from date := (p->>'covered_from')::date;
  v_to date := (p->>'covered_to')::date;
  v_taken date := coalesce((p->>'taken_on')::date, current_date);
  v_counts jsonb := '{}'::jsonb;
  v_n integer;
begin
  if v_from is null or v_to is null or v_to < v_from then
    raise exception 'Ventana de fechas no válida: % a %', v_from, v_to;
  end if;

  -- El de la noche y el de cada hora pueden coincidir: el segundo espera a que
  -- termine el primero en vez de borrar y escribir los mismos días a la vez.
  perform pg_advisory_xact_lock(hashtext('public.sage_ingest'));

  if jsonb_typeof(p->'companies') = 'array' then
    insert into sage_companies (code, name, is_active, updated_at)
    select x.code, x.name, coalesce(x.is_active, true), now()
    from jsonb_to_recordset(p->'companies') as x(code smallint, name text, is_active boolean)
    on conflict (code) do update set name = excluded.name, is_active = excluded.is_active, updated_at = now();
  end if;

  if jsonb_typeof(p->'reps') = 'array' then
    -- `person`, el nombre unificado entre sociedades, se rellena a mano y no se pisa.
    insert into sage_reps (company_code, code, name, is_person, updated_at)
    select x.company_code, x.code, x.name, coalesce(x.is_person, true), now()
    from jsonb_to_recordset(p->'reps') as x(company_code smallint, code integer, name text, is_person boolean)
    on conflict (company_code, code) do update set name = excluded.name, is_person = excluded.is_person, updated_at = now();
  end if;

  if jsonb_typeof(p->'sales') = 'array' then
    delete from sage_sales_daily where day between v_from and v_to;
    insert into sage_sales_daily (company_code, basis, day, series, rep_code, documents, net_amount, cost_amount, vat_amount, net_without_cost)
    select x.company_code, x.basis, x.day, coalesce(x.series, ''), x.rep_code, x.documents,
           x.net_amount, x.cost_amount, x.vat_amount, coalesce(x.net_without_cost, 0)
    from jsonb_to_recordset(p->'sales') as x(company_code smallint, basis text, day date, series text, rep_code integer,
         documents integer, net_amount numeric, cost_amount numeric, vat_amount numeric, net_without_cost numeric);
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('sales', v_n);
  end if;

  -- Ofertas y pedidos van por separado: si el agente solo pudo leer una de las
  -- dos, la otra no se toca.
  if jsonb_typeof(p->'offers') = 'array' then
    delete from sage_orders_daily where kind = 'oferta' and day between v_from and v_to;
    insert into sage_orders_daily (company_code, kind, day, series, rep_code, documents, net_amount)
    select x.company_code, 'oferta', x.day, coalesce(x.series, ''), x.rep_code, x.documents, x.net_amount
    from jsonb_to_recordset(p->'offers') as x(company_code smallint, day date, series text, rep_code integer, documents integer, net_amount numeric);
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('offers', v_n);
  end if;

  if jsonb_typeof(p->'orders') = 'array' then
    delete from sage_orders_daily where kind = 'pedido' and day between v_from and v_to;
    insert into sage_orders_daily (company_code, kind, day, series, rep_code, documents, net_amount)
    select x.company_code, 'pedido', x.day, coalesce(x.series, ''), x.rep_code, x.documents, x.net_amount
    from jsonb_to_recordset(p->'orders') as x(company_code smallint, day date, series text, rep_code integer, documents integer, net_amount numeric);
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('orders', v_n);
  end if;

  if jsonb_typeof(p->'families') = 'array' then
    insert into sage_families (company_code, code, name, updated_at)
    select x.company_code, x.code, x.name, now()
    from jsonb_to_recordset(p->'families') as x(company_code smallint, code text, name text)
    on conflict (company_code, code) do update set name = excluded.name, updated_at = now();
  end if;

  if jsonb_typeof(p->'family_sales') = 'array' then
    delete from sage_family_sales_daily where day between v_from and v_to;
    insert into sage_family_sales_daily (company_code, day, family_code, units, net_amount, cost_amount)
    select x.company_code, x.day, coalesce(x.family_code, ''), coalesce(x.units, 0), x.net_amount, coalesce(x.cost_amount, 0)
    from jsonb_to_recordset(p->'family_sales') as x(company_code smallint, day date, family_code text, units numeric, net_amount numeric, cost_amount numeric);
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('family_sales', v_n);
  end if;

  -- Los clientes se cuentan por mes entero: la ventana de días se amplía a los
  -- meses que toca, que el agente recalcula completos.
  if jsonb_typeof(p->'customers') = 'array' then
    delete from sage_customers_monthly
    where month between date_trunc('month', v_from)::date and date_trunc('month', v_to)::date;
    insert into sage_customers_monthly (company_code, month, active_customers, new_customers)
    select x.company_code, x.month, x.active_customers, x.new_customers
    from jsonb_to_recordset(p->'customers') as x(company_code smallint, month date, active_customers integer, new_customers integer);
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('customers', v_n);
  end if;

  -- Las fotos del día se sustituyen por la última que llegue ese mismo día.
  if jsonb_typeof(p->'backlog') = 'array' then
    delete from sage_snapshots where metric = 'pedidos_pendientes' and taken_on = v_taken;
    insert into sage_snapshots (taken_on, company_code, metric, rep_code, count, amount)
    select v_taken, x.company_code, 'pedidos_pendientes', x.rep_code, x.count, x.amount
    from jsonb_to_recordset(p->'backlog') as x(company_code smallint, rep_code integer, count integer, amount numeric);
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('backlog', v_n);
  end if;

  if jsonb_typeof(p->'dormant') = 'array' then
    delete from sage_snapshots where metric = 'clientes_dormidos' and taken_on = v_taken;
    insert into sage_snapshots (taken_on, company_code, metric, rep_code, count, amount)
    select v_taken, x.company_code, 'clientes_dormidos', null, x.count, x.amount
    from jsonb_to_recordset(p->'dormant') as x(company_code smallint, count integer, amount numeric);
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('dormant', v_n);
  end if;

  if jsonb_typeof(p->'schema') = 'array' then
    delete from sage_schema_columns where true;
    insert into sage_schema_columns (table_name, column_name, data_type, reported_at)
    select distinct on (x.table_name, x.column_name) x.table_name, x.column_name, coalesce(x.data_type, ''), now()
    from jsonb_to_recordset(p->'schema') as x(table_name text, column_name text, data_type text)
    where x.table_name is not null and x.column_name is not null;
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('schema', v_n);
  end if;

  return v_counts;
end;
$$;

-- Solo la ruta del servidor, con el rol de servicio. Supabase da permiso de
-- ejecución a todo el mundo por defecto en las funciones nuevas: se quita.
revoke all on function public.sage_ingest(jsonb) from public, anon, authenticated;
grant execute on function public.sage_ingest(jsonb) to service_role;

-- ---------- Resúmenes para el panel ----------
-- Como el de ventas: la base de datos agrupa por mes y devuelve solo lo que se
-- pinta. Security invoker, así que solo dirección y administración obtienen algo.
create or replace function public.sage_orders_summary(p_from date, p_to date)
returns table (month text, company_code smallint, kind text, rep_code integer, documents bigint, net_amount numeric)
language sql
stable
security invoker
set search_path = public
as $$
  select to_char(o.day, 'YYYY-MM'), o.company_code, o.kind, o.rep_code, sum(o.documents)::bigint, sum(o.net_amount)
  from public.sage_orders_daily o
  where o.day between p_from and p_to
  group by to_char(o.day, 'YYYY-MM'), o.company_code, o.kind, o.rep_code;
$$;

-- El coste de las series antiguas de Sage no vale (ver el panel): se devuelve
-- aparte la parte de venta y coste desde `p_cost_from`, que es la que sirve.
create or replace function public.sage_family_summary(p_from date, p_to date, p_cost_from date default date '2025-11-01')
returns table (company_code smallint, family_code text, family_name text, units numeric, net_amount numeric,
               trusted_net numeric, trusted_cost numeric)
language sql
stable
security invoker
set search_path = public
as $$
  select f.company_code, f.family_code, max(n.name), sum(f.units), sum(f.net_amount),
         coalesce(sum(f.net_amount) filter (where f.day >= p_cost_from), 0),
         coalesce(sum(f.cost_amount) filter (where f.day >= p_cost_from), 0)
  from public.sage_family_sales_daily f
  left join public.sage_families n on n.company_code = f.company_code and n.code = f.family_code
  where f.day between p_from and p_to
  group by f.company_code, f.family_code;
$$;

grant execute on function public.sage_orders_summary(date, date) to authenticated;
grant execute on function public.sage_family_summary(date, date, date) to authenticated;
revoke execute on function public.sage_orders_summary(date, date) from anon;
revoke execute on function public.sage_family_summary(date, date, date) from anon;
