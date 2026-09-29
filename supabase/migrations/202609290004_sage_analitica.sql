-- Las preguntas del cuadro de mando que se contestan cliente a cliente o
-- artículo a artículo. Se calculan aquí, en la base de datos, para no bajar al
-- navegador decenas de miles de filas.
--
-- Todas son security invoker: se aplican las reglas de quien pregunta, así que
-- solo dirección y administración obtienen algo.
--
-- Filtros comunes (todos opcionales, nulo = sin filtro):
--   p_company  sociedad
--   p_reps     comerciales, como 'sociedad:código' ('1:5'); 'sociedad:sin' para
--              las ventas sin comercial. Una persona puede tener fichas en
--              varias sociedades, por eso va en lista.
--   p_series   series (canales) de Sage
--   p_family   familia de artículo

-- ---------- Clientes: quién ----------
-- p_kind:
--   'activos'      compraron en el periodo;
--   'nuevos'       su primera compra de siempre cae en el periodo (y esa venta
--                  cumple los filtros: se atribuye a quien la hizo);
--   'recurrentes'  compraron en el periodo y también en los 12 meses anteriores;
--   'recuperados'  compraron en el periodo tras 180 días o más sin comprar;
--   'perdidos'     compraban en los 12 meses anteriores a los últimos 90 días
--                  (contados desde el final del periodo) y desde entonces nada;
--   'sin_compra'   su última compra fue hace p_days días o más (y menos de un año).
create or replace function public.sage_customer_list(
  p_kind text,
  p_from date,
  p_to date,
  p_company smallint default null,
  p_reps text[] default null,
  p_series text[] default null,
  p_family text default null,
  p_days integer default 30
)
returns table (
  company_code smallint,
  customer_code text,
  name text,
  trade_name text,
  phone text,
  email text,
  province text,
  municipality text,
  rep_code integer,
  first_purchase date,
  last_purchase date,
  net_amount numeric,
  documents bigint,
  days_since_last integer
)
language sql
stable
security invoker
set search_path = public
as $$
  with ventana as (
    select
      case p_kind when 'perdidos' then p_to - 455 when 'sin_compra' then p_to - 365 else p_from end as desde,
      case p_kind when 'perdidos' then p_to - 91 else p_to end as hasta
  ),
  -- La historia de cada cliente, sin filtros: su primera compra de siempre y la
  -- última hasta el final del periodo (mirando agosto, lo que compró en
  -- septiembre no cuenta para decir si en agosto estaba perdido).
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
      min(f.day) filter (where f.day between p_from and p_to) as primera_en_periodo,
      bool_or(f.day between v.desde and v.hasta) as en_ventana
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
        when 'perdidos' then h.ultima between p_to - 455 and p_to - 91 and coalesce(p.neto, 0) > 0
        when 'sin_compra' then h.ultima <= p_to - greatest(p_days, 1) and h.ultima > p_to - 365
        else false
      end
      and (p_family is null or exists (
        select 1 from sage_customer_families_monthly m
        where m.company_code = p.company_code and m.customer_code = p.customer_code and m.family_code = p_family
          and m.month between date_trunc('month', v.desde)::date and v.hasta))
  )
  select e.company_code, e.customer_code,
    coalesce(c.name, 'Cliente ' || e.customer_code), c.trade_name, c.phone, c.email, c.province, c.municipality, c.rep_code,
    e.primera, e.ultima, coalesce(e.neto, 0), coalesce(e.documentos, 0)::bigint, (p_to - e.ultima)::integer
  from elegidos e
  left join sage_customers c on c.company_code = e.company_code and c.code = e.customer_code
  order by coalesce(e.neto, 0) desc, e.customer_code;
$$;

