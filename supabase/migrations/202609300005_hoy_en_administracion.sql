-- «Hoy en Administración»: lo que Administración tiene que mirar cada día.
--
-- Hasta ahora, reclamar cobros, ver qué se debe a proveedores o qué albaranes
-- siguen sin facturar se hacía mirando Sage cliente por cliente. El agente trae
-- ahora además:
--   - la ficha del cliente: límite de riesgo y si está bloqueado;
--   - los recibos devueltos por el banco (en la cartera pendiente);
--   - los albaranes sin facturar del último año, con la periodicidad de
--     facturación del cliente (los de factura mensual esperan a fin de mes);
--   - las cuentas de los bancos, con su línea de riesgo y lo dispuesto, y su
--     saldo día a día (tesorería desde el saldo real).
--
-- Lo ven quienes ven Pagos: Administración, Administrador y Propietario. Para
-- reclamar, Administración ve también los contactos de los clientes y el
-- nombre de los comerciales.

alter table public.sage_customers
  add column if not exists credit_limit numeric(14,2),
  add column if not exists is_blocked boolean not null default false;

alter table public.sage_open_items
  add column if not exists is_returned boolean not null default false,
  add column if not exists returned_on date;

create table if not exists public.sage_uninvoiced_notes (
  company_code smallint not null references public.sage_companies(code) on delete cascade,
  year smallint not null,
  series text not null default '',
  number integer not null,
  note_date date not null,
  customer_code text,
  rep_code integer,
  net_amount numeric(14,2) not null default 0,
  -- La periodicidad de facturación del albarán (en Sage, PeriodicidadFacturas).
  billing_period text,
  taken_on date not null default current_date,
  primary key (company_code, year, series, number)
);

create table if not exists public.sage_bank_accounts (
  company_code smallint not null references public.sage_companies(code) on delete cascade,
  -- La cuenta contable del banco (572...): la misma que usan las remesas.
  account_code text not null,
  bank_code text,
  bank_name text,
  description text,
  iban text,
  credit_limit numeric(14,2),
  credit_used numeric(14,2),
  updated_at timestamptz not null default now(),
  primary key (company_code, account_code)
);

create table if not exists public.sage_bank_balances (
  company_code smallint not null references public.sage_companies(code) on delete cascade,
  account_code text not null,
  day date not null,
  balance numeric(14,2) not null default 0,
  movement numeric(14,2) not null default 0,
  primary key (company_code, account_code, day)
);

do $$
declare
  t text;
