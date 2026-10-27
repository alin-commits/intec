-- Qué clientes compran una subfamilia.
--
-- El filtro de subfamilia del panel solo lo podía aplicar la pantalla de
-- productos: la venta por cliente se guarda por familia y ahí abajo no había
-- nada que filtrar. Esto le añade la subfamilia a ese reparto y se la pasa a
-- las cuatro funciones de clientes que ya filtraban por familia.
--
-- Qué hace falta después de aplicarla: copiar al servidor de Sage el agente
-- «2026-10-26 subfamilia-y-pasado-a-proveedor» o posterior —es el que manda la subfamilia
-- de cada línea— y pedirle una lectura del histórico. Hasta que esa lectura
-- pase, los meses ya cargados tienen la subfamilia en blanco y filtrar por
-- subfamilia en clientes no devuelve a nadie; el filtro por familia sigue
-- funcionando igual, porque suma todas las subfamilias de la familia.
--
-- La columna se puede añadir sin tocar lo que hay: esa tabla no tiene clave
-- única, la ingesta borra el tramo de meses que trae y lo reinserta entero.
-- Así que una relectura la deja bien sin duplicar ni una fila.
--
-- Las funciones se borran antes de crearse: añadir un parámetro crea una
-- sobrecarga nueva, y con dos versiones conviviendo PostgREST no sabe a cuál
-- llamar y devuelve 300 (PGRST203) en vez de datos.
--
-- Se puede volver a ejecutar sin romper nada.

alter table public.sage_customer_families_monthly
  add column if not exists subfamily_code text not null default '';

comment on column public.sage_customer_families_monthly.subfamily_code is
  'La subfamilia del artículo. En blanco en los meses leídos antes del 26/10/2026.';

-- El filtro mira cliente y familia a la vez; con la subfamilia dentro, el
-- índice que ya había sigue sirviendo para encontrar las filas del cliente.
create index if not exists sage_customer_families_sub_idx
  on public.sage_customer_families_monthly (company_code, family_code, subfamily_code);

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
    insert into sage_customer_families_monthly (company_code, customer_code, month, family_code, subfamily_code,
                                                net_amount, cost_amount, net_without_cost, gross_amount)
    select x.company_code, x.customer_code, x.month, coalesce(x.family_code, ''), coalesce(x.subfamily_code, ''),
           x.net_amount, coalesce(x.cost_amount, 0), coalesce(x.net_without_cost, 0), x.gross_amount
    from jsonb_to_recordset(p->'customer_families') as x(company_code smallint, customer_code text, month date, family_code text,
         subfamily_code text, net_amount numeric, cost_amount numeric, net_without_cost numeric, gross_amount numeric);
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

drop function if exists public.sage_customer_segments(text, date, date, smallint[], text[], text[], text[], date, text[]);
drop function if exists public.sage_customer_segments(text, date, date, smallint, text[], text[], text, date);
drop function if exists public.sage_customer_segments(text, date, date, smallint, text[], text[], text, date, text[]);
create or replace function public.sage_customer_segments(p_dim text, p_from date, p_to date, p_companies smallint[] default null,
  p_reps text[] default null, p_series text[] default null, p_families text[] default null, p_cost_from date default '2025-11-01',
  p_months text[] default null,
  p_subfamilies text[] default null)
returns table(code text, name text, customers bigint, net_amount numeric, gross_amount numeric, gross_net numeric,
  trusted_net numeric, trusted_cost numeric, trusted_without_cost numeric)
