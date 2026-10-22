-- Ventas: las funciones aceptan una lista de meses, no solo un tramo de fechas.
--
-- En el panel ya se pueden marcar varios meses con casillas. Mientras sean
-- seguidos (septiembre y octubre) el tramo de fechas los describe bien, pero en
-- cuanto hay huecos —enero y julio, sin lo de en medio— un tramo trae de más:
-- de febrero a junio entraría todo. Las pantallas que trabajan con filas por
-- mes lo arreglan por su cuenta; las que piden un total a la base, no pueden.
--
-- Por eso cada una de estas funciones recibe ahora p_months: una lista de meses
-- en formato 'YYYY-MM'. Sin pasarla (null) se comportan exactamente como antes,
-- así que nada de lo que ya llama se rompe.
--
-- Dos avisos sobre dónde NO se aplica la lista, a propósito:
--
--   · Las ventanas que no son el periodo. "Perdidos" mira el año anterior,
--     "sin compra" los últimos 365 días y "lo anterior" los 365 días de antes:
--     son otras fechas por definición, y filtrarlas por los meses marcados las
--     dejaría vacías. En sage_customer_list la lista se desactiva sola cuando el
--     tipo pedido es de esos.
--   · El reparto por familias de Sage es mensual, así que ahí el mes es la
--     unidad más fina que hay: la lista encaja de forma exacta.
--
-- Cambiar la lista de parámetros obliga a borrar la versión anterior: si no,
-- una llamada con los argumentos de antes quedaría ambigua entre las dos.
--
-- Se puede volver a ejecutar sin romper nada.

-- ----- Familias -----
drop function if exists public.sage_family_summary(date, date, date);
create or replace function public.sage_family_summary(p_from date, p_to date, p_cost_from date default '2025-11-01',
  p_months text[] default null)
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
  group by f.company_code, f.family_code;
$$;
revoke all on function public.sage_family_summary(date, date, date, text[]) from public, anon;
grant execute on function public.sage_family_summary(date, date, date, text[]) to authenticated, service_role;

-- ----- Artículos -----
drop function if exists public.sage_article_summary(date, date, smallint, text, text, text, integer, date);
create or replace function public.sage_article_summary(p_from date, p_to date, p_company smallint default null, p_family text default null,
  p_subfamily text default null, p_brand text default null, p_limit integer default 50, p_cost_from date default '2025-11-01',
  p_months text[] default null)
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
    and (p_company is null or s.company_code = p_company)
    and (p_family is null or s.family_code = p_family)
    and (p_subfamily is null or s.subfamily_code = p_subfamily)
    and (p_brand is null or coalesce(a.brand, '') = p_brand)
  group by s.article_code, s.family_code
  order by sum(s.net_amount) desc
  limit greatest(p_limit, 1);
$$;
revoke all on function public.sage_article_summary(date, date, smallint, text, text, text, integer, date, text[]) from public, anon;
grant execute on function public.sage_article_summary(date, date, smallint, text, text, text, integer, date, text[]) to authenticated, service_role;

-- ----- Subfamilias y marcas -----
drop function if exists public.sage_article_groups(text, date, date, smallint, text, date);
create or replace function public.sage_article_groups(p_group text, p_from date, p_to date, p_company smallint default null,
  p_family text default null, p_cost_from date default '2025-11-01', p_months text[] default null)
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
revoke all on function public.sage_article_groups(text, date, date, smallint, text, date, text[]) from public, anon;
grant execute on function public.sage_article_groups(text, date, date, smallint, text, date, text[]) to authenticated, service_role;

