-- El detalle de Sage para el cuadro de mando comercial (KPIs del PDF de
-- Dirección comercial, salvo cobros).
--
-- Hasta ahora solo llegaban totales. Para poder contestar "a quién hay que
-- llamar" (clientes sin compra, recuperados, perdidos), medir la conversión real
-- de ofertas en pedidos o ver marcas, subfamilias y artículos, hace falta
-- bajar un nivel:
--   - clientes, con nombre y contacto (lo decidió Dirección: las listas tienen
--     que servir para actuar);
--   - lo que compra cada cliente por día y por familia;
--   - artículos (con marca) y su venta por mes;
--   - cada oferta y cada pedido, con su estado, motivo de rechazo, fechas y el
--     enlace oferta → pedido → albarán que guarda Sage;
--   - abonos e incidencias de los albaranes;
--   - las tablas de códigos de Sage (motivos, tipos de cliente...) para poner
--     nombre a los códigos;
--   - el presupuesto de ventas, que no está en Sage y se mete en el Hub.
--
-- Quién lo ve: dirección y administración, como el resto de Sage. Escribir,
-- solo el servidor (rol de servicio); el presupuesto, dirección y administración.

-- ---------- Líneas por albarán (artículos medios por venta) ----------
alter table public.sage_sales_daily add column if not exists lines integer not null default 0;

-- ---------- Clientes ----------
create table if not exists public.sage_customers (
  company_code smallint not null references public.sage_companies(code) on delete cascade,
  code text not null,
  name text not null,
  trade_name text,
  rep_code integer,
  province text,
  municipality text,
  postal_code text,
  activity text,
  customer_type text,
  customer_group text,
  phone text,
  email text,
  created_on date,
  last_action_on date,
  leave_reason text,
  left_on date,
  updated_at timestamptz not null default now(),
  primary key (company_code, code)
);
create index if not exists sage_customers_rep_idx on public.sage_customers (company_code, rep_code);

-- Lo que compra cada cliente cada día, por canal (serie) y comercial.
create table if not exists public.sage_customer_days (
  id bigint generated always as identity primary key,
  company_code smallint not null references public.sage_companies(code) on delete cascade,
  customer_code text not null,
  day date not null,
  series text not null default '',
  rep_code integer,
  documents integer not null default 0,
  lines integer not null default 0,
  net_amount numeric(14, 2) not null default 0,
  cost_amount numeric(14, 2) not null default 0,
  net_without_cost numeric(14, 2) not null default 0
);
create index if not exists sage_customer_days_day_idx on public.sage_customer_days (day);
create index if not exists sage_customer_days_customer_idx on public.sage_customer_days (company_code, customer_code, day);

-- Qué familias compra cada cliente cada mes (recurrencia por familia, venta media).
create table if not exists public.sage_customer_families_monthly (
  id bigint generated always as identity primary key,
  company_code smallint not null references public.sage_companies(code) on delete cascade,
  customer_code text not null,
  month date not null check (extract(day from month) = 1),
  family_code text not null default '',
  net_amount numeric(14, 2) not null default 0,
  cost_amount numeric(14, 2) not null default 0,
  net_without_cost numeric(14, 2) not null default 0
);
create index if not exists sage_customer_families_month_idx on public.sage_customer_families_monthly (month);
create index if not exists sage_customer_families_customer_idx on public.sage_customer_families_monthly (company_code, customer_code);

-- ---------- Artículos ----------
create table if not exists public.sage_articles (
  company_code smallint not null references public.sage_companies(code) on delete cascade,
  code text not null,
  name text not null,
  family_code text,
  subfamily_code text,
  brand text,
  supplier_code text,
  manufacturer text,
  abc text,
  created_on date,
  obsolete boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (company_code, code)
);
create index if not exists sage_articles_created_idx on public.sage_articles (created_on);

create table if not exists public.sage_article_sales_monthly (
  id bigint generated always as identity primary key,
  company_code smallint not null references public.sage_companies(code) on delete cascade,
  month date not null check (extract(day from month) = 1),
  article_code text not null default '',
  family_code text not null default '',
  subfamily_code text not null default '',
  units numeric(14, 2) not null default 0,
  documents integer not null default 0,
  net_amount numeric(14, 2) not null default 0,
  cost_amount numeric(14, 2) not null default 0,
  net_without_cost numeric(14, 2) not null default 0
);
create index if not exists sage_article_sales_month_idx on public.sage_article_sales_monthly (month);

