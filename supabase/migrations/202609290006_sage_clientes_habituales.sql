-- "Han dejado de comprar" y "sin compra": solo clientes habituales.
--
-- Desde febrero de 2026 entran 150-200 clientes nuevos al mes por Tienda, Web
-- y Punto de venta, y más de la mitad compra una sola vez. Contados como
-- "perdidos", 486 de los 1.115 eran compradores de un solo día: un particular
-- de la web que no ha vuelto no es un cliente perdido, y la lista dejaba de
-- servir para llamar.
--
-- Ahora "perdidos" y "sin compra (30/60/90 días)" exigen compras en al menos
-- dos días distintos dentro de su ventana:
--   perdidos    del año anterior a los últimos 90 días (p_to-455 a p_to-91);
--   sin_compra  del último año (p_to-365 a p_to).
-- Los de una sola compra siguen contando como clientes con compra y nuevos.
--
-- Mismas firmas que antes (202609290004): solo cambia la condición.

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
    e.primera, e.ultima, coalesce(e.neto, 0), coalesce(e.documentos, 0)::bigint, (p_to - e.ultima)::integer
  from elegidos e
  left join sage_customers c on c.company_code = e.company_code and c.code = e.customer_code
  order by coalesce(e.neto, 0) desc, e.customer_code;
$$;

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
      bool_or(f.day between p_to - 365 and p_to) as en_anual,
      count(distinct f.day) filter (where f.day between p_to - 455 and p_to - 91) as dias_perdidos,
      count(distinct f.day) filter (where f.day between p_to - 365 and p_to) as dias_anual
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
    count(*) filter (where en_perdidos and dias_perdidos >= 2 and ultima between p_to - 455 and p_to - 91 and neto_perdidos > 0 and fam_perdidos),
    count(*) filter (where en_anual and dias_anual >= 2 and ultima <= p_to - 30 and ultima > p_to - 365 and fam_anual),
    count(*) filter (where en_anual and dias_anual >= 2 and ultima <= p_to - 60 and ultima > p_to - 365 and fam_anual),
    count(*) filter (where en_anual and dias_anual >= 2 and ultima <= p_to - 90 and ultima > p_to - 365 and fam_anual),
    coalesce(sum(neto) filter (where activo and fam_periodo), 0),
    coalesce(sum(neto) filter (where recurrente and fam_periodo), 0),
    coalesce(sum(neto_perdidos) filter (where en_perdidos and dias_perdidos >= 2 and ultima between p_to - 455 and p_to - 91 and neto_perdidos > 0 and fam_perdidos), 0)
  from con_familia;
$$;
