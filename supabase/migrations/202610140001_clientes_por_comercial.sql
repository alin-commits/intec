-- La cartera de cada comercial: quién le compra, quién no, y de qué familias.
--
-- Hoy el panel sabe decir qué clientes compraron en un periodo, pero no lo
-- contrario: de los clientes que lleva un comercial, cuáles no han comprado
-- nada. Y esa es la lista con la que se trabaja, porque un cliente que compraba
-- todos los meses y lleva cuatro sin aparecer no sale en ningún sitio.
--
-- Devuelve una fila por cliente de la cartera —compre o no— con:
--
--   · lo que lleva comprado en el periodo y en cuántos albaranes,
--   · lo que compró en los 365 días anteriores, que es lo que distingue al que
--     nunca compró del que ha dejado de comprar,
--   · su primera y su última compra de toda la vida,
--   · y el desglose por familias de lo comprado en el periodo.
--
-- El comercial que manda es el que tiene asignado el cliente en Sage, no el que
-- firmó cada albarán: la pregunta es "de quién es esta cartera", no "quién
-- facturó". Los clientes sin comercial asignado —954 de 6.716— salen con
-- rep_code a nulo, para que se vean: un cliente sin comercial es justo el que
-- nadie llama.
--
-- Aviso sobre las familias: en Sage el reparto por familia es mensual, no
-- diario, así que un periodo que corte un mes por la mitad cuenta ese mes
-- entero. Por eso las familias se devuelven aparte y no se suman al neto del
-- periodo, que sí es exacto.
--
-- Se puede volver a ejecutar sin romper nada.

create or replace function public.sage_rep_customers(
  p_from date,
  p_to date,
  p_company smallint default null,
  p_reps text[] default null,
  p_series text[] default null,
  p_family text default null
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
      sum(d.net_amount) filter (where d.day between p_from and p_to) as neto,
      sum(d.documents) filter (where d.day between p_from and p_to) as albaranes,
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
  );
$$;

revoke execute on function public.sage_rep_customers(date, date, smallint, text[], text[], text) from public, anon;
grant execute on function public.sage_rep_customers(date, date, smallint, text[], text[], text) to authenticated;