begin
  foreach t in array array['sage_uninvoiced_notes', 'sage_bank_accounts', 'sage_bank_balances']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select public.current_user_has_any_role(ARRAY[''admin'',''owner'',''accounting'']::app_role[])))',
      t || '_read', t);
    execute format('revoke insert, update, delete on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- Para reclamar: la persona de contacto del cliente y el nombre del comercial.
drop policy if exists sage_customer_contacts_read on public.sage_customer_contacts;
create policy sage_customer_contacts_read on public.sage_customer_contacts
for select to authenticated
  using ((select public.current_user_has_any_role(ARRAY['admin','owner','direction','accounting']::app_role[])));

drop policy if exists sage_reps_read on public.sage_reps;
create policy sage_reps_read on public.sage_reps
for select to authenticated
  using ((select public.current_user_has_any_role(ARRAY['admin','owner','direction','accounting']::app_role[])));

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
    insert into sage_family_sales_daily (company_code, day, family_code, units, net_amount, cost_amount, net_without_cost, gross_amount)
    select x.company_code, x.day, coalesce(x.family_code, ''), coalesce(x.units, 0), x.net_amount,
           coalesce(x.cost_amount, 0), coalesce(x.net_without_cost, 0), x.gross_amount
    from jsonb_to_recordset(p->'family_sales') as x(company_code smallint, day date, family_code text, units numeric,
         net_amount numeric, cost_amount numeric, net_without_cost numeric, gross_amount numeric);
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
    insert into sage_article_sales_monthly (company_code, month, article_code, family_code, subfamily_code, units, documents,
                                            net_amount, cost_amount, net_without_cost, gross_amount)
    select x.company_code, x.month, coalesce(x.article_code, ''), coalesce(x.family_code, ''), coalesce(x.subfamily_code, ''),
           coalesce(x.units, 0), coalesce(x.documents, 0), x.net_amount, coalesce(x.cost_amount, 0), coalesce(x.net_without_cost, 0),
           x.gross_amount
    from jsonb_to_recordset(p->'article_sales') as x(company_code smallint, month date, article_code text, family_code text,
         subfamily_code text, units numeric, documents integer, net_amount numeric, cost_amount numeric, net_without_cost numeric,
         gross_amount numeric);
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

revoke all on function public.sage_ingest(jsonb) from public, anon, authenticated;
grant execute on function public.sage_ingest(jsonb) to service_role;

create or replace function public.sage_ingest_payments(p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_counts jsonb := '{}'::jsonb;
  v_n integer;
  v_total integer;
begin
  perform pg_advisory_xact_lock(hashtext('public.sage_ingest'));

  if jsonb_typeof(p->'company_details') = 'array' then
    insert into sage_company_details (company_code, nif, address, postal_code, city, province, updated_at)
    select distinct on (x.company_code) x.company_code, x.nif, x.address, x.postal_code, x.city, x.province, now()
    from rows from (jsonb_to_recordset(p->'company_details') as (company_code smallint, nif text, address text, postal_code text, city text, province text)) with ordinality as x(company_code, nif, address, postal_code, city, province, n)
    where exists (select 1 from sage_companies c where c.code = x.company_code)
    order by x.company_code, x.n desc
    on conflict (company_code) do update set nif = excluded.nif, address = excluded.address, postal_code = excluded.postal_code,
      city = excluded.city, province = excluded.province, updated_at = now();
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('company_details', v_n);
  end if;

  if jsonb_typeof(p->'suppliers') = 'array' then
    v_total := jsonb_array_length(p->'suppliers');
    insert into sage_suppliers (company_code, code, name, trade_name, nif, address, postal_code, city, province, country, phone, email, updated_at)
    select distinct on (x.company_code, x.code) x.company_code, x.code, x.name, x.trade_name, x.nif, x.address, x.postal_code, x.city,
      x.province, x.country, x.phone, x.email, now()
    from rows from (jsonb_to_recordset(p->'suppliers') as (company_code smallint, code text, name text, trade_name text, nif text, address text, postal_code text, city text, province text, country text, phone text, email text)) with ordinality as x(company_code, code, name, trade_name, nif, address, postal_code, city, province, country, phone, email, n)
    where exists (select 1 from sage_companies c where c.code = x.company_code)
    order by x.company_code, x.code, x.n desc
    on conflict (company_code, code) do update set name = excluded.name, trade_name = excluded.trade_name, nif = excluded.nif,
      address = excluded.address, postal_code = excluded.postal_code, city = excluded.city, province = excluded.province,
      country = excluded.country, phone = excluded.phone, email = excluded.email, updated_at = now();
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('suppliers', v_n);
    if v_total > v_n then v_counts := v_counts || jsonb_build_object('suppliers_repeated', v_total - v_n); end if;
  end if;

  if jsonb_typeof(p->'payment_remittances') = 'array' then
    delete from sage_payment_remittance_items i
    using (select distinct x.company_code, x.number
           from jsonb_to_recordset(p->'payment_remittances') as x(company_code smallint, number integer)) x
    where i.company_code = x.company_code and i.remittance_number = x.number;

    v_total := jsonb_array_length(p->'payment_remittances');
    insert into sage_payment_remittances (company_code, number, remittance_date, value_date, bank_code, remittance_type, csb_norm,
      total, effects, provisional, updated_at)
    select distinct on (x.company_code, x.number) x.company_code, x.number, x.remittance_date, x.value_date, coalesce(x.bank_code, ''),
      x.remittance_type, x.csb_norm, coalesce(x.total, 0), coalesce(x.effects, 0), coalesce(x.provisional, false), now()
    from rows from (jsonb_to_recordset(p->'payment_remittances') as (company_code smallint, number integer, remittance_date date, value_date date, bank_code text, remittance_type text, csb_norm text, total numeric, effects integer, provisional boolean)) with ordinality as x(company_code, number, remittance_date, value_date, bank_code, remittance_type, csb_norm, total, effects, provisional, n)
    where exists (select 1 from sage_companies c where c.code = x.company_code)
    order by x.company_code, x.number, x.n desc
    on conflict (company_code, number) do update set remittance_date = excluded.remittance_date, value_date = excluded.value_date,
      bank_code = excluded.bank_code, remittance_type = excluded.remittance_type, csb_norm = excluded.csb_norm,
      total = excluded.total, effects = excluded.effects, provisional = excluded.provisional, updated_at = now();
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('payment_remittances', v_n);
    if v_total > v_n then v_counts := v_counts || jsonb_build_object('payment_remittances_repeated', v_total - v_n); end if;
  end if;

  if jsonb_typeof(p->'payment_items') = 'array' then
    v_total := jsonb_array_length(p->'payment_items');
    insert into sage_payment_remittance_items (company_code, remittance_number, movement_id, effect_number, supplier_code,
      invoice_number, invoice_date, due_date, amount, pending, iban)
    select distinct on (x.company_code, x.movement_id) x.company_code, x.remittance_number, x.movement_id, x.effect_number,
      x.supplier_code, x.invoice_number, x.invoice_date, x.due_date, coalesce(x.amount, 0), coalesce(x.pending, 0), x.iban
    from rows from (jsonb_to_recordset(p->'payment_items') as (company_code smallint, remittance_number integer, movement_id text, effect_number integer, supplier_code text, invoice_number text, invoice_date date, due_date date, amount numeric, pending numeric, iban text)) with ordinality as x(company_code, remittance_number, movement_id, effect_number, supplier_code, invoice_number, invoice_date, due_date, amount, pending, iban, n)
    where exists (select 1 from sage_companies c where c.code = x.company_code)
    order by x.company_code, x.movement_id, x.n desc
    on conflict (company_code, movement_id) do update set remittance_number = excluded.remittance_number,
      effect_number = excluded.effect_number, supplier_code = excluded.supplier_code, invoice_number = excluded.invoice_number,
      invoice_date = excluded.invoice_date, due_date = excluded.due_date, amount = excluded.amount, pending = excluded.pending,
      iban = excluded.iban;
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('payment_items', v_n);
    if v_total > v_n then v_counts := v_counts || jsonb_build_object('payment_items_repeated', v_total - v_n); end if;
  end if;

  if jsonb_typeof(p->'open_items') = 'array' then
    if coalesce((p->>'open_items_replace')::boolean, false) then
      delete from sage_open_items where id is not null;
    end if;
    insert into sage_open_items (company_code, kind, movement_id, counterpart_code, invoice_number, invoice_date, due_date,
      amount, pending, remittance_number, bank_code, effect_type, taken_on, is_returned, returned_on)
    select x.company_code, x.kind, x.movement_id, x.counterpart_code, x.invoice_number, x.invoice_date, x.due_date,
      coalesce(x.amount, 0), coalesce(x.pending, 0), x.remittance_number, x.bank_code, x.effect_type, coalesce(x.taken_on, current_date),
      coalesce(x.is_returned, false), x.returned_on
    from jsonb_to_recordset(p->'open_items') as x(company_code smallint, kind text, movement_id text, counterpart_code text,
      invoice_number text, invoice_date date, due_date date, amount numeric, pending numeric, remittance_number integer,
      bank_code text, effect_type text, taken_on date, is_returned boolean, returned_on date)
    where exists (select 1 from sage_companies c where c.code = x.company_code) and x.kind in ('cobro', 'pago');
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('open_items', v_n);
  end if;

  -- Albaranes sin facturar: una foto que llega entera en cada lectura; el primer
  -- trozo borra la anterior (un albarán facturado desde entonces desaparece).
  if jsonb_typeof(p->'uninvoiced_notes') = 'array' then
    if coalesce((p->>'uninvoiced_notes_replace')::boolean, false) then
      delete from sage_uninvoiced_notes where true;
    end if;
    insert into sage_uninvoiced_notes (company_code, year, series, number, note_date, customer_code, rep_code, net_amount,
      billing_period, taken_on)
    select distinct on (x.company_code, x.year, coalesce(x.series, ''), x.number) x.company_code, x.year, coalesce(x.series, ''),
      x.number, x.note_date, x.customer_code, x.rep_code, coalesce(x.net_amount, 0), x.billing_period, coalesce(x.taken_on, current_date)
    from rows from (jsonb_to_recordset(p->'uninvoiced_notes') as (company_code smallint, year smallint, series text, number integer,
      note_date date, customer_code text, rep_code integer, net_amount numeric, billing_period text, taken_on date))
      with ordinality as x(company_code, year, series, number, note_date, customer_code, rep_code, net_amount, billing_period, taken_on, n)
    where exists (select 1 from sage_companies c where c.code = x.company_code) and x.number is not null and x.note_date is not null
    order by x.company_code, x.year, coalesce(x.series, ''), x.number, x.n desc
    on conflict (company_code, year, series, number) do update set note_date = excluded.note_date,
      customer_code = excluded.customer_code, rep_code = excluded.rep_code, net_amount = excluded.net_amount,
      billing_period = excluded.billing_period, taken_on = excluded.taken_on;
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('uninvoiced_notes', v_n);
  end if;

  -- Las cuentas de los bancos, con la línea de riesgo y lo dispuesto.
  if jsonb_typeof(p->'bank_accounts') = 'array' then
    insert into sage_bank_accounts (company_code, account_code, bank_code, bank_name, description, iban, credit_limit, credit_used, updated_at)
    select distinct on (x.company_code, x.account_code) x.company_code, x.account_code, x.bank_code, x.bank_name, x.description,
      x.iban, x.credit_limit, x.credit_used, now()
    from rows from (jsonb_to_recordset(p->'bank_accounts') as (company_code smallint, account_code text, bank_code text,
      bank_name text, description text, iban text, credit_limit numeric, credit_used numeric))
      with ordinality as x(company_code, account_code, bank_code, bank_name, description, iban, credit_limit, credit_used, n)
    where exists (select 1 from sage_companies c where c.code = x.company_code) and x.account_code is not null
    order by x.company_code, x.account_code, x.n desc
    on conflict (company_code, account_code) do update set bank_code = excluded.bank_code, bank_name = excluded.bank_name,
      description = excluded.description, iban = excluded.iban, credit_limit = excluded.credit_limit,
      credit_used = excluded.credit_used, updated_at = now();
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('bank_accounts', v_n);
  end if;

  -- El saldo de cada cuenta día a día: llega entero y sustituye al anterior.
  if jsonb_typeof(p->'bank_balances') = 'array' then
    if coalesce((p->>'bank_balances_replace')::boolean, false) then
      delete from sage_bank_balances where true;
    end if;
    insert into sage_bank_balances (company_code, account_code, day, balance, movement)
    select distinct on (x.company_code, x.account_code, x.day) x.company_code, x.account_code, x.day, coalesce(x.balance, 0),
      coalesce(x.movement, 0)
    from rows from (jsonb_to_recordset(p->'bank_balances') as (company_code smallint, account_code text, day date,
      balance numeric, movement numeric))
      with ordinality as x(company_code, account_code, day, balance, movement, n)
    where exists (select 1 from sage_companies c where c.code = x.company_code) and x.account_code is not null and x.day is not null
    order by x.company_code, x.account_code, x.day, x.n desc
    on conflict (company_code, account_code, day) do update set balance = excluded.balance, movement = excluded.movement;
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('bank_balances', v_n);
  end if;

  return v_counts;
end;
$$;

revoke execute on function public.sage_ingest_payments(jsonb) from public, anon, authenticated;
grant execute on function public.sage_ingest_payments(jsonb) to service_role;

-- ----- Lo que lee la página -----

-- Los recibos de cobro pendientes, con el cliente, su comercial, su persona de
-- contacto (la comercial si la hay; si no, la primera con teléfono) y su límite.
create or replace function public.admin_receivables()
returns table(company_code smallint, customer_code text, customer_name text, rep_code integer, phone text, email text,
  contact_name text, contact_phone text, contact_email text, credit_limit numeric, is_blocked boolean,
  invoice_number text, invoice_date date, due_date date, amount numeric, pending numeric, remittance_number integer,
  effect_type text, is_returned boolean, returned_on date)
language sql
stable
set search_path = public
as $$
  select o.company_code, o.counterpart_code, coalesce(c.name, 'Cliente ' || o.counterpart_code), c.rep_code, c.phone, c.email,
    k.name, k.phone, k.email, c.credit_limit, coalesce(c.is_blocked, false),
    o.invoice_number, o.invoice_date, o.due_date, o.amount, o.pending, o.remittance_number, o.effect_type,
    o.is_returned, o.returned_on
  from sage_open_items o
  left join sage_customers c on c.company_code = o.company_code and c.code = o.counterpart_code
  left join lateral (
    select x.name, coalesce(x.phone, x.phone2, x.phone3) as phone, x.email
    from sage_customer_contacts x
    where x.company_code = o.company_code and x.customer_code = o.counterpart_code
    order by x.is_commercial desc, (coalesce(x.phone, x.phone2, x.phone3) is null), x.position
    limit 1
  ) k on true
  where o.kind = 'cobro' and o.pending <> 0;
$$;
revoke all on function public.admin_receivables() from public, anon;
grant execute on function public.admin_receivables() to authenticated, service_role;

-- Los pagos pendientes a proveedores, con su nombre.
create or replace function public.admin_payables()
returns table(company_code smallint, supplier_code text, supplier_name text, phone text, email text, invoice_number text,
  invoice_date date, due_date date, amount numeric, pending numeric, remittance_number integer, bank_code text, effect_type text)
language sql
stable
set search_path = public
as $$
  select o.company_code, o.counterpart_code, coalesce(s.name, 'Proveedor ' || o.counterpart_code), s.phone, s.email,
    o.invoice_number, o.invoice_date, o.due_date, o.amount, o.pending, o.remittance_number, o.bank_code, o.effect_type
  from sage_open_items o
  left join sage_suppliers s on s.company_code = o.company_code and s.code = o.counterpart_code
  where o.kind = 'pago' and o.pending <> 0;
$$;
revoke all on function public.admin_payables() from public, anon;
grant execute on function public.admin_payables() to authenticated, service_role;

-- Los albaranes sin facturar, con el nombre del cliente.
create or replace function public.admin_uninvoiced()
returns table(company_code smallint, year smallint, series text, number integer, note_date date, customer_code text,
  customer_name text, rep_code integer, net_amount numeric, billing_period text, taken_on date)
language sql
stable
set search_path = public
as $$
  select u.company_code, u.year, u.series, u.number, u.note_date, u.customer_code,
    coalesce(c.name, case when u.customer_code is null then 'Sin cliente' else 'Cliente ' || u.customer_code end),
    u.rep_code, u.net_amount, u.billing_period, u.taken_on
  from sage_uninvoiced_notes u
  left join sage_customers c on c.company_code = u.company_code and c.code = u.customer_code;
$$;
revoke all on function public.admin_uninvoiced() from public, anon;
grant execute on function public.admin_uninvoiced() to authenticated, service_role;
