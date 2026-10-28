-- Los clientes de un municipio, para abrirlos desde el mapa.
--
-- Ver el mapa y no poder entrar en un municipio se queda a medias: lo que se
-- busca al mirar una zona floja es quién hay allí y qué compra, para decidir
-- a quién visitar.
--
-- El municipio se decide igual que en el mapa, por código postal y no por el
-- texto de la ficha: así la lista de un municipio es exactamente la misma
-- gente que lo pinta de azul, y no una parecida. El porqué está en
-- 202610280003.

create or replace function public.sage_municipality_customers(
  p_ine char(5),
  p_from date,
  p_to date,
  p_companies smallint[] default null,
  p_reps text[] default null,
  p_series text[] default null,
  p_families text[] default null,
  p_subfamilies text[] default null,
  p_months text[] default null
)
returns table(
  company_code smallint,
  customer_code text,
  name text,
  trade_name text,
  rep_code integer,
  rep_name text,
  phone text,
  net_amount numeric,
  documents bigint,
  last_purchase date
)
language sql
stable
security invoker
set search_path to 'public'
as $$
  with clientes as (
    select c.company_code, c.code as customer_code, c.name, c.trade_name,
           c.rep_code, c.phone
    from sage_customers c
    where public.municipio_de_cp(c.postal_code, c.municipality) = p_ine
      and (p_companies is null or c.company_code = any(p_companies))
      and (p_reps is null or (c.company_code::text || ':' || coalesce(c.rep_code::text, 'sin')) = any(p_reps))
  ),
  de_la_familia as (
    select distinct m.company_code, m.customer_code
    from sage_customer_families_monthly m
    where (p_families is not null or p_subfamilies is not null)
      and m.month between date_trunc('month', p_from)::date and p_to
      and (p_companies is null or m.company_code = any(p_companies))
      and (p_families is null or m.family_code = any(p_families))
      and (p_subfamilies is null or m.subfamily_code = any(p_subfamilies))
  ),
  ventas as (
    select d.company_code, d.customer_code,
           sum(d.net_amount) as neto,
           sum(d.documents) as albaranes,
           max(d.day) as ultima
    from sage_customer_days d
    where d.day between p_from and p_to
      and (p_companies is null or d.company_code = any(p_companies))
      and (p_series is null or d.series = any(p_series))
      and (p_months is null or to_char(d.day, 'YYYY-MM') = any(p_months))
      and ((p_families is null and p_subfamilies is null)
           or exists (select 1 from de_la_familia f
                      where f.company_code = d.company_code and f.customer_code = d.customer_code))
    group by d.company_code, d.customer_code
    having sum(d.net_amount) <> 0 or sum(d.documents) > 0
  )
  select c.company_code, c.customer_code, c.name, c.trade_name,
         c.rep_code,
         -- El nombre del comercial, que el código solo no dice nada.
         r.name as rep_name,
         c.phone,
         round(v.neto, 2) as net_amount,
         coalesce(v.albaranes, 0)::bigint as documents,
         v.ultima as last_purchase
  from clientes c
  join ventas v on v.company_code = c.company_code and v.customer_code = c.customer_code
  left join sage_reps r on r.company_code = c.company_code and r.code = c.rep_code
  order by v.neto desc nulls last;
$$;

revoke execute on function public.sage_municipality_customers(char, date, date, smallint[], text[], text[], text[], text[], text[]) from public, anon;
grant execute on function public.sage_municipality_customers(char, date, date, smallint[], text[], text[], text[], text[], text[]) to authenticated;

comment on function public.sage_municipality_customers(char, date, date, smallint[], text[], text[], text[], text[], text[]) is
  'Los clientes de un municipio en el periodo, con su venta. El municipio se decide por código postal, igual que en el mapa.';
