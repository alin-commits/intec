-- Productos por comercial: quién vende cada familia y cada artículo.
--
-- Hasta ahora el filtro de comercial no llegaba a Productos, y la etiqueta lo
-- decía: «no se aplica en esta página». No era un olvido, es que lo que manda
-- el agente de familias y artículos venía ya sumado sin el comercial, así que
-- no había por dónde partirlo.
--
-- Esto añade el comercial del albarán a las dos tablas, igual que ya lo tenían
-- las ventas, y se lo pasa a las tres funciones que lee la pantalla.
--
-- Importante, y por eso va aparte del resto:
--
--   · Hace falta la versión del agente «2026-10-22 productos-por-comercial» en
--     el servidor de Sage. La de antes no manda el comercial, y las filas que
--     cargue se quedarán con el comercial a nulo.
--   · Y hace falta una relectura del histórico entero. Lo que ya está cargado
--     no tiene comercial y no se arregla solo: hasta que se relea, lo viejo
--     sale como «sin comercial asignado».
--
-- El índice único de familias pasa a incluir el comercial. Se escribe con
-- coalesce en vez de con «nulls not distinct» para que funcione en cualquier
-- versión de Postgres: un albarán sin comercial lleva el código a nulo y dos
-- nulos tienen que contar como el mismo.
--
-- Se puede volver a ejecutar sin romper nada.

alter table public.sage_family_sales_daily add column if not exists rep_code integer;
alter table public.sage_article_sales_monthly add column if not exists rep_code integer;

drop index if exists public.sage_family_sales_daily_key_idx;
create unique index if not exists sage_family_sales_daily_key_idx
  on public.sage_family_sales_daily (company_code, day, family_code, coalesce(rep_code, -1));
