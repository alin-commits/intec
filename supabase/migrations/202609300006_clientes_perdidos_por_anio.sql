-- Clientes perdidos por año natural, y lo que pide la ficha del cliente.
--
-- Hasta ahora "perdido" era un cliente habitual del año anterior a los últimos
-- 90 días que desde entonces no había vuelto. Dirección lo quiere por año: un
-- cliente está perdido si el año pasado compraba (en 2 días o más, para que una
-- compra suelta no cuente) y en el año en curso todavía no ha comprado nada.
-- "El año en curso" es el del final del periodo que se mira: mirando 2025, los
-- perdidos son los habituales de 2024 que no compraron en 2025.
--
-- Las dos funciones cuentan lo mismo: la cifra de la tarjeta y la lista que se
-- abre al pulsarla tienen que cuadrar.

create or replace function public.sage_customer_counts(
  p_from date, p_to date, p_company smallint default null, p_reps text[] default null,
  p_series text[] default null, p_family text default null
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
    select d.company_code, d.customer_code, d.day, d.net_amount
    from sage_customer_days d
    cross join anio a
    where (p_company is null or d.company_code = p_company)
      and d.day between least(p_from, p_to - 365, a.desde) and p_to
      and (p_reps is null or (d.company_code::text || ':' || coalesce(d.rep_code::text, 'sin')) = any(p_reps))
      and (p_series is null or d.series = any(p_series))
  ),
  por_cliente as (
    select f.company_code, f.customer_code, h.primera, h.ultima,
      bool_or(f.day between p_from and p_to) as activo,
      coalesce(sum(f.net_amount) filter (where f.day between p_from and p_to), 0) as neto,
      min(f.day) filter (where f.day between p_from and p_to) as primera_en_periodo,
      bool_or(f.day = h.primera) as hizo_la_primera,
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
          and m.month between date_trunc('month', p_from)::date and p_to) as fam_periodo,
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

create or replace function public.sage_customer_list(
  p_kind text, p_from date, p_to date, p_company smallint default null, p_reps text[] default null,
  p_series text[] default null, p_family text default null, p_days integer default 30
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
        else p_to end as hasta
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
    cross join ventana v
    where (p_company is null or d.company_code = p_company)
      and d.day between least(p_from, p_to - 365, v.desde) and p_to
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
        -- Compraba el año pasado y su última compra es de entonces: este año, nada.
        when 'perdidos' then h.ultima between v.desde and v.hasta and coalesce(p.neto, 0) > 0 and p.dias_con_compra >= 2
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

-- La ficha del cliente pide sus pedidos y sus ofertas.
create index if not exists sage_order_documents_customer_idx on public.sage_order_documents (company_code, customer_code, order_date);
create index if not exists sage_offer_documents_customer_idx on public.sage_offer_documents (company_code, customer_code, offer_date);