language sql
stable
set search_path = public
as $$
  with filas as (
    select d.*,
      case p_dim
        when 'zona' then c.zone_code
        when 'sector' then c.sector_code
        when 'canal' then c.channel_code
        when 'forma_pago' then c.payment_method
        -- En Sage la misma provincia está escrita de varias maneras ("Alicante/Alacant",
        -- "ALICANTE", "Valencia/Valéncia"): se agrupa sin tildes, sin mayúsculas y
        -- con lo de antes de la barra, y se enseña como más veces esté escrita.
        when 'provincia' then nullif(translate(upper(btrim(split_part(c.province, '/', 1))),
          'ÁÉÍÓÚÀÈÌÒÙÄËÏÖÜÂÊÎÔÛ', 'AEIOUAEIOUAEIOUAEIOU'), '')
      end as valor,
      case when p_dim = 'provincia' then nullif(initcap(lower(btrim(split_part(c.province, '/', 1)))), '') end as visible
    from sage_customer_days d
    left join sage_customers c on c.company_code = d.company_code and c.code = d.customer_code
    where d.day between p_from and p_to
      and (p_months is null or to_char(d.day, 'YYYY-MM') = any(p_months))
      and (p_companies is null or d.company_code = any(p_companies))
      and (p_reps is null or (d.company_code::text || ':' || coalesce(d.rep_code::text, 'sin')) = any(p_reps))
      and (p_series is null or d.series = any(p_series))
      and ((p_families is null and p_subfamilies is null) or exists (
        select 1 from sage_customer_families_monthly m
        where m.company_code = d.company_code and m.customer_code = d.customer_code and (p_families is null or m.family_code = any(p_families))
          and (p_subfamilies is null or (m.family_code || ':' || m.subfamily_code) = any(p_subfamilies))
          and m.month between date_trunc('month', p_from)::date and p_to
          and (p_months is null or to_char(m.month, 'YYYY-MM') = any(p_months))))
  ),
  grupos as (
    select coalesce(f.valor, '') as valor,
      mode() within group (order by f.visible) as visible,
      count(distinct (f.company_code, f.customer_code)) as clientes,
      sum(f.net_amount) as neto,
      coalesce(sum(f.gross_amount), 0) as bruto,
      coalesce(sum(f.net_amount) filter (where f.gross_amount is not null), 0) as neto_con_bruto,
      coalesce(sum(f.net_amount) filter (where f.day >= p_cost_from), 0) as neto_fiable,
      coalesce(sum(f.cost_amount) filter (where f.day >= p_cost_from), 0) as coste_fiable,
      coalesce(sum(f.net_without_cost) filter (where f.day >= p_cost_from), 0) as sin_coste_fiable
    from filas f
    group by coalesce(f.valor, '')
  ),
  -- El nombre de cada código sale de las tablas de códigos de Sage, buscadas por
  -- la columna (CodigoZona...): la tabla se llama distinto en cada instalación.
  nombres as (
    select l.code, max(l.name) as name
    from sage_lookups l
    where l.code_column = any(case p_dim
      when 'zona' then array['CodigoZona']
      when 'sector' then array['CodigoSector_', 'CodigoSector']
      when 'canal' then array['CodigoCanal']
      when 'forma_pago' then array['FormadePago', 'CodigoFormaPago']
      else array[]::text[] end)
    group by l.code
  )
  select g.valor, case when g.valor = '' then null when p_dim = 'provincia' then g.visible else n.name end,
    g.clientes, g.neto, g.bruto, g.neto_con_bruto, g.neto_fiable, g.coste_fiable, g.sin_coste_fiable
  from grupos g
  left join nombres n on n.code = g.valor
  order by g.neto desc;
$$;
revoke all on function public.sage_customer_segments(text, date, date, smallint[], text[], text[], text[], date, text[], text[]) from public, anon;
grant execute on function public.sage_customer_segments(text, date, date, smallint[], text[], text[], text[], date, text[], text[]) to authenticated, service_role;

drop function if exists public.sage_customer_counts(date, date, smallint[], text[], text[], text[], text[]);
drop function if exists public.sage_customer_counts(date, date, smallint, text[], text[], text);
drop function if exists public.sage_customer_counts(date, date, smallint, text[], text[], text, text[]);
create or replace function public.sage_customer_counts(
  p_from date, p_to date, p_companies smallint[] default null, p_reps text[] default null,
  p_series text[] default null, p_families text[] default null, p_months text[] default null
,
  p_subfamilies text[] default null)