create index if not exists sage_family_sales_daily_rep_idx on public.sage_family_sales_daily (company_code, rep_code);
create index if not exists sage_article_sales_rep_idx on public.sage_article_sales_monthly (company_code, rep_code);

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
  v_total integer;
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
    insert into sage_reps (company_code, code, name, is_person, is_manager, manager_code, is_active, left_on, updated_at)
    select x.company_code, x.code, x.name, coalesce(x.is_person, true), coalesce(x.is_manager, false), x.manager_code,
           coalesce(x.is_active, true), x.left_on, now()
    from jsonb_to_recordset(p->'reps') as x(company_code smallint, code integer, name text, is_person boolean,
         is_manager boolean, manager_code integer, is_active boolean, left_on date)
    on conflict (company_code, code) do update set name = excluded.name, is_person = excluded.is_person,
      is_manager = excluded.is_manager, manager_code = excluded.manager_code, is_active = excluded.is_active,
      left_on = excluded.left_on, updated_at = now();
  end if;

  if jsonb_typeof(p->'sales') = 'array' then
    delete from sage_sales_daily where day between v_from and v_to;
    insert into sage_sales_daily (company_code, basis, day, series, rep_code, documents, net_amount, cost_amount, vat_amount, net_without_cost, lines,
                                  gross_amount, line_discount_amount, rappel_amount, commission_amount)
    select x.company_code, x.basis, x.day, coalesce(x.series, ''), x.rep_code, x.documents,
           x.net_amount, x.cost_amount, x.vat_amount, coalesce(x.net_without_cost, 0), coalesce(x.lines, 0),
           x.gross_amount, x.line_discount_amount, x.rappel_amount, x.commission_amount
    from jsonb_to_recordset(p->'sales') as x(company_code smallint, basis text, day date, series text, rep_code integer,
         documents integer, net_amount numeric, cost_amount numeric, vat_amount numeric, net_without_cost numeric, lines integer,
         gross_amount numeric, line_discount_amount numeric, rappel_amount numeric, commission_amount numeric);
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
    insert into sage_family_sales_daily (company_code, day, family_code, rep_code, units, net_amount, cost_amount, net_without_cost, gross_amount)
    select x.company_code, x.day, coalesce(x.family_code, ''), x.rep_code, coalesce(x.units, 0), x.net_amount,
           coalesce(x.cost_amount, 0), coalesce(x.net_without_cost, 0), x.gross_amount
    from jsonb_to_recordset(p->'family_sales') as x(company_code smallint, day date, family_code text, rep_code integer,
         units numeric, net_amount numeric, cost_amount numeric, net_without_cost numeric, gross_amount numeric);
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
    v_total := jsonb_array_length(p->'customer_list');
    insert into sage_customers (company_code, code, name, trade_name, rep_code, province, municipality, postal_code, activity,
                                customer_type, customer_group, phone, email, created_on, last_action_on, leave_reason, left_on,
                                zone_code, channel_code, sector_code, payment_method, credit_limit, is_blocked, updated_at)
    select distinct on (x.company_code, x.code) x.company_code, x.code, x.name, x.trade_name, x.rep_code, x.province, x.municipality, x.postal_code, x.activity,
           x.customer_type, x.customer_group, x.phone, x.email, x.created_on, x.last_action_on, x.leave_reason, x.left_on,
           x.zone_code, x.channel_code, x.sector_code, x.payment_method, x.credit_limit, coalesce(x.is_blocked, false), now()
    from jsonb_to_recordset(p->'customer_list') as x(company_code smallint, code text, name text, trade_name text, rep_code integer,
         province text, municipality text, postal_code text, activity text, customer_type text, customer_group text, phone text,
         email text, created_on date, last_action_on date, leave_reason text, left_on date,
         zone_code text, channel_code text, sector_code text, payment_method text, credit_limit numeric, is_blocked boolean)
    where x.code is not null and exists (select 1 from sage_companies c where c.code = x.company_code)
    on conflict (company_code, code) do update set
      name = excluded.name, trade_name = excluded.trade_name, rep_code = excluded.rep_code, province = excluded.province,
      municipality = excluded.municipality, postal_code = excluded.postal_code, activity = excluded.activity,
      customer_type = excluded.customer_type, customer_group = excluded.customer_group, phone = excluded.phone,
      email = excluded.email, created_on = excluded.created_on, last_action_on = excluded.last_action_on,
      leave_reason = excluded.leave_reason, left_on = excluded.left_on, zone_code = excluded.zone_code,
      channel_code = excluded.channel_code, sector_code = excluded.sector_code, payment_method = excluded.payment_method,
      credit_limit = excluded.credit_limit, is_blocked = excluded.is_blocked, updated_at = now();
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('customer_list', v_n);
    if v_total > v_n then v_counts := v_counts || jsonb_build_object('customer_list_skipped', v_total - v_n); end if;
  end if;

  if jsonb_typeof(p->'customer_days') = 'array' then
    delete from sage_customer_days where day between v_from and v_to;
    insert into sage_customer_days (company_code, customer_code, day, series, rep_code, documents, lines, net_amount, cost_amount, net_without_cost,
                                    gross_amount, line_discount_amount)
    select x.company_code, x.customer_code, x.day, coalesce(x.series, ''), x.rep_code, x.documents, coalesce(x.lines, 0),
           x.net_amount, coalesce(x.cost_amount, 0), coalesce(x.net_without_cost, 0), x.gross_amount, x.line_discount_amount
    from jsonb_to_recordset(p->'customer_days') as x(company_code smallint, customer_code text, day date, series text, rep_code integer,
         documents integer, lines integer, net_amount numeric, cost_amount numeric, net_without_cost numeric,
         gross_amount numeric, line_discount_amount numeric);
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('customer_days', v_n);
  end if;

  if jsonb_typeof(p->'customer_families') = 'array' then
    delete from sage_customer_families_monthly where month between v_month_from and v_month_to;
    insert into sage_customer_families_monthly (company_code, customer_code, month, family_code, net_amount, cost_amount, net_without_cost, gross_amount)
    select x.company_code, x.customer_code, x.month, coalesce(x.family_code, ''), x.net_amount, coalesce(x.cost_amount, 0), coalesce(x.net_without_cost, 0),
           x.gross_amount
    from jsonb_to_recordset(p->'customer_families') as x(company_code smallint, customer_code text, month date, family_code text,
         net_amount numeric, cost_amount numeric, net_without_cost numeric, gross_amount numeric);
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('customer_families', v_n);
  end if;

  if jsonb_typeof(p->'article_list') = 'array' then
    v_total := jsonb_array_length(p->'article_list');
    insert into sage_articles (company_code, code, name, family_code, subfamily_code, brand, supplier_code, manufacturer, abc, created_on, obsolete, updated_at)
    select distinct on (x.company_code, x.code) x.company_code, x.code, x.name, x.family_code, x.subfamily_code, x.brand, x.supplier_code, x.manufacturer, x.abc,
           x.created_on, coalesce(x.obsolete, false), now()
    from jsonb_to_recordset(p->'article_list') as x(company_code smallint, code text, name text, family_code text, subfamily_code text,
         brand text, supplier_code text, manufacturer text, abc text, created_on date, obsolete boolean)
    where x.code is not null and exists (select 1 from sage_companies c where c.code = x.company_code)
    on conflict (company_code, code) do update set
      name = excluded.name, family_code = excluded.family_code, subfamily_code = excluded.subfamily_code, brand = excluded.brand,
      supplier_code = excluded.supplier_code, manufacturer = excluded.manufacturer, abc = excluded.abc,
      created_on = excluded.created_on, obsolete = excluded.obsolete, updated_at = now();
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('article_list', v_n);
    if v_total > v_n then v_counts := v_counts || jsonb_build_object('article_list_skipped', v_total - v_n); end if;
  end if;

  if jsonb_typeof(p->'article_sales') = 'array' then
    delete from sage_article_sales_monthly where month between v_month_from and v_month_to;
    insert into sage_article_sales_monthly (company_code, month, article_code, family_code, subfamily_code, rep_code, units, documents,
                                            net_amount, cost_amount, net_without_cost, gross_amount)
    select x.company_code, x.month, coalesce(x.article_code, ''), coalesce(x.family_code, ''), coalesce(x.subfamily_code, ''),
           x.rep_code, coalesce(x.units, 0), coalesce(x.documents, 0), x.net_amount, coalesce(x.cost_amount, 0),
           coalesce(x.net_without_cost, 0), x.gross_amount
    from jsonb_to_recordset(p->'article_sales') as x(company_code smallint, month date, article_code text, family_code text,
         subfamily_code text, rep_code integer, units numeric, documents integer, net_amount numeric, cost_amount numeric,
         net_without_cost numeric, gross_amount numeric);
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
    insert into sage_lookups (table_name, code, name, code_column, updated_at)
    select distinct on (x.table_name, x.code) x.table_name, x.code, x.name, x.code_column, now()
    from jsonb_to_recordset(p->'lookups') as x(table_name text, code text, name text, code_column text)
    where x.table_name is not null and x.code is not null and x.name is not null;
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('lookups', v_n);
  end if;

  if jsonb_typeof(p->'customer_contacts') = 'array' then
    if coalesce((p->>'customer_contacts_replace')::boolean, false) then
      delete from sage_customer_contacts where true;
    end if;
    v_total := jsonb_array_length(p->'customer_contacts');
    insert into sage_customer_contacts (company_code, customer_code, position, name, role_code, area_code, phone, phone2, phone3,
                                        email, is_commercial, is_admin, is_operational, updated_at)
    select distinct on (x.company_code, x.customer_code, x.position) x.company_code, x.customer_code, x.position, x.name,
           x.role_code, x.area_code, x.phone, x.phone2, x.phone3, x.email, coalesce(x.is_commercial, false),
           coalesce(x.is_admin, false), coalesce(x.is_operational, false), now()
    from jsonb_to_recordset(p->'customer_contacts') as x(company_code smallint, customer_code text, position integer, name text,
         role_code text, area_code text, phone text, phone2 text, phone3 text, email text, is_commercial boolean, is_admin boolean,
         is_operational boolean)
    where x.customer_code is not null and x.position is not null and x.name is not null
      and exists (select 1 from sage_companies c where c.code = x.company_code)
    on conflict (company_code, customer_code, position) do update set
      name = excluded.name, role_code = excluded.role_code, area_code = excluded.area_code, phone = excluded.phone,
      phone2 = excluded.phone2, phone3 = excluded.phone3, email = excluded.email, is_commercial = excluded.is_commercial,
      is_admin = excluded.is_admin, is_operational = excluded.is_operational, updated_at = now();
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('customer_contacts', v_n);
    if v_total > v_n then v_counts := v_counts || jsonb_build_object('customer_contacts_skipped', v_total - v_n); end if;
  end if;

  return v_counts;