create table if not exists public.sage_subfamilies (
  company_code smallint not null references public.sage_companies(code) on delete cascade,
  family_code text not null,
  code text not null,
  name text not null,
  updated_at timestamptz not null default now(),
  primary key (company_code, family_code, code)
);

-- ---------- Ofertas y pedidos, uno a uno ----------
-- `status` y `probability` son los códigos tal cual los guarda Sage: su
-- significado se deduce de los datos y se nombra en el panel, no aquí.
create table if not exists public.sage_offer_documents (
  company_code smallint not null references public.sage_companies(code) on delete cascade,
  year smallint not null,
  series text not null default '',
  number integer not null,
  offer_date date not null,
  presented_on date,
  valid_until date,
  expected_close date,
  customer_code text,
  rep_code integer,
  status smallint,
  probability text,
  reject_reason text,
  loss_detail text,
  net_amount numeric(14, 2) not null default 0,
  lines integer not null default 0,
  -- Lo que Sage enlaza de esta oferta en pedidos (conversión real).
  ordered_amount numeric(14, 2) not null default 0,
  first_order_on date,
  primary key (company_code, year, series, number)
);
create index if not exists sage_offer_documents_date_idx on public.sage_offer_documents (offer_date);

create table if not exists public.sage_order_documents (
  company_code smallint not null references public.sage_companies(code) on delete cascade,
  year smallint not null,
  series text not null default '',
  number integer not null,
  order_date date not null,
  needed_on date,
  delivery_on date,
  customer_code text,
  rep_code integer,
  status smallint,
  net_amount numeric(14, 2) not null default 0,
  pending_amount numeric(14, 2) not null default 0,
  lines integer not null default 0,
  from_offer boolean not null default false,
  -- Lo servido en albaranes enlazados y cuándo empezó a servirse (plazo real).
  delivered_amount numeric(14, 2) not null default 0,
  first_delivery_on date,
  primary key (company_code, year, series, number)
);
create index if not exists sage_order_documents_date_idx on public.sage_order_documents (order_date);

-- ---------- Abonos e incidencias de los albaranes ----------
create table if not exists public.sage_incidents_daily (
  id bigint generated always as identity primary key,
  company_code smallint not null references public.sage_companies(code) on delete cascade,
  day date not null,
  kind text not null check (kind in ('abono', 'incidencia')),
  reason text not null default '',
  series text not null default '',
  rep_code integer,
  documents integer not null default 0,
  net_amount numeric(14, 2) not null default 0
);
create index if not exists sage_incidents_daily_day_idx on public.sage_incidents_daily (day);

-- ---------- Tablas de códigos de Sage (motivos, tipos, grupos...) ----------
create table if not exists public.sage_lookups (
  table_name text not null,
  code text not null,
  name text not null,
  updated_at timestamptz not null default now(),
  primary key (table_name, code)
);

-- ---------- Presupuesto de ventas (no está en Sage) ----------
-- Por mes, y opcionalmente por sociedad y por comercial. Sin sociedad es el
-- objetivo de todo el grupo; sin comercial, el de la sociedad entera.
create table if not exists public.sales_targets (
  id uuid primary key default gen_random_uuid(),
  year smallint not null check (year between 2020 and 2100),
  month smallint not null check (month between 1 and 12),
  company_code smallint references public.sage_companies(code) on delete cascade,
  rep_key text,
  amount numeric(14, 2) not null check (amount >= 0),
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now()
);
create unique index if not exists sales_targets_key_idx
  on public.sales_targets (year, month, coalesce(company_code, -1), coalesce(rep_key, ''));

drop trigger if exists sales_targets_set_updated_at on public.sales_targets;
create trigger sales_targets_set_updated_at before update on public.sales_targets
for each row execute function public.set_updated_at();

-- ---------- Quién puede ver esto ----------
alter table public.sage_customers enable row level security;
alter table public.sage_customer_days enable row level security;
alter table public.sage_customer_families_monthly enable row level security;
alter table public.sage_articles enable row level security;
alter table public.sage_article_sales_monthly enable row level security;
alter table public.sage_subfamilies enable row level security;
alter table public.sage_offer_documents enable row level security;
alter table public.sage_order_documents enable row level security;
alter table public.sage_incidents_daily enable row level security;
alter table public.sage_lookups enable row level security;
alter table public.sales_targets enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['sage_customers', 'sage_customer_days', 'sage_customer_families_monthly', 'sage_articles',
                           'sage_article_sales_monthly', 'sage_subfamilies', 'sage_offer_documents', 'sage_order_documents',
                           'sage_incidents_daily', 'sage_lookups', 'sales_targets']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select public.current_user_has_any_role(ARRAY[''admin'',''direction'']::app_role[])))',
      t || '_read', t);
  end loop;