-- ----- Venta por tipo de cliente -----
drop function if exists public.sage_customer_segments(text, date, date, smallint, text[], text[], text, date);
create or replace function public.sage_customer_segments(p_dim text, p_from date, p_to date, p_company smallint default null,
  p_reps text[] default null, p_series text[] default null, p_family text default null, p_cost_from date default '2025-11-01',
  p_months text[] default null)
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
      and (p_company is null or d.company_code = p_company)
      and (p_reps is null or (d.company_code::text || ':' || coalesce(d.rep_code::text, 'sin')) = any(p_reps))
      and (p_series is null or d.series = any(p_series))
      and (p_family is null or exists (
        select 1 from sage_customer_families_monthly m
        where m.company_code = d.company_code and m.customer_code = d.customer_code and m.family_code = p_family
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
revoke all on function public.sage_customer_segments(text, date, date, smallint, text[], text[], text, date, text[]) from public, anon;
grant execute on function public.sage_customer_segments(text, date, date, smallint, text[], text[], text, date, text[]) to authenticated, service_role;

-- ----- Las cifras de clientes -----
drop function if exists public.sage_customer_counts(date, date, smallint, text[], text[], text);
create or replace function public.sage_customer_counts(
  p_from date, p_to date, p_company smallint default null, p_reps text[] default null,
  p_series text[] default null, p_family text default null, p_months text[] default null
)
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
    where (p_company is null or d.company_code = p_company) and d.day <= p_to
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
    where (p_company is null or d.company_code = p_company)
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
      p_family is null or exists (select 1 from sage_customer_families_monthly m
        where m.company_code = p.company_code and m.customer_code = p.customer_code and m.family_code = p_family
          and m.month between date_trunc('month', p_from)::date and p_to
          and (p_months is null or to_char(m.month, 'YYYY-MM') = any(p_months))) as fam_periodo,
      p_family is null or exists (select 1 from sage_customer_families_monthly m, anio a
        where m.company_code = p.company_code and m.customer_code = p.customer_code and m.family_code = p_family
          and m.month between a.desde and a.hasta) as fam_perdidos,
      p_family is null or exists (select 1 from sage_customer_families_monthly m
        where m.company_code = p.company_code and m.customer_code = p.customer_code and m.family_code = p_family
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
revoke all on function public.sage_customer_counts(date, date, smallint, text[], text[], text, text[]) from public, anon;
grant execute on function public.sage_customer_counts(date, date, smallint, text[], text[], text, text[]) to authenticated, service_role;

-- ----- Las listas de clientes que cuadran con esas cifras -----
drop function if exists public.sage_customer_list(text, date, date, smallint, text[], text[], text, integer);
create or replace function public.sage_customer_list(
  p_kind text, p_from date, p_to date, p_company smallint default null, p_reps text[] default null,
  p_series text[] default null, p_family text default null, p_days integer default 30,
  p_months text[] default null
)
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
    where (p_company is null or d.company_code = p_company) and d.day <= p_to
    group by d.company_code, d.customer_code
  ),
  filtradas as (
    select d.*, (v.meses is null or to_char(d.day, 'YYYY-MM') = any(v.meses)) as mes_ok
    from sage_customer_days d
    cross join ventana v
    where (p_company is null or d.company_code = p_company)
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
      and (p_family is null or exists (
        select 1 from sage_customer_families_monthly m
        where m.company_code = p.company_code and m.customer_code = p.customer_code and m.family_code = p_family
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
revoke all on function public.sage_customer_list(text, date, date, smallint, text[], text[], text, integer, text[]) from public, anon;
grant execute on function public.sage_customer_list(text, date, date, smallint, text[], text[], text, integer, text[]) to authenticated, service_role;

-- ----- La cartera de cada comercial -----
drop function if exists public.sage_rep_customers(date, date, smallint, text[], text[], text);
create or replace function public.sage_rep_customers(
  p_from date,
  p_to date,
  p_company smallint default null,
  p_reps text[] default null,
  p_series text[] default null,
  p_family text default null,
  p_months text[] default null
)
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
    where (p_company is null or c.company_code = p_company)
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
    where (p_company is null or d.company_code = p_company)
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
      where (p_company is null or m.company_code = p_company)
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
  where p_family is null or exists (
    select 1 from sage_customer_families_monthly m
    where m.company_code = c.company_code and m.customer_code = c.customer_code
      and m.family_code = p_family and m.month between date_trunc('month', p_from)::date and p_to
      and (p_months is null or to_char(m.month, 'YYYY-MM') = any(p_months))
  );
$$;
revoke all on function public.sage_rep_customers(date, date, smallint, text[], text[], text, text[]) from public, anon;
grant execute on function public.sage_rep_customers(date, date, smallint, text[], text[], text, text[]) to authenticated, service_role;

-- ----- Las listas de ofertas y pedidos -----
drop function if exists public.sage_offer_list(text, date, date, smallint, text[], text[]);
create or replace function public.sage_offer_list(
  p_kind text,
  p_from date,
  p_to date,
  p_company smallint default null,
  p_reps text[] default null,
  p_series text[] default null,
  p_months text[] default null
)
returns table (
  company_code smallint, year smallint, series text, number integer, offer_date date, valid_until date,
  customer_code text, customer_name text, rep_code integer, net_amount numeric, ordered_amount numeric,
  first_order_on date, reason text
)
language sql
stable
security invoker
set search_path = public
as $$
  with ofertas as (
    select o.*,
      coalesce(nullif(trim(o.reject_reason), ''), nullif(trim(o.loss_detail), ''), '') as motivo,
      o.ordered_amount > 0 as convertida
    from sage_offer_documents o
    where o.offer_date between p_from and p_to
      and (p_months is null or to_char(o.offer_date, 'YYYY-MM') = any(p_months))
      and (p_company is null or o.company_code = p_company)
      and (p_reps is null or (o.company_code::text || ':' || coalesce(o.rep_code::text, 'sin')) = any(p_reps))
      and (p_series is null or o.series = any(p_series))
  )
  select f.company_code, f.year, f.series, f.number, f.offer_date, f.valid_until,
    f.customer_code, coalesce(c.name, f.customer_code), f.rep_code, f.net_amount, f.ordered_amount, f.first_order_on, f.motivo
  from ofertas f
  left join sage_customers c on c.company_code = f.company_code and c.code = f.customer_code
  where case p_kind
    when 'convertidas' then f.convertida
    when 'rechazadas' then not f.convertida and f.motivo <> ''
    when 'vivas' then not f.convertida and f.motivo = '' and coalesce(f.valid_until, f.offer_date + 90) >= current_date
    when 'caducadas' then not f.convertida and f.motivo = '' and coalesce(f.valid_until, f.offer_date + 90) < current_date
    else true
  end
  order by f.net_amount desc
  limit 500;
$$;

drop function if exists public.sage_order_list(text, date, date, smallint, text[], text[]);
create or replace function public.sage_order_list(
  p_kind text,
  p_from date,
  p_to date,
  p_company smallint default null,
  p_reps text[] default null,
  p_series text[] default null,
  p_months text[] default null
)
returns table (
  company_code smallint, year smallint, series text, number integer, order_date date, needed_on date,
  customer_code text, customer_name text, rep_code integer, net_amount numeric, pending_amount numeric,
  first_delivery_on date, from_offer boolean
)
language sql
stable
security invoker
set search_path = public
as $$
  select o.company_code, o.year, o.series, o.number, o.order_date, o.needed_on,
    o.customer_code, coalesce(c.name, o.customer_code), o.rep_code, o.net_amount, o.pending_amount, o.first_delivery_on, o.from_offer
  from sage_order_documents o
  left join sage_customers c on c.company_code = o.company_code and c.code = o.customer_code
  where o.order_date between p_from and p_to
    and (p_months is null or to_char(o.order_date, 'YYYY-MM') = any(p_months))
    and (p_company is null or o.company_code = p_company)
    and (p_reps is null or (o.company_code::text || ':' || coalesce(o.rep_code::text, 'sin')) = any(p_reps))
    and (p_series is null or o.series = any(p_series))
    and case p_kind
      when 'pendientes' then o.pending_amount > 0
      when 'tarde' then o.needed_on is not null and (
        (o.first_delivery_on is not null and o.first_delivery_on > o.needed_on)
        or (o.first_delivery_on is null and o.pending_amount > 0 and o.needed_on < current_date))
      else true
    end
  order by case when p_kind = 'pendientes' then o.pending_amount else o.net_amount end desc
  limit 500;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.sage_offer_list(text, date, date, smallint, text[], text[], text[])',
    'public.sage_order_list(text, date, date, smallint, text[], text[], text[])'
  ]
  loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