end;
$$;

drop function if exists public.sage_family_summary(date, date, date, text[]);
create or replace function public.sage_family_summary(p_from date, p_to date, p_cost_from date default '2025-11-01',
  p_months text[] default null, p_reps text[] default null)
returns table(company_code smallint, family_code text, family_name text, units numeric, net_amount numeric, trusted_net numeric,
  trusted_cost numeric, trusted_without_cost numeric, gross_amount numeric, gross_net numeric)
language sql
stable
set search_path = public
as $$
  select f.company_code, f.family_code, max(n.name), sum(f.units), sum(f.net_amount),
         coalesce(sum(f.net_amount) filter (where f.day >= p_cost_from), 0),
         coalesce(sum(f.cost_amount) filter (where f.day >= p_cost_from), 0),
         coalesce(sum(f.net_without_cost) filter (where f.day >= p_cost_from), 0),
         coalesce(sum(f.gross_amount), 0),
         coalesce(sum(f.net_amount) filter (where f.gross_amount is not null), 0)
  from public.sage_family_sales_daily f
  left join public.sage_families n on n.company_code = f.company_code and n.code = f.family_code
  where f.day between p_from and p_to
    and (p_months is null or to_char(f.day, 'YYYY-MM') = any(p_months))
    and (p_reps is null or (f.company_code::text || ':' || coalesce(f.rep_code::text, 'sin')) = any(p_reps))
  group by f.company_code, f.family_code;
