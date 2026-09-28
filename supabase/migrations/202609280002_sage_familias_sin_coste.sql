-- La venta por familia también separa lo que no tiene coste grabado.
--
-- Como en las ventas: si una línea sin coste se contara como si no costara
-- nada, el margen de su familia saldría más alto de lo que es. Guardándola
-- aparte, el panel calcula el margen solo sobre lo que sí tiene coste.

alter table public.sage_family_sales_daily
  add column if not exists net_without_cost numeric(14, 2) not null default 0;

-- La recepción: igual que antes, más la columna nueva en las familias.
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
    insert into sage_family_sales_daily (company_code, day, family_code, units, net_amount, cost_amount, net_without_cost)
    select x.company_code, x.day, coalesce(x.family_code, ''), coalesce(x.units, 0), x.net_amount,
           coalesce(x.cost_amount, 0), coalesce(x.net_without_cost, 0)
    from jsonb_to_recordset(p->'family_sales') as x(company_code smallint, day date, family_code text, units numeric,
         net_amount numeric, cost_amount numeric, net_without_cost numeric);
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

revoke all on function public.sage_ingest(jsonb) from public, anon, authenticated;
grant execute on function public.sage_ingest(jsonb) to service_role;

-- El resumen por familia devuelve también la venta sin coste de la parte fiable.
-- Cambia lo que devuelve, así que hay que quitarla y volver a crearla.
drop function if exists public.sage_family_summary(date, date, date);
create function public.sage_family_summary(p_from date, p_to date, p_cost_from date default date '2025-11-01')
returns table (company_code smallint, family_code text, family_name text, units numeric, net_amount numeric,
               trusted_net numeric, trusted_cost numeric, trusted_without_cost numeric)
language sql
stable
security invoker
set search_path = public
as $$
  select f.company_code, f.family_code, max(n.name), sum(f.units), sum(f.net_amount),
         coalesce(sum(f.net_amount) filter (where f.day >= p_cost_from), 0),
         coalesce(sum(f.cost_amount) filter (where f.day >= p_cost_from), 0),
         coalesce(sum(f.net_without_cost) filter (where f.day >= p_cost_from), 0)
  from public.sage_family_sales_daily f
  left join public.sage_families n on n.company_code = f.company_code and n.code = f.family_code
  where f.day between p_from and p_to
  group by f.company_code, f.family_code;
$$;

-- En Postgres las funciones nuevas las puede ejecutar "public" (y con ello
-- cualquiera sin sesión). No devolverían nada por las reglas de las tablas, pero
-- mejor cerrado: solo usuarios con sesión.
revoke execute on function public.sage_family_summary(date, date, date) from public, anon;
grant execute on function public.sage_family_summary(date, date, date) to authenticated;
revoke execute on function public.sage_orders_summary(date, date) from public, anon;
grant execute on function public.sage_orders_summary(date, date) to authenticated;
