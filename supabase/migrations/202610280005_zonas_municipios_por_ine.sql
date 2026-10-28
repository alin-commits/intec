-- La lista de municipios de la tabla agrupa ahora igual que el mapa: por el
-- código del INE al que lleva el código postal, no por el nombre escrito.
--
-- Hasta ahora eran dos criterios distintos en la misma pantalla, y se notaba.
-- En Alicante la tabla decía «102 municipios con clientes» y entre ellos
-- estaban ELX/ELCHE, TORRELLANO-ELCHE, MATOLA - ELCHE y HOYA, LA - ELCHE por
-- separado: las tres últimas son pedanías de Elche y comparten sus códigos
-- postales, así que en el mapa ya iban todas al mismo sitio. También
-- CREVILLENT y CREVILLENTE, o ALICANTE y Alicante (Alacant).
--
-- Con esto, lo que dice la tabla y lo que pinta el mapa son la misma cosa, y
-- cada fila lleva su código INE, que es lo que permite pulsarla y ver sus
-- clientes.
--
-- Fuera de donde hay mapeo de códigos postales (hoy, la Comunidad Valenciana)
-- se sigue agrupando por el nombre escrito, como hasta ahora: es menos bueno,
-- pero es lo que hay, y no se pierde ninguna fila por el camino. Esas filas
-- salen sin código y la pantalla no las deja pulsar.

create or replace function public.sage_customer_zones(
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
  province_code char(2),
  province text,
  region text,
  customers bigint,
  net_amount numeric,
  documents bigint,
  mismatched bigint,
  municipalities jsonb
)
language sql
stable
security invoker
set search_path to 'public'
as $$
  with clientes as (
    select c.company_code, c.code as customer_code,
           public.provincia_de(c.postal_code, c.province) as prov,
           public.municipio_de_cp(c.postal_code, c.municipality) as ine,
           public.municipio_llano(c.municipality) as municipio_clave,
           nullif(btrim(c.municipality), '') as municipio_escrito,
           (public.provincia_de_cp(c.postal_code) is not null
            and public.provincia_de_texto(c.province) is not null
            and public.provincia_de_cp(c.postal_code) <> public.provincia_de_texto(c.province)) as discrepa
    from sage_customers c
    where (p_companies is null or c.company_code = any(p_companies))
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
           sum(d.documents) as albaranes
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
  ),
  juntos as (
    select coalesce(c.prov, 'ZZ') as prov,
           c.ine,
           /*
             La clave de agrupación: el código del INE cuando se sabe, y el
             nombre llano cuando no. El prefijo evita que un municipio sin
             código se junte por casualidad con otro que sí lo tiene.
           */
           coalesce('I:' || c.ine, 'T:' || coalesce(c.municipio_clave, 'SIN MUNICIPIO')) as clave,
           c.municipio_escrito,
           c.discrepa, v.neto, v.albaranes
    from ventas v
    join clientes c on c.company_code = v.company_code and c.customer_code = v.customer_code
  ),
  por_municipio as (
    select j.prov, j.clave,
           max(j.ine) as ine,
           /*
             El nombre: el oficial del INE cuando lo hay —que es el mismo que
             sale en el mapa— y, si no, el que más veces aparece escrito.
           */
           coalesce(
             (select m2.name from public.cp_municipios m2 where m2.ine = max(j.ine) limit 1),
             mode() within group (order by j.municipio_escrito),
             'Sin municipio'
           ) as nombre,
           count(*)::bigint as clientes,
           round(sum(j.neto), 2) as neto
    from juntos j
    group by j.prov, j.clave
  )
  select
    j.prov::char(2) as province_code,
    coalesce(p.name, 'Sin provincia') as province,
    coalesce(p.region, 'Sin asignar') as region,
    count(*)::bigint as customers,
    round(sum(j.neto), 2) as net_amount,
    coalesce(sum(j.albaranes), 0)::bigint as documents,
    count(*) filter (where j.discrepa)::bigint as mismatched,
    (select jsonb_agg(jsonb_build_object('ine', m.ine, 'name', m.nombre, 'customers', m.clientes, 'net', m.neto)
                      order by m.neto desc nulls last)
     from por_municipio m where m.prov = j.prov) as municipalities
  from juntos j
  left join public.es_provinces p on p.code = j.prov
  group by j.prov, p.name, p.region
  order by sum(j.neto) desc nulls last;
$$;

comment on function public.sage_customer_zones(date, date, smallint[], text[], text[], text[], text[], text[]) is
  'Clientes y venta por provincia, con el detalle por municipio agrupado por código del INE donde lo hay. La provincia sale del código postal.';