$$;
revoke all on function public.sage_family_summary(date, date, date, text[], text[]) from public, anon;
grant execute on function public.sage_family_summary(date, date, date, text[], text[]) to authenticated, service_role;

drop function if exists public.sage_article_summary(date, date, smallint[], text[], text, text, integer, date, text[]);
create or replace function public.sage_article_summary(p_from date, p_to date, p_companies smallint[] default null, p_families text[] default null,
  p_subfamily text default null, p_brand text default null, p_limit integer default 50, p_cost_from date default '2025-11-01',
  p_months text[] default null, p_reps text[] default null)
returns table(article_code text, name text, brand text, family_code text, subfamily_code text, units numeric, documents bigint,
  net_amount numeric, trusted_net numeric, trusted_cost numeric, trusted_without_cost numeric, gross_amount numeric, gross_net numeric)
language sql
stable
set search_path = public
as $$
  select s.article_code, max(a.name), max(a.brand), s.family_code, max(s.subfamily_code),
    sum(s.units), sum(s.documents)::bigint, sum(s.net_amount),
    coalesce(sum(s.net_amount) filter (where s.month >= date_trunc('month', p_cost_from)), 0),
    coalesce(sum(s.cost_amount) filter (where s.month >= date_trunc('month', p_cost_from)), 0),
    coalesce(sum(s.net_without_cost) filter (where s.month >= date_trunc('month', p_cost_from)), 0),
    coalesce(sum(s.gross_amount), 0),
    coalesce(sum(s.net_amount) filter (where s.gross_amount is not null), 0)
  from sage_article_sales_monthly s
  left join sage_articles a on a.company_code = s.company_code and a.code = s.article_code
  where s.month between date_trunc('month', p_from)::date and p_to
    and (p_months is null or to_char(s.month, 'YYYY-MM') = any(p_months))
    and (p_companies is null or s.company_code = any(p_companies))
    and (p_reps is null or (s.company_code::text || ':' || coalesce(s.rep_code::text, 'sin')) = any(p_reps))
    and (p_families is null or s.family_code = any(p_families))
    and (p_subfamily is null or s.subfamily_code = p_subfamily)
    and (p_brand is null or coalesce(a.brand, '') = p_brand)
  group by s.article_code, s.family_code
  order by sum(s.net_amount) desc
  limit greatest(p_limit, 1);