-- ---------- Clientes: cuántos (las tarjetas) ----------
-- Las mismas definiciones que la lista de arriba, contadas en una sola pasada
-- (llamar a la lista una vez por tarjeta recorría los datos once veces).
create or replace function public.sage_customer_counts(
  p_from date,
  p_to date,
  p_company smallint default null,
  p_reps text[] default null,
  p_series text[] default null,
  p_family text default null
)
returns table (
  activos bigint, nuevos bigint, recurrentes bigint, recuperados bigint, perdidos bigint,
  sin_compra_30 bigint, sin_compra_60 bigint, sin_compra_90 bigint,
  neto_activos numeric, neto_recurrentes numeric, neto_perdidos numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with historia as (
    select d.company_code, d.customer_code, min(d.day) as primera, max(d.day) as ultima
    from sage_customer_days d
    where (p_company is null or d.company_code = p_company) and d.day <= p_to
    group by d.company_code, d.customer_code
  ),
  filtradas as (
    select d.company_code, d.customer_code, d.day, d.net_amount
    from sage_customer_days d
    where (p_company is null or d.company_code = p_company)
      and d.day between least(p_from, p_to - 455) and p_to
      and (p_reps is null or (d.company_code::text || ':' || coalesce(d.rep_code::text, 'sin')) = any(p_reps))
      and (p_series is null or d.series = any(p_series))
  ),
  por_cliente as (
    select f.company_code, f.customer_code, h.primera, h.ultima,
      bool_or(f.day between p_from and p_to) as activo,
      coalesce(sum(f.net_amount) filter (where f.day between p_from and p_to), 0) as neto,
      min(f.day) filter (where f.day between p_from and p_to) as primera_en_periodo,
      bool_or(f.day = h.primera) as hizo_la_primera,
      bool_or(f.day between p_to - 455 and p_to - 91) as en_perdidos,
      coalesce(sum(f.net_amount) filter (where f.day between p_to - 455 and p_to - 91), 0) as neto_perdidos,
      bool_or(f.day between p_to - 365 and p_to) as en_anual
    from filtradas f
    join historia h on h.company_code = f.company_code and h.customer_code = f.customer_code
    group by f.company_code, f.customer_code, h.primera, h.ultima
  ),
  -- La familia se mira en la misma ventana que cada tarjeta.
  con_familia as (
    select p.*,
      p_family is null or exists (select 1 from sage_customer_families_monthly m
        where m.company_code = p.company_code and m.customer_code = p.customer_code and m.family_code = p_family
          and m.month between date_trunc('month', p_from)::date and p_to) as fam_periodo,
      p_family is null or exists (select 1 from sage_customer_families_monthly m
        where m.company_code = p.company_code and m.customer_code = p.customer_code and m.family_code = p_family
          and m.month between date_trunc('month', p_to - 455)::date and p_to - 91) as fam_perdidos,
      p_family is null or exists (select 1 from sage_customer_families_monthly m
        where m.company_code = p.company_code and m.customer_code = p.customer_code and m.family_code = p_family
          and m.month between date_trunc('month', p_to - 365)::date and p_to) as fam_anual,
      p.activo and exists (select 1 from sage_customer_days d
        where d.company_code = p.company_code and d.customer_code = p.customer_code
          and d.day between p_from - 365 and p_from - 1) as recurrente,
      p.activo and coalesce((select p.primera_en_periodo - max(d.day) from sage_customer_days d
        where d.company_code = p.company_code and d.customer_code = p.customer_code and d.day < p.primera_en_periodo), 0) >= 180 as recuperado
    from por_cliente p
  )
  select
    count(*) filter (where activo and fam_periodo),
    count(*) filter (where activo and fam_periodo and primera between p_from and p_to and hizo_la_primera),
    count(*) filter (where recurrente and fam_periodo),
    count(*) filter (where recuperado and fam_periodo),
    count(*) filter (where en_perdidos and ultima between p_to - 455 and p_to - 91 and neto_perdidos > 0 and fam_perdidos),
    count(*) filter (where en_anual and ultima <= p_to - 30 and ultima > p_to - 365 and fam_anual),
    count(*) filter (where en_anual and ultima <= p_to - 60 and ultima > p_to - 365 and fam_anual),
    count(*) filter (where en_anual and ultima <= p_to - 90 and ultima > p_to - 365 and fam_anual),
    coalesce(sum(neto) filter (where activo and fam_periodo), 0),
    coalesce(sum(neto) filter (where recurrente and fam_periodo), 0),
    coalesce(sum(neto_perdidos) filter (where en_perdidos and ultima between p_to - 455 and p_to - 91 and neto_perdidos > 0 and fam_perdidos), 0)
  from con_familia;
$$;

-- ---------- Clientes: por mes (el gráfico) ----------
create or replace function public.sage_customer_monthly(
  p_from date,
  p_to date,
  p_company smallint default null,
  p_reps text[] default null,
  p_series text[] default null
)
returns table (month text, activos bigint, nuevos bigint, neto numeric)
language sql
stable
security invoker
set search_path = public
as $$
  with historia as (
    select d.company_code, d.customer_code, min(d.day) as primera
    from sage_customer_days d
    where p_company is null or d.company_code = p_company
    group by d.company_code, d.customer_code
  )
  select to_char(d.day, 'YYYY-MM'),
    count(distinct d.company_code::text || ':' || d.customer_code),
    count(distinct case when date_trunc('month', h.primera) = date_trunc('month', d.day) and d.day = h.primera
                        then d.company_code::text || ':' || d.customer_code end),
    sum(d.net_amount)
  from sage_customer_days d
  join historia h on h.company_code = d.company_code and h.customer_code = d.customer_code
  where d.day between p_from and p_to
    and (p_company is null or d.company_code = p_company)
    and (p_reps is null or (d.company_code::text || ':' || coalesce(d.rep_code::text, 'sin')) = any(p_reps))
    and (p_series is null or d.series = any(p_series))
  group by to_char(d.day, 'YYYY-MM');
$$;

-- ---------- Productos ----------
-- El coste de las series antiguas de Sage no vale: la parte fiable (desde
-- p_cost_from) va aparte para el margen.
create or replace function public.sage_article_summary(
  p_from date,
  p_to date,
  p_company smallint default null,
  p_family text default null,
  p_subfamily text default null,
  p_brand text default null,
  p_limit integer default 50,
  p_cost_from date default date '2025-11-01'
)
returns table (
  article_code text, name text, brand text, family_code text, subfamily_code text,
  units numeric, documents bigint, net_amount numeric, trusted_net numeric, trusted_cost numeric, trusted_without_cost numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select s.article_code, max(a.name), max(a.brand), s.family_code, max(s.subfamily_code),
    sum(s.units), sum(s.documents)::bigint, sum(s.net_amount),
    coalesce(sum(s.net_amount) filter (where s.month >= date_trunc('month', p_cost_from)), 0),
    coalesce(sum(s.cost_amount) filter (where s.month >= date_trunc('month', p_cost_from)), 0),
    coalesce(sum(s.net_without_cost) filter (where s.month >= date_trunc('month', p_cost_from)), 0)
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

-- Agrupado por subfamilia o por marca (p_group = 'subfamilia' | 'marca').
create or replace function public.sage_article_groups(
  p_group text,
  p_from date,
  p_to date,
  p_company smallint default null,
  p_family text default null,
  p_cost_from date default date '2025-11-01'
)
returns table (
  code text, family_code text, name text, articles bigint, net_amount numeric,
  trusted_net numeric, trusted_cost numeric, trusted_without_cost numeric
)
language sql
stable
security invoker
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
      coalesce(sum(f.net_without_cost) filter (where f.month >= date_trunc('month', p_cost_from)), 0) as sin_coste_fiable
    from filas f
    group by f.grupo, f.grupo_familia
  )
  select g.grupo, g.grupo_familia,
    case when p_group = 'marca' then nullif(g.grupo, '')
         else (select max(sf.name) from sage_subfamilies sf where sf.code = g.grupo and sf.family_code = g.grupo_familia) end,
    g.articulos, g.neto, g.neto_fiable, g.coste_fiable, g.sin_coste_fiable
  from grupos g
  order by g.neto desc;
$$;

-- Solo usuarios con sesión (y las reglas de las tablas deciden quién ve algo).
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.sage_customer_list(text, date, date, smallint, text[], text[], text, integer)',
    'public.sage_customer_counts(date, date, smallint, text[], text[], text)',
    'public.sage_customer_monthly(date, date, smallint, text[], text[])',
    'public.sage_article_summary(date, date, smallint, text, text, text, integer, date)',
    'public.sage_article_groups(text, date, date, smallint, text, date)'
  ]
  loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