returns table(
  activos bigint, nuevos bigint, recurrentes bigint, recuperados bigint, perdidos bigint,
  sin_compra_30 bigint, sin_compra_60 bigint, sin_compra_90 bigint,
  neto_activos numeric, neto_recurrentes numeric, neto_perdidos numeric
)
language sql
stable
set search_path to 'public'
as $$
  with anio as (
    -- El año anterior al del final del periodo: ahí compraban los perdidos.
    select make_date(extract(year from p_to)::int - 1, 1, 1) as desde,
           make_date(extract(year from p_to)::int - 1, 12, 31) as hasta
  ),
  historia as (
    select d.company_code, d.customer_code, min(d.day) as primera, max(d.day) as ultima
    from sage_customer_days d
    where (p_companies is null or d.company_code = any(p_companies)) and d.day <= p_to
    group by d.company_code, d.customer_code
  ),
  filtradas as (
    select d.company_code, d.customer_code, d.day, d.net_amount,
      -- "En el periodo" es dentro del tramo y, si hay meses marcados, en uno de
      -- ellos. Las ventanas de perdidos y del año móvil no lo usan.
      d.day between p_from and p_to
        and (p_months is null or to_char(d.day, 'YYYY-MM') = any(p_months)) as en_periodo
    from sage_customer_days d
    cross join anio a
    where (p_companies is null or d.company_code = any(p_companies))
      and d.day between least(p_from, p_to - 365, a.desde) and p_to
      and (p_reps is null or (d.company_code::text || ':' || coalesce(d.rep_code::text, 'sin')) = any(p_reps))
      and (p_series is null or d.series = any(p_series))
  ),
  por_cliente as (
    select f.company_code, f.customer_code, h.primera, h.ultima,
      bool_or(f.en_periodo) as activo,
      coalesce(sum(f.net_amount) filter (where f.en_periodo), 0) as neto,
      min(f.day) filter (where f.en_periodo) as primera_en_periodo,
      bool_or(f.day = h.primera and f.en_periodo) as hizo_la_primera,
      bool_or(f.day between a.desde and a.hasta) as en_perdidos,
      coalesce(sum(f.net_amount) filter (where f.day between a.desde and a.hasta), 0) as neto_perdidos,
      bool_or(f.day between p_to - 365 and p_to) as en_anual,
      count(distinct f.day) filter (where f.day between a.desde and a.hasta) as dias_perdidos,
      count(distinct f.day) filter (where f.day between p_to - 365 and p_to) as dias_anual
    from filtradas f
    join historia h on h.company_code = f.company_code and h.customer_code = f.customer_code
    cross join anio a
    group by f.company_code, f.customer_code, h.primera, h.ultima
  ),
  con_familia as (
    select p.*,
      (p_families is null and p_subfamilies is null) or exists (select 1 from sage_customer_families_monthly m
        where m.company_code = p.company_code and m.customer_code = p.customer_code and (p_families is null or m.family_code = any(p_families))
          and (p_subfamilies is null or (m.family_code || ':' || m.subfamily_code) = any(p_subfamilies))
          and m.month between date_trunc('month', p_from)::date and p_to
          and (p_months is null or to_char(m.month, 'YYYY-MM') = any(p_months))) as fam_periodo,
      (p_families is null and p_subfamilies is null) or exists (select 1 from sage_customer_families_monthly m, anio a
        where m.company_code = p.company_code and m.customer_code = p.customer_code and (p_families is null or m.family_code = any(p_families))
          and (p_subfamilies is null or (m.family_code || ':' || m.subfamily_code) = any(p_subfamilies))
          and m.month between a.desde and a.hasta) as fam_perdidos,
      (p_families is null and p_subfamilies is null) or exists (select 1 from sage_customer_families_monthly m
        where m.company_code = p.company_code and m.customer_code = p.customer_code and (p_families is null or m.family_code = any(p_families))
          and (p_subfamilies is null or (m.family_code || ':' || m.subfamily_code) = any(p_subfamilies))
          and m.month between date_trunc('month', p_to - 365)::date and p_to) as fam_anual,
      p.activo and exists (select 1 from sage_customer_days d
        where d.company_code = p.company_code and d.customer_code = p.customer_code
          and d.day between p_from - 365 and p_from - 1) as recurrente,
      p.activo and coalesce((select p.primera_en_periodo - max(d.day) from sage_customer_days d
        where d.company_code = p.company_code and d.customer_code = p.customer_code and d.day < p.primera_en_periodo), 0) >= 180 as recuperado,
      -- Perdido: compraba el año pasado y su última compra es de entonces.
      p.en_perdidos and p.dias_perdidos >= 2 and p.neto_perdidos > 0
        and p.ultima <= (select hasta from anio) as perdido
    from por_cliente p
  )
  select
    count(*) filter (where activo and fam_periodo),
    count(*) filter (where activo and fam_periodo and primera between p_from and p_to and hizo_la_primera),
    count(*) filter (where recurrente and fam_periodo),
    count(*) filter (where recuperado and fam_periodo),
    count(*) filter (where perdido and fam_perdidos),
    count(*) filter (where en_anual and dias_anual >= 2 and ultima <= p_to - 30 and ultima > p_to - 365 and fam_anual),
    count(*) filter (where en_anual and dias_anual >= 2 and ultima <= p_to - 60 and ultima > p_to - 365 and fam_anual),
    count(*) filter (where en_anual and dias_anual >= 2 and ultima <= p_to - 90 and ultima > p_to - 365 and fam_anual),
    coalesce(sum(neto) filter (where activo and fam_periodo), 0),
    coalesce(sum(neto) filter (where recurrente and fam_periodo), 0),
    coalesce(sum(neto_perdidos) filter (where perdido and fam_perdidos), 0)
  from con_familia;
