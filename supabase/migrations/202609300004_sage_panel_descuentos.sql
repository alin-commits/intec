-- El panel de Ventas del director comercial: descuentos, comisiones, venta por
-- tipo de cliente y la persona de contacto en las listas.
--
-- Las funciones que lee el panel devuelven ahora, además de lo que ya daban:
--   - gross_amount: el bruto antes de descuentos;
--   - gross_net: la venta neta de las filas que tienen bruto. Lo cargado antes de
--     que el agente leyera el bruto lo tiene nulo, y el descuento se mide con los
--     dos sobre las mismas filas: si no, faltaría bruto y saldría más descuento;
--   - en el resumen de ventas, además, el descuento de línea (el que pone el
--     comercial), el rappel y la comisión.
-- Cambiar lo que devuelve una función obliga a borrarla y crearla de nuevo.
--
-- Nuevas:
--   - sage_customer_segments: venta por zona, sector, canal, forma de pago o
--     provincia del cliente, con los mismos filtros que las listas de clientes.
--   - sage_customer_list devuelve el contacto de cada cliente (el comercial si lo
--     hay; si no, el primero con teléfono).

-- ----- Resumen de ventas por mes, sociedad, serie y comercial -----
drop function if exists public.sage_sales_summary(date, date, text);
create function public.sage_sales_summary(p_from date, p_to date, p_basis text default 'albaran')
returns table(month text, company_code smallint, series text, rep_code integer, documents bigint, net_amount numeric,
  cost_amount numeric, net_without_cost numeric, gross_amount numeric, gross_net numeric, line_discount_amount numeric,
  rappel_amount numeric, commission_amount numeric)
language sql
stable
set search_path = public
as $$
  select
    to_char(s.day, 'YYYY-MM') as month,
    s.company_code,
    s.series,
    s.rep_code,
    sum(s.documents)::bigint as documents,
    sum(s.net_amount) as net_amount,
    sum(s.cost_amount) as cost_amount,
    sum(s.net_without_cost) as net_without_cost,
    coalesce(sum(s.gross_amount), 0) as gross_amount,
    coalesce(sum(s.net_amount) filter (where s.gross_amount is not null), 0) as gross_net,
    coalesce(sum(s.line_discount_amount), 0) as line_discount_amount,
    coalesce(sum(s.rappel_amount), 0) as rappel_amount,
    coalesce(sum(s.commission_amount), 0) as commission_amount
  from public.sage_sales_daily s
  where s.basis = p_basis
    and s.day >= p_from
    and s.day <= p_to
  group by to_char(s.day, 'YYYY-MM'), s.company_code, s.series, s.rep_code;
$$;
revoke all on function public.sage_sales_summary(date, date, text) from public, anon;
grant execute on function public.sage_sales_summary(date, date, text) to authenticated, service_role;

-- ----- Familias -----
drop function if exists public.sage_family_summary(date, date, date);
create function public.sage_family_summary(p_from date, p_to date, p_cost_from date default '2025-11-01')
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
  group by f.company_code, f.family_code;
$$;
revoke all on function public.sage_family_summary(date, date, date) from public, anon;
grant execute on function public.sage_family_summary(date, date, date) to authenticated, service_role;

-- ----- Artículos -----
drop function if exists public.sage_article_summary(date, date, smallint, text, text, text, integer, date);
create function public.sage_article_summary(p_from date, p_to date, p_company smallint default null, p_family text default null,
  p_subfamily text default null, p_brand text default null, p_limit integer default 50, p_cost_from date default '2025-11-01')
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
    and (p_company is null or s.company_code = p_company)
    and (p_family is null or s.family_code = p_family)
    and (p_subfamily is null or s.subfamily_code = p_subfamily)
    and (p_brand is null or coalesce(a.brand, '') = p_brand)
  group by s.article_code, s.family_code
  order by sum(s.net_amount) desc
  limit greatest(p_limit, 1);
$$;
revoke all on function public.sage_article_summary(date, date, smallint, text, text, text, integer, date) from public, anon;
grant execute on function public.sage_article_summary(date, date, smallint, text, text, text, integer, date) to authenticated, service_role;

-- ----- Subfamilias y marcas -----
drop function if exists public.sage_article_groups(text, date, date, smallint, text, date);
create function public.sage_article_groups(p_group text, p_from date, p_to date, p_company smallint default null,
  p_family text default null, p_cost_from date default '2025-11-01')
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
      and (p_company is null or s.company_code = p_company)
      and (p_family is null or s.family_code = p_family)
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
revoke all on function public.sage_article_groups(text, date, date, smallint, text, date) from public, anon;
grant execute on function public.sage_article_groups(text, date, date, smallint, text, date) to authenticated, service_role;

