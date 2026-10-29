-- Con una familia marcada, la cifra de cada cliente es la de esa familia.
--
-- Las listas de clientes ya filtraban por familia y subfamilia para ELEGIR a
-- quién enseñar —los que han comprado algo de eso—, pero la cifra de cada uno
-- era su compra total. Con «Aire comprimido» marcado, un cliente que compra
-- 14.000 € de todo y 300 € de aire comprimido salía con 14.000 €, y la lista
-- se ordenaba por eso.
--
-- Ahora, con familia o subfamilia marcada, la compra, lo anterior y el
-- descuento salen de lo que compró de esa familia (por meses: es lo más fino
-- que guarda la compra por familia). Los albaranes van a nulo: un albarán
-- puede llevar varias familias y no se puede saber cuántos son «de» una.
--
-- Mismas firmas que antes: se reemplazan sin crear sobrecargas.
--
-- Se puede volver a ejecutar sin romper nada.

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
  /*
    Con familia o subfamilia marcada, lo que compró cada cliente DE ESO. La
    compra por cliente y familia va por meses: es la unidad más fina que hay.
  */
  por_familia as (
    select m.company_code, m.customer_code,
      sum(m.net_amount) as neto,
      sum(m.gross_amount) as bruto,
      sum(m.net_amount) filter (where m.gross_amount is not null) as neto_con_bruto
    from sage_customer_families_monthly m
    cross join ventana v
    where (p_families is not null or p_subfamilies is not null)
      and (p_companies is null or m.company_code = any(p_companies))
      and (p_families is null or m.family_code = any(p_families))
      and (p_subfamilies is null or (m.family_code || ':' || m.subfamily_code) = any(p_subfamilies))
      and m.month between date_trunc('month', v.desde)::date and v.hasta
      and (v.meses is null or to_char(m.month, 'YYYY-MM') = any(v.meses))
    group by m.company_code, m.customer_code
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
    e.primera, e.ultima,
    -- Con familia marcada, la compra y el descuento son los de esa familia, y
    -- los albaranes no se saben: un albarán puede llevar de varias familias.
    case when (p_families is not null or p_subfamilies is not null) then coalesce(pf.neto, 0) else coalesce(e.neto, 0) end,
    case when (p_families is not null or p_subfamilies is not null) then null else coalesce(e.documentos, 0)::bigint end,
    (p_to - e.ultima)::integer,
    k.name, k.phone, k.email,
    case when (p_families is not null or p_subfamilies is not null) then coalesce(pf.bruto, 0) else coalesce(e.bruto, 0) end,
    case when (p_families is not null or p_subfamilies is not null) then coalesce(pf.neto_con_bruto, 0) else coalesce(e.neto_con_bruto, 0) end
  from elegidos e
  left join por_familia pf on pf.company_code = e.company_code and pf.customer_code = e.customer_code
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
  order by case when (p_families is not null or p_subfamilies is not null) then coalesce(pf.neto, 0) else coalesce(e.neto, 0) end desc, e.customer_code;
$$;
revoke all on function public.sage_customer_list(text, date, date, smallint[], text[], text[], text[], integer, text[], text[]) from public, anon;
grant execute on function public.sage_customer_list(text, date, date, smallint[], text[], text[], text[], integer, text[], text[]) to authenticated, service_role;

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
  /*
    Con familia o subfamilia marcada, lo de esa familia: en el periodo y en
    los 365 días de antes. Por meses, que es lo más fino que hay.
  */
  por_familia as (
    select m.company_code, m.customer_code,
      sum(m.net_amount) filter (where m.month between date_trunc('month', p_from)::date and p_to
        and (p_months is null or to_char(m.month, 'YYYY-MM') = any(p_months))) as neto,
      sum(m.net_amount) filter (where m.month between date_trunc('month', p_from - 365)::date and p_from - 1) as neto_anterior
    from sage_customer_families_monthly m
    where (p_families is not null or p_subfamilies is not null)
      and (p_companies is null or m.company_code = any(p_companies))
      and (p_families is null or m.family_code = any(p_families))
      and (p_subfamilies is null or (m.family_code || ':' || m.subfamily_code) = any(p_subfamilies))
      and m.month between date_trunc('month', p_from - 365)::date and p_to
    group by m.company_code, m.customer_code
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
         case when (p_families is not null or p_subfamilies is not null) then coalesce(pf.neto, 0) else coalesce(mv.neto, 0) end as net_amount,
         case when (p_families is not null or p_subfamilies is not null) then null else coalesce(mv.albaranes, 0)::bigint end as documents,
         case when (p_families is not null or p_subfamilies is not null) then coalesce(pf.neto_anterior, 0) else coalesce(mv.neto_anterior, 0) end as previous_amount,
         mv.primera as first_purchase,
         mv.ultima as last_purchase,
         case when mv.ultima is null then null else (p_to - mv.ultima)::integer end as days_since_last,
         coalesce(fa.detalle, '[]'::jsonb) as families
  from cartera c
  left join movimientos mv on mv.company_code = c.company_code and mv.customer_code = c.customer_code
  left join familias fa on fa.company_code = c.company_code and fa.customer_code = c.customer_code
  left join por_familia pf on pf.company_code = c.company_code and pf.customer_code = c.customer_code
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
