-- Los municipios estaban tan sucios como las provincias, y por lo mismo: los
-- escribe quien da de alta la ficha.
--
-- En Alicante, con los datos del 28/10/2026, el mismo pueblo salía hasta tres
-- veces y repartido: «ELX/ELCHE» con 502 clientes, «ELCHE» con 169 y «Elche»
-- con 2. Igual «ALCOY»/«Alcoy», «DÉNIA»/«DENIA», «ALMORADÍ»/«ALMORADI»/
-- «Almoradi», «ALACANT/ALICANTE»/«ALICANTE». Con eso, la lista de un
-- comercial no dice dónde tiene clientes: dice cómo los teclearon.
--
-- Se unifica lo que es el mismo nombre salvo mayúsculas, tildes y la barra
-- bilingüe. NO se unifica por parecido, a propósito: «HONDÓN DE LAS NIEVES» y
-- «HONDÓN DE LOS FRAILES» son dos pueblos distintos, y «CALLOSA DE SEGURA» y
-- «CALLOSA DEL SEGURA» se quedan separados antes que arriesgarse a juntar dos
-- sitios que no lo son.
--
-- El nombre que se enseña es el que más veces aparece escrito, no uno
-- inventado por una regla de mayúsculas: así sale «ELX/ELCHE», que es como se
-- llama de verdad.

/*
  La clave con la que se agrupa.

  De «ELX/ELCHE» se queda con «ELCHE» —el trozo más largo— y de «ELCHE» con
  «ELCHE», que es lo que hace que se junten. Con el trozo más corto saldría
  «ELX», que no casa con nada.
*/
create or replace function public.municipio_llano(p_nombre text)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select nullif(btrim((
    select trozo
    from unnest(string_to_array(
      regexp_replace(public.texto_llano(p_nombre), '\s+', ' ', 'g'), '/')) as trozo
    order by length(btrim(trozo)) desc
    limit 1
  )), '');
$$;

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
           coalesce(c.municipio_clave, 'SIN MUNICIPIO') as municipio_clave,
           c.municipio_escrito,
           c.discrepa, v.neto, v.albaranes
    from ventas v
    join clientes c on c.company_code = v.company_code and c.customer_code = v.customer_code
  ),
  por_municipio as (
    select j.prov, j.municipio_clave,
           -- El nombre que más veces aparece escrito, que es el de verdad.
           coalesce(mode() within group (order by j.municipio_escrito), 'Sin municipio') as nombre,
           count(*)::bigint as clientes,
           round(sum(j.neto), 2) as neto
    from juntos j
    group by j.prov, j.municipio_clave
  )
  select
    j.prov::char(2) as province_code,
    coalesce(p.name, 'Sin provincia') as province,
    coalesce(p.region, 'Sin asignar') as region,
    count(*)::bigint as customers,
    round(sum(j.neto), 2) as net_amount,
    coalesce(sum(j.albaranes), 0)::bigint as documents,
    count(*) filter (where j.discrepa)::bigint as mismatched,
    (select jsonb_agg(jsonb_build_object('name', m.nombre, 'customers', m.clientes, 'net', m.neto)
                      order by m.neto desc nulls last)
     from por_municipio m where m.prov = j.prov) as municipalities
  from juntos j
  left join public.es_provinces p on p.code = j.prov
  group by j.prov, p.name, p.region
  order by sum(j.neto) desc nulls last;
$$;

comment on function public.sage_customer_zones(date, date, smallint[], text[], text[], text[], text[], text[]) is
  'Clientes y venta por provincia, con el detalle por municipio. La provincia sale del código postal; los municipios se unifican por mayúsculas, tildes y la barra bilingüe.';