$$;
revoke all on function public.sage_customer_counts(date, date, smallint[], text[], text[], text[], text[], text[]) from public, anon;
grant execute on function public.sage_customer_counts(date, date, smallint[], text[], text[], text[], text[], text[]) to authenticated, service_role;

drop function if exists public.sage_customer_list(text, date, date, smallint[], text[], text[], text[], integer, text[]);
drop function if exists public.sage_customer_list(text, date, date, smallint, text[], text[], text, integer);
drop function if exists public.sage_customer_list(text, date, date, smallint, text[], text[], text, integer, text[]);
create or replace function public.sage_customer_list(
  p_kind text, p_from date, p_to date, p_companies smallint[] default null, p_reps text[] default null,
  p_series text[] default null, p_families text[] default null, p_days integer default 30,
  p_months text[] default null
,
  p_subfamilies text[] default null)
returns table(
  company_code smallint, customer_code text, name text, trade_name text, phone text, email text,
  province text, municipality text, rep_code integer, first_purchase date, last_purchase date,
  net_amount numeric, documents bigint, days_since_last integer,
  contact_name text, contact_phone text, contact_email text, gross_amount numeric, gross_net numeric
)
language sql
stable
set search_path to 'public'
as $$
  with ventana as (
    -- Los perdidos se miran en el año anterior al del final del periodo.
    select
      case p_kind
        when 'perdidos' then make_date(extract(year from p_to)::int - 1, 1, 1)
        when 'sin_compra' then p_to - 365
        else p_from end as desde,
      case p_kind
        when 'perdidos' then make_date(extract(year from p_to)::int - 1, 12, 31)
        else p_to end as hasta,
      -- Los meses marcados solo recortan cuando la ventana ES el periodo: para
      -- perdidos y sin compra son otras fechas a propósito, y filtrarlas por
      -- los meses dejaría la lista vacía.
      case when p_kind in ('perdidos', 'sin_compra') then null else p_months end as meses
  ),
  historia as (
    select d.company_code, d.customer_code, min(d.day) as primera, max(d.day) as ultima
    from sage_customer_days d
    where (p_companies is null or d.company_code = any(p_companies)) and d.day <= p_to
    group by d.company_code, d.customer_code
  ),
  filtradas as (
    select d.*, (v.meses is null or to_char(d.day, 'YYYY-MM') = any(v.meses)) as mes_ok
    from sage_customer_days d
    cross join ventana v
    where (p_companies is null or d.company_code = any(p_companies))
      and d.day between least(p_from, p_to - 365, v.desde) and p_to
      and (p_reps is null or (d.company_code::text || ':' || coalesce(d.rep_code::text, 'sin')) = any(p_reps))
      and (p_series is null or d.series = any(p_series))
  ),
  por_cliente as (
    select f.company_code, f.customer_code,
      sum(f.net_amount) filter (where f.day between v.desde and v.hasta and f.mes_ok) as neto,
      sum(f.documents) filter (where f.day between v.desde and v.hasta and f.mes_ok) as documentos,
      -- El descuento de cada cliente: el bruto y el neto de lo que lo trae.
      sum(f.gross_amount) filter (where f.day between v.desde and v.hasta and f.mes_ok) as bruto,
      sum(f.net_amount) filter (where f.day between v.desde and v.hasta and f.mes_ok and f.gross_amount is not null) as neto_con_bruto,
      min(f.day) filter (where f.day between p_from and p_to and f.mes_ok) as primera_en_periodo,
      bool_or(f.day between v.desde and v.hasta and f.mes_ok) as en_ventana,
      count(distinct f.day) filter (where f.day between v.desde and v.hasta and f.mes_ok) as dias_con_compra
    from filtradas f
    cross join ventana v
    group by f.company_code, f.customer_code
  ),
  elegidos as (
    select p.*, h.primera, h.ultima
    from por_cliente p
    join historia h on h.company_code = p.company_code and h.customer_code = p.customer_code
    cross join ventana v
    where p.en_ventana
      and case p_kind
        when 'activos' then true
        when 'nuevos' then h.primera between p_from and p_to
          and exists (select 1 from filtradas f where f.company_code = p.company_code and f.customer_code = p.customer_code
                        and f.day = h.primera and f.mes_ok)
        when 'recurrentes' then exists (
          select 1 from sage_customer_days d
          where d.company_code = p.company_code and d.customer_code = p.customer_code and d.day between p_from - 365 and p_from - 1)
        when 'recuperados' then coalesce((
          select p.primera_en_periodo - max(d.day) from sage_customer_days d
          where d.company_code = p.company_code and d.customer_code = p.customer_code and d.day < p.primera_en_periodo), 0) >= 180
        -- Compraba el año pasado y su última compra es de entonces: este año, nada.
        when 'perdidos' then h.ultima between v.desde and v.hasta and coalesce(p.neto, 0) > 0 and p.dias_con_compra >= 2
        when 'sin_compra' then h.ultima <= p_to - greatest(p_days, 1) and h.ultima > p_to - 365 and p.dias_con_compra >= 2
        else false
      end
      and ((p_families is null and p_subfamilies is null) or exists (
        select 1 from sage_customer_families_monthly m
        where m.company_code = p.company_code and m.customer_code = p.customer_code and (p_families is null or m.family_code = any(p_families))
          and (p_subfamilies is null or (m.family_code || ':' || m.subfamily_code) = any(p_subfamilies))
          and m.month between date_trunc('month', v.desde)::date and v.hasta
          and (v.meses is null or to_char(m.month, 'YYYY-MM') = any(v.meses))))
  )
  select e.company_code, e.customer_code,
    coalesce(c.name, 'Cliente ' || e.customer_code), c.trade_name, c.phone, c.email, c.province, c.municipality, c.rep_code,
    e.primera, e.ultima, coalesce(e.neto, 0), coalesce(e.documentos, 0)::bigint, (p_to - e.ultima)::integer,
    k.name, k.phone, k.email, coalesce(e.bruto, 0), coalesce(e.neto_con_bruto, 0)
  from elegidos e
  left join sage_customers c on c.company_code = e.company_code and c.code = e.customer_code
  -- La persona a la que llamar: la marcada como contacto comercial y, si no hay,
  -- la primera que tenga teléfono.
  left join lateral (
    select x.name, coalesce(x.phone, x.phone2, x.phone3) as phone, x.email
    from sage_customer_contacts x
    where x.company_code = e.company_code and x.customer_code = e.customer_code
    order by x.is_commercial desc, (coalesce(x.phone, x.phone2, x.phone3) is null), x.position
    limit 1
  ) k on true
  order by coalesce(e.neto, 0) desc, e.customer_code;