$$;
revoke all on function public.sage_article_summary(date, date, smallint[], text[], text, text, integer, date, text[], text[]) from public, anon;
grant execute on function public.sage_article_summary(date, date, smallint[], text[], text, text, integer, date, text[], text[]) to authenticated, service_role;

drop function if exists public.sage_article_groups(text, date, date, smallint[], text[], date, text[]);
create or replace function public.sage_article_groups(p_group text, p_from date, p_to date, p_companies smallint[] default null,
  p_families text[] default null, p_cost_from date default '2025-11-01', p_months text[] default null,
  p_reps text[] default null)
returns table(code text, family_code text, name text, articles bigint, net_amount numeric, trusted_net numeric, trusted_cost numeric,
  trusted_without_cost numeric, gross_amount numeric, gross_net numeric)
language sql
stable
set search_path = public
as $$
  with filas as (
    select s.*,
      case when p_group = 'marca' then coalesce(nullif(a.brand, ''), '') else s.subfamily_code end as grupo,
      -- La misma subfamilia puede repetir código en familias distintas: van aparte.
      case when p_group = 'marca' then '' else s.family_code end as grupo_familia
    from sage_article_sales_monthly s
    left join sage_articles a on a.company_code = s.company_code and a.code = s.article_code
    where s.month between date_trunc('month', p_from)::date and p_to
      and (p_months is null or to_char(s.month, 'YYYY-MM') = any(p_months))
      and (p_companies is null or s.company_code = any(p_companies))
      and (p_reps is null or (s.company_code::text || ':' || coalesce(s.rep_code::text, 'sin')) = any(p_reps))
      and (p_families is null or s.family_code = any(p_families))
  ),
  grupos as (
    select f.grupo, f.grupo_familia,
      count(distinct f.article_code) as articulos,
      sum(f.net_amount) as neto,
      coalesce(sum(f.net_amount) filter (where f.month >= date_trunc('month', p_cost_from)), 0) as neto_fiable,
      coalesce(sum(f.cost_amount) filter (where f.month >= date_trunc('month', p_cost_from)), 0) as coste_fiable,
      coalesce(sum(f.net_without_cost) filter (where f.month >= date_trunc('month', p_cost_from)), 0) as sin_coste_fiable,
      coalesce(sum(f.gross_amount), 0) as bruto,
      coalesce(sum(f.net_amount) filter (where f.gross_amount is not null), 0) as neto_con_bruto
    from filas f
    group by f.grupo, f.grupo_familia
  )
  select g.grupo, g.grupo_familia,
    case when p_group = 'marca' then nullif(g.grupo, '')
         else (select max(sf.name) from sage_subfamilies sf where sf.code = g.grupo and sf.family_code = g.grupo_familia) end,
    g.articulos, g.neto, g.neto_fiable, g.coste_fiable, g.sin_coste_fiable, g.bruto, g.neto_con_bruto
  from grupos g
  order by g.neto desc;
$$;
revoke all on function public.sage_article_groups(text, date, date, smallint[], text[], date, text[], text[]) from public, anon;
grant execute on function public.sage_article_groups(text, date, date, smallint[], text[], date, text[], text[]) to authenticated, service_role;