end $$;

-- El presupuesto lo pone dirección o administración desde el panel.
drop policy if exists sales_targets_insert on public.sales_targets;
create policy sales_targets_insert on public.sales_targets
for insert to authenticated
  with check ((select public.current_user_has_any_role(ARRAY['admin','direction']::app_role[])));
drop policy if exists sales_targets_update on public.sales_targets;
create policy sales_targets_update on public.sales_targets
for update to authenticated
  using ((select public.current_user_has_any_role(ARRAY['admin','direction']::app_role[])))
  with check ((select public.current_user_has_any_role(ARRAY['admin','direction']::app_role[])));
drop policy if exists sales_targets_delete on public.sales_targets;
create policy sales_targets_delete on public.sales_targets
for delete to authenticated
  using ((select public.current_user_has_any_role(ARRAY['admin','direction']::app_role[])));

-- ---------- La recepción ----------
-- Igual que antes, con las partes nuevas. Recordatorio de cómo trabaja:
--   - cada parte solo se toca si viene en `p`;
--   - lo que va por días se reescribe dentro de la ventana [covered_from, covered_to];
--   - lo que va por meses se reescribe en los meses que toca la ventana (el
--     agente los manda enteros);
--   - clientes, artículos, nombres y subfamilias se añaden o actualizan, nunca
--     se borran;
--   - ofertas y pedidos, uno a uno, se reescriben por su fecha dentro de la ventana;
--   - las tablas de códigos se sustituyen tabla a tabla.
create or replace function public.sage_ingest(p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_from date := (p->>'covered_from')::date;
  v_to date := (p->>'covered_to')::date;
  v_month_from date;
  v_month_to date;
  v_taken date := coalesce((p->>'taken_on')::date, current_date);
  v_counts jsonb := '{}'::jsonb;
  v_n integer;
begin
  if v_from is null or v_to is null or v_to < v_from then
    raise exception 'Ventana de fechas no válida: % a %', v_from, v_to;
  end if;
  v_month_from := date_trunc('month', v_from)::date;
  v_month_to := date_trunc('month', v_to)::date;

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
    insert into sage_sales_daily (company_code, basis, day, series, rep_code, documents, net_amount, cost_amount, vat_amount, net_without_cost, lines)
    select x.company_code, x.basis, x.day, coalesce(x.series, ''), x.rep_code, x.documents,
           x.net_amount, x.cost_amount, x.vat_amount, coalesce(x.net_without_cost, 0), coalesce(x.lines, 0)
    from jsonb_to_recordset(p->'sales') as x(company_code smallint, basis text, day date, series text, rep_code integer,
         documents integer, net_amount numeric, cost_amount numeric, vat_amount numeric, net_without_cost numeric, lines integer);
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('sales', v_n);
  end if;

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

  if jsonb_typeof(p->'subfamilies') = 'array' then
    insert into sage_subfamilies (company_code, family_code, code, name, updated_at)
    select x.company_code, x.family_code, x.code, x.name, now()
    from jsonb_to_recordset(p->'subfamilies') as x(company_code smallint, family_code text, code text, name text)
    on conflict (company_code, family_code, code) do update set name = excluded.name, updated_at = now();
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('subfamilies', v_n);
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

  if jsonb_typeof(p->'customers') = 'array' then
    delete from sage_customers_monthly where month between v_month_from and v_month_to;
    insert into sage_customers_monthly (company_code, month, active_customers, new_customers)
    select x.company_code, x.month, x.active_customers, x.new_customers
    from jsonb_to_recordset(p->'customers') as x(company_code smallint, month date, active_customers integer, new_customers integer);
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('customers', v_n);
  end if;

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

  -- ----- Lo nuevo -----

  if jsonb_typeof(p->'customer_list') = 'array' then
    insert into sage_customers (company_code, code, name, trade_name, rep_code, province, municipality, postal_code, activity,
                                customer_type, customer_group, phone, email, created_on, last_action_on, leave_reason, left_on, updated_at)
    select x.company_code, x.code, x.name, x.trade_name, x.rep_code, x.province, x.municipality, x.postal_code, x.activity,
           x.customer_type, x.customer_group, x.phone, x.email, x.created_on, x.last_action_on, x.leave_reason, x.left_on, now()
    from jsonb_to_recordset(p->'customer_list') as x(company_code smallint, code text, name text, trade_name text, rep_code integer,
         province text, municipality text, postal_code text, activity text, customer_type text, customer_group text, phone text,
         email text, created_on date, last_action_on date, leave_reason text, left_on date)
    on conflict (company_code, code) do update set
      name = excluded.name, trade_name = excluded.trade_name, rep_code = excluded.rep_code, province = excluded.province,
      municipality = excluded.municipality, postal_code = excluded.postal_code, activity = excluded.activity,
      customer_type = excluded.customer_type, customer_group = excluded.customer_group, phone = excluded.phone,
      email = excluded.email, created_on = excluded.created_on, last_action_on = excluded.last_action_on,
      leave_reason = excluded.leave_reason, left_on = excluded.left_on, updated_at = now();
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('customer_list', v_n);
  end if;

  if jsonb_typeof(p->'customer_days') = 'array' then
    delete from sage_customer_days where day between v_from and v_to;
    insert into sage_customer_days (company_code, customer_code, day, series, rep_code, documents, lines, net_amount, cost_amount, net_without_cost)
    select x.company_code, x.customer_code, x.day, coalesce(x.series, ''), x.rep_code, x.documents, coalesce(x.lines, 0),
           x.net_amount, coalesce(x.cost_amount, 0), coalesce(x.net_without_cost, 0)
    from jsonb_to_recordset(p->'customer_days') as x(company_code smallint, customer_code text, day date, series text, rep_code integer,
         documents integer, lines integer, net_amount numeric, cost_amount numeric, net_without_cost numeric);
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('customer_days', v_n);
  end if;

  if jsonb_typeof(p->'customer_families') = 'array' then
    delete from sage_customer_families_monthly where month between v_month_from and v_month_to;
    insert into sage_customer_families_monthly (company_code, customer_code, month, family_code, net_amount, cost_amount, net_without_cost)
    select x.company_code, x.customer_code, x.month, coalesce(x.family_code, ''), x.net_amount, coalesce(x.cost_amount, 0), coalesce(x.net_without_cost, 0)
    from jsonb_to_recordset(p->'customer_families') as x(company_code smallint, customer_code text, month date, family_code text,
         net_amount numeric, cost_amount numeric, net_without_cost numeric);
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('customer_families', v_n);
  end if;

  if jsonb_typeof(p->'article_list') = 'array' then
    insert into sage_articles (company_code, code, name, family_code, subfamily_code, brand, supplier_code, manufacturer, abc, created_on, obsolete, updated_at)
    select x.company_code, x.code, x.name, x.family_code, x.subfamily_code, x.brand, x.supplier_code, x.manufacturer, x.abc,
           x.created_on, coalesce(x.obsolete, false), now()
    from jsonb_to_recordset(p->'article_list') as x(company_code smallint, code text, name text, family_code text, subfamily_code text,
         brand text, supplier_code text, manufacturer text, abc text, created_on date, obsolete boolean)
    on conflict (company_code, code) do update set
      name = excluded.name, family_code = excluded.family_code, subfamily_code = excluded.subfamily_code, brand = excluded.brand,
      supplier_code = excluded.supplier_code, manufacturer = excluded.manufacturer, abc = excluded.abc,
      created_on = excluded.created_on, obsolete = excluded.obsolete, updated_at = now();
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('article_list', v_n);
  end if;

  if jsonb_typeof(p->'article_sales') = 'array' then
    delete from sage_article_sales_monthly where month between v_month_from and v_month_to;
    insert into sage_article_sales_monthly (company_code, month, article_code, family_code, subfamily_code, units, documents,
                                            net_amount, cost_amount, net_without_cost)
    select x.company_code, x.month, coalesce(x.article_code, ''), coalesce(x.family_code, ''), coalesce(x.subfamily_code, ''),
           coalesce(x.units, 0), coalesce(x.documents, 0), x.net_amount, coalesce(x.cost_amount, 0), coalesce(x.net_without_cost, 0)
    from jsonb_to_recordset(p->'article_sales') as x(company_code smallint, month date, article_code text, family_code text,
         subfamily_code text, units numeric, documents integer, net_amount numeric, cost_amount numeric, net_without_cost numeric);
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('article_sales', v_n);
  end if;

  if jsonb_typeof(p->'offer_documents') = 'array' then
    delete from sage_offer_documents where offer_date between v_from and v_to;
    insert into sage_offer_documents (company_code, year, series, number, offer_date, presented_on, valid_until, expected_close,
                                      customer_code, rep_code, status, probability, reject_reason, loss_detail, net_amount, lines,
                                      ordered_amount, first_order_on)
    select x.company_code, x.year, coalesce(x.series, ''), x.number, x.offer_date, x.presented_on, x.valid_until, x.expected_close,
           x.customer_code, x.rep_code, x.status, x.probability, x.reject_reason, x.loss_detail, x.net_amount, coalesce(x.lines, 0),
           coalesce(x.ordered_amount, 0), x.first_order_on
    from jsonb_to_recordset(p->'offer_documents') as x(company_code smallint, year smallint, series text, number integer,
         offer_date date, presented_on date, valid_until date, expected_close date, customer_code text, rep_code integer,
         status smallint, probability text, reject_reason text, loss_detail text, net_amount numeric, lines integer,
         ordered_amount numeric, first_order_on date)
    on conflict (company_code, year, series, number) do update set
      offer_date = excluded.offer_date, presented_on = excluded.presented_on, valid_until = excluded.valid_until,
      expected_close = excluded.expected_close, customer_code = excluded.customer_code, rep_code = excluded.rep_code,
      status = excluded.status, probability = excluded.probability, reject_reason = excluded.reject_reason,
      loss_detail = excluded.loss_detail, net_amount = excluded.net_amount, lines = excluded.lines,
      ordered_amount = excluded.ordered_amount, first_order_on = excluded.first_order_on;
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('offer_documents', v_n);
  end if;

  if jsonb_typeof(p->'order_documents') = 'array' then
    delete from sage_order_documents where order_date between v_from and v_to;
    insert into sage_order_documents (company_code, year, series, number, order_date, needed_on, delivery_on, customer_code, rep_code,
                                      status, net_amount, pending_amount, lines, from_offer, delivered_amount, first_delivery_on)
    select x.company_code, x.year, coalesce(x.series, ''), x.number, x.order_date, x.needed_on, x.delivery_on, x.customer_code,
           x.rep_code, x.status, x.net_amount, coalesce(x.pending_amount, 0), coalesce(x.lines, 0), coalesce(x.from_offer, false),
           coalesce(x.delivered_amount, 0), x.first_delivery_on
    from jsonb_to_recordset(p->'order_documents') as x(company_code smallint, year smallint, series text, number integer,
         order_date date, needed_on date, delivery_on date, customer_code text, rep_code integer, status smallint,
         net_amount numeric, pending_amount numeric, lines integer, from_offer boolean, delivered_amount numeric, first_delivery_on date)
    on conflict (company_code, year, series, number) do update set
      order_date = excluded.order_date, needed_on = excluded.needed_on, delivery_on = excluded.delivery_on,
      customer_code = excluded.customer_code, rep_code = excluded.rep_code, status = excluded.status,
      net_amount = excluded.net_amount, pending_amount = excluded.pending_amount, lines = excluded.lines,
      from_offer = excluded.from_offer, delivered_amount = excluded.delivered_amount, first_delivery_on = excluded.first_delivery_on;
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('order_documents', v_n);
  end if;

  if jsonb_typeof(p->'incidents') = 'array' then
    delete from sage_incidents_daily where day between v_from and v_to;
    insert into sage_incidents_daily (company_code, day, kind, reason, series, rep_code, documents, net_amount)
    select x.company_code, x.day, x.kind, coalesce(x.reason, ''), coalesce(x.series, ''), x.rep_code, x.documents, x.net_amount
    from jsonb_to_recordset(p->'incidents') as x(company_code smallint, day date, kind text, reason text, series text,
         rep_code integer, documents integer, net_amount numeric);
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('incidents', v_n);
  end if;

  if jsonb_typeof(p->'lookups') = 'array' then
    delete from sage_lookups
    where table_name in (select distinct x.table_name from jsonb_to_recordset(p->'lookups') as x(table_name text));
    insert into sage_lookups (table_name, code, name, updated_at)
    select distinct on (x.table_name, x.code) x.table_name, x.code, x.name, now()
    from jsonb_to_recordset(p->'lookups') as x(table_name text, code text, name text)
    where x.table_name is not null and x.code is not null and x.name is not null;
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('lookups', v_n);
  end if;

  return v_counts;
end;
$$;

revoke all on function public.sage_ingest(jsonb) from public, anon, authenticated;
grant execute on function public.sage_ingest(jsonb) to service_role;