$$;
revoke all on function public.sage_customer_list(text, date, date, smallint[], text[], text[], text[], integer, text[], text[]) from public, anon;
grant execute on function public.sage_customer_list(text, date, date, smallint[], text[], text[], text[], integer, text[], text[]) to authenticated, service_role;

drop function if exists public.sage_rep_customers(date, date, smallint[], text[], text[], text[], text[]);
drop function if exists public.sage_rep_customers(date, date, smallint, text[], text[], text);
drop function if exists public.sage_rep_customers(date, date, smallint, text[], text[], text, text[]);
create or replace function public.sage_rep_customers(
  p_from date,
  p_to date,
  p_companies smallint[] default null,
  p_reps text[] default null,
  p_series text[] default null,
  p_families text[] default null,
  p_months text[] default null
,
  p_subfamilies text[] default null)
returns table(
  company_code smallint,
  customer_code text,
  name text,
  trade_name text,
  rep_code integer,
  province text,
  municipality text,
  phone text,
  email text,
  left_on date,
  net_amount numeric,
  documents bigint,
  previous_amount numeric,
  first_purchase date,
  last_purchase date,
  days_since_last integer,
  families jsonb
)
language sql
stable
set search_path to 'public'
as $$
  with cartera as (
    select c.company_code, c.code as customer_code, c.name, c.trade_name, c.rep_code,
           c.province, c.municipality, c.phone, c.email, c.left_on
    from sage_customers c
    where (p_companies is null or c.company_code = any(p_companies))
      -- Misma forma que el resto del panel: "sociedad:comercial", y 'sin' para
      -- los que no tienen ninguno.
      and (p_reps is null or (c.company_code::text || ':' || coalesce(c.rep_code::text, 'sin')) = any(p_reps))
  ),
  movimientos as (
    select d.company_code, d.customer_code,
      sum(d.net_amount) filter (where d.day between p_from and p_to
        and (p_months is null or to_char(d.day, 'YYYY-MM') = any(p_months))) as neto,
      sum(d.documents) filter (where d.day between p_from and p_to
        and (p_months is null or to_char(d.day, 'YYYY-MM') = any(p_months))) as albaranes,
      -- "Lo anterior" son los 365 días de antes del periodo: es lo que distingue
      -- al que nunca compró del que ha dejado de comprar, y no se recorta.
      sum(d.net_amount) filter (where d.day between p_from - 365 and p_from - 1) as neto_anterior,
      min(d.day) as primera,
      max(d.day) as ultima
    from sage_customer_days d
    where (p_companies is null or d.company_code = any(p_companies))
      and (p_series is null or d.series = any(p_series))
      and d.day <= p_to
    group by d.company_code, d.customer_code
  ),
  familias as (
    select m.company_code, m.customer_code,
      jsonb_agg(jsonb_build_object('code', m.family_code, 'name', coalesce(f.name, m.family_code), 'net', round(m.neto, 2))
                order by m.neto desc) as detalle
    from (
      select m.company_code, m.customer_code, m.family_code, sum(m.net_amount) as neto
      from sage_customer_families_monthly m
      where (p_companies is null or m.company_code = any(p_companies))
        -- Los meses que toca el periodo. El mes es la unidad más fina que hay.
        and m.month between date_trunc('month', p_from)::date and p_to
        and (p_months is null or to_char(m.month, 'YYYY-MM') = any(p_months))
      group by m.company_code, m.customer_code, m.family_code
      having sum(m.net_amount) <> 0
    ) m
    left join sage_families f on f.company_code = m.company_code and f.code = m.family_code
    group by m.company_code, m.customer_code
  )
  select c.company_code, c.customer_code, c.name, c.trade_name, c.rep_code,
         c.province, c.municipality, c.phone, c.email, c.left_on,
         coalesce(mv.neto, 0) as net_amount,
         coalesce(mv.albaranes, 0)::bigint as documents,
         coalesce(mv.neto_anterior, 0) as previous_amount,
         mv.primera as first_purchase,
         mv.ultima as last_purchase,
         case when mv.ultima is null then null else (p_to - mv.ultima)::integer end as days_since_last,
         coalesce(fa.detalle, '[]'::jsonb) as families
  from cartera c
  left join movimientos mv on mv.company_code = c.company_code and mv.customer_code = c.customer_code
  left join familias fa on fa.company_code = c.company_code and fa.customer_code = c.customer_code
  where (p_families is null and p_subfamilies is null) or exists (
    select 1 from sage_customer_families_monthly m
    where m.company_code = c.company_code and m.customer_code = c.customer_code
      and (p_families is null or m.family_code = any(p_families))
      and (p_subfamilies is null or (m.family_code || ':' || m.subfamily_code) = any(p_subfamilies))
      and m.month between date_trunc('month', p_from)::date and p_to
      and (p_months is null or to_char(m.month, 'YYYY-MM') = any(p_months))
  );
$$;
revoke all on function public.sage_rep_customers(date, date, smallint[], text[], text[], text[], text[], text[]) from public, anon;
grant execute on function public.sage_rep_customers(date, date, smallint[], text[], text[], text[], text[], text[]) to authenticated, service_role;
