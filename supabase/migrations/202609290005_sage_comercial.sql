-- La parte comercial del cuadro de mando: ofertas, pedidos e incidencias.
--
-- Cada oferta y cada pedido llegan uno a uno, pero al panel le basta con los
-- totales por mes, sociedad, serie y comercial: con eso filtra y cruza en el
-- navegador (pulsar un comercial, un canal o un mes) sin volver a preguntar y
-- sin bajar miles de documentos.
--
-- Security invoker, como el resto: solo dirección y administración obtienen algo.

-- ---------- Ofertas ----------
-- "Convertida" es la oferta que Sage enlaza con algún pedido (ordered_amount > 0).
-- "Viva" es la que no se ha convertido ni rechazado y sigue en plazo; sin fecha
-- de validez, se da por viva durante 90 días.
create or replace function public.sage_offer_stats(p_from date, p_to date)
returns table (
  month text, company_code smallint, series text, rep_code integer, reject_reason text,
  offers bigint, net_amount numeric,
  converted bigint, converted_amount numeric, ordered_amount numeric,
  timed bigint, days_to_order bigint,
  open_offers bigint, open_amount numeric,
  expired bigint, expired_amount numeric,
  rejected bigint, rejected_amount numeric
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
  ),
  clasificadas as (
    select f.*,
      (not f.convertida and f.motivo <> '') as rechazada,
      (not f.convertida and f.motivo = ''
        and coalesce(f.valid_until, f.offer_date + 90) >= current_date) as viva
    from ofertas f
  )
  select to_char(c.offer_date, 'YYYY-MM'), c.company_code, c.series, c.rep_code, c.motivo,
    count(*), sum(c.net_amount),
    count(*) filter (where c.convertida),
    coalesce(sum(c.net_amount) filter (where c.convertida), 0),
    coalesce(sum(c.ordered_amount), 0),
    count(*) filter (where c.convertida and c.first_order_on is not null),
    coalesce(sum(greatest(c.first_order_on - c.offer_date, 0)) filter (where c.convertida and c.first_order_on is not null), 0)::bigint,
    count(*) filter (where c.viva),
    coalesce(sum(c.net_amount) filter (where c.viva), 0),
    count(*) filter (where not c.convertida and not c.rechazada and not c.viva),
    coalesce(sum(c.net_amount) filter (where not c.convertida and not c.rechazada and not c.viva), 0),
    count(*) filter (where c.rechazada),
    coalesce(sum(c.net_amount) filter (where c.rechazada), 0)
  from clasificadas c
  group by to_char(c.offer_date, 'YYYY-MM'), c.company_code, c.series, c.rep_code, c.motivo;
$$;

-- ---------- Pedidos ----------
-- Plazo de servicio: días entre el pedido y el primer albarán enlazado. "Tarde"
-- es el servido después de la fecha que pidió el cliente, o el que ya pasó esa
-- fecha y sigue con algo pendiente.
create or replace function public.sage_order_stats(p_from date, p_to date)
returns table (
  month text, company_code smallint, series text, rep_code integer, from_offer boolean,
  orders bigint, net_amount numeric,
  pending_orders bigint, pending_amount numeric, delivered_amount numeric,
  served bigint, days_to_serve bigint,
  with_need bigint, late bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select to_char(o.order_date, 'YYYY-MM'), o.company_code, o.series, o.rep_code, o.from_offer,
    count(*), sum(o.net_amount),
    count(*) filter (where o.pending_amount > 0),
    coalesce(sum(o.pending_amount) filter (where o.pending_amount > 0), 0),
    coalesce(sum(o.delivered_amount), 0),
    count(*) filter (where o.first_delivery_on is not null),
    coalesce(sum(greatest(o.first_delivery_on - o.order_date, 0)) filter (where o.first_delivery_on is not null), 0)::bigint,
    count(*) filter (where o.needed_on is not null and (o.first_delivery_on is not null or o.needed_on < current_date)),
    count(*) filter (where o.needed_on is not null and (
      (o.first_delivery_on is not null and o.first_delivery_on > o.needed_on)
      or (o.first_delivery_on is null and o.pending_amount > 0 and o.needed_on < current_date)))
  from sage_order_documents o
  where o.order_date between p_from and p_to
  group by to_char(o.order_date, 'YYYY-MM'), o.company_code, o.series, o.rep_code, o.from_offer;
$$;

-- ---------- Abonos e incidencias ----------
create or replace function public.sage_incident_stats(p_from date, p_to date)
returns table (month text, company_code smallint, kind text, reason text, series text, rep_code integer, documents bigint, net_amount numeric)
language sql
stable
security invoker
set search_path = public
as $$
  select to_char(i.day, 'YYYY-MM'), i.company_code, i.kind, i.reason, i.series, i.rep_code, sum(i.documents)::bigint, sum(i.net_amount)
  from sage_incidents_daily i
  where i.day between p_from and p_to
  group by to_char(i.day, 'YYYY-MM'), i.company_code, i.kind, i.reason, i.series, i.rep_code;
$$;

-- ---------- Una oferta o un pedido, uno a uno (al pulsar una cifra) ----------
-- p_kind: 'vivas' | 'convertidas' | 'rechazadas' | 'caducadas' | 'todas' para
-- ofertas; 'pendientes' | 'tarde' | 'todos' para pedidos.
create or replace function public.sage_offer_list(
  p_kind text,
  p_from date,
  p_to date,
  p_company smallint default null,
  p_reps text[] default null,
  p_series text[] default null
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

create or replace function public.sage_order_list(
  p_kind text,
  p_from date,
  p_to date,
  p_company smallint default null,
  p_reps text[] default null,
  p_series text[] default null
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
    'public.sage_offer_stats(date, date)',
    'public.sage_order_stats(date, date)',
    'public.sage_incident_stats(date, date)',
    'public.sage_offer_list(text, date, date, smallint, text[], text[])',
    'public.sage_order_list(text, date, date, smallint, text[], text[])'
  ]
  loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