-- ----- Listas de clientes, con su persona de contacto -----
drop function if exists public.sage_customer_list(text, date, date, smallint, text[], text[], text, integer);
create function public.sage_customer_list(p_kind text, p_from date, p_to date, p_company smallint default null,
  p_reps text[] default null, p_series text[] default null, p_family text default null, p_days integer default 30)
returns table(company_code smallint, customer_code text, name text, trade_name text, phone text, email text, province text,
  municipality text, rep_code integer, first_purchase date, last_purchase date, net_amount numeric, documents bigint,
  days_since_last integer, contact_name text, contact_phone text, contact_email text, gross_amount numeric, gross_net numeric)
language sql
stable
set search_path = public
as $$
  with ventana as (
    select
      case p_kind when 'perdidos' then p_to - 455 when 'sin_compra' then p_to - 365 else p_from end as desde,
      case p_kind when 'perdidos' then p_to - 91 else p_to end as hasta
  ),
  historia as (
    select d.company_code, d.customer_code, min(d.day) as primera, max(d.day) as ultima
    from sage_customer_days d
    where (p_company is null or d.company_code = p_company) and d.day <= p_to
    group by d.company_code, d.customer_code
  ),
  filtradas as (
    select d.*
    from sage_customer_days d
    where (p_company is null or d.company_code = p_company)
      and d.day between least(p_from, p_to - 455) and p_to
      and (p_reps is null or (d.company_code::text || ':' || coalesce(d.rep_code::text, 'sin')) = any(p_reps))
      and (p_series is null or d.series = any(p_series))
  ),
  por_cliente as (
    select f.company_code, f.customer_code,
      sum(f.net_amount) filter (where f.day between v.desde and v.hasta) as neto,
      sum(f.documents) filter (where f.day between v.desde and v.hasta) as documentos,
      -- El descuento de cada cliente: el bruto y el neto de lo que lo trae.
      sum(f.gross_amount) filter (where f.day between v.desde and v.hasta) as bruto,
      sum(f.net_amount) filter (where f.day between v.desde and v.hasta and f.gross_amount is not null) as neto_con_bruto,
      min(f.day) filter (where f.day between p_from and p_to) as primera_en_periodo,
      bool_or(f.day between v.desde and v.hasta) as en_ventana,
      count(distinct f.day) filter (where f.day between v.desde and v.hasta) as dias_con_compra
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
          and exists (select 1 from filtradas f where f.company_code = p.company_code and f.customer_code = p.customer_code and f.day = h.primera)
        when 'recurrentes' then exists (
          select 1 from sage_customer_days d
          where d.company_code = p.company_code and d.customer_code = p.customer_code and d.day between p_from - 365 and p_from - 1)
        when 'recuperados' then coalesce((
          select p.primera_en_periodo - max(d.day) from sage_customer_days d
          where d.company_code = p.company_code and d.customer_code = p.customer_code and d.day < p.primera_en_periodo), 0) >= 180
        when 'perdidos' then h.ultima between p_to - 455 and p_to - 91 and coalesce(p.neto, 0) > 0 and p.dias_con_compra >= 2
        when 'sin_compra' then h.ultima <= p_to - greatest(p_days, 1) and h.ultima > p_to - 365 and p.dias_con_compra >= 2
        else false
      end
      and (p_family is null or exists (
        select 1 from sage_customer_families_monthly m
        where m.company_code = p.company_code and m.customer_code = p.customer_code and m.family_code = p_family
          and m.month between date_trunc('month', v.desde)::date and v.hasta))
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
revoke all on function public.sage_customer_list(text, date, date, smallint, text[], text[], text, integer) from public, anon;
grant execute on function public.sage_customer_list(text, date, date, smallint, text[], text[], text, integer) to authenticated, service_role;

-- ----- Venta por tipo de cliente: zona, sector, canal, forma de pago o provincia -----
-- Con los mismos filtros que las listas de clientes. Con una familia elegida
-- salen los clientes que la compraron en el periodo, con todo lo que compraron.
create or replace function public.sage_customer_segments(p_dim text, p_from date, p_to date, p_company smallint default null,
  p_reps text[] default null, p_series text[] default null, p_family text default null, p_cost_from date default '2025-11-01')
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
      and (p_company is null or d.company_code = p_company)
      and (p_reps is null or (d.company_code::text || ':' || coalesce(d.rep_code::text, 'sin')) = any(p_reps))
      and (p_series is null or d.series = any(p_series))
      and (p_family is null or exists (
        select 1 from sage_customer_families_monthly m
        where m.company_code = d.company_code and m.customer_code = d.customer_code and m.family_code = p_family
          and m.month between date_trunc('month', p_from)::date and p_to))
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
revoke all on function public.sage_customer_segments(text, date, date, smallint, text[], text[], text, date) from public, anon;
grant execute on function public.sage_customer_segments(text, date, date, smallint, text[], text[], text, date) to authenticated, service_role;
