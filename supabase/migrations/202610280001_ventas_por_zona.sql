-- Ventas por zona: dónde tiene clientes cada comercial.
--
-- La provincia de un cliente NO se coge del campo «provincia» de Sage. Se
-- calcula del código postal, y el texto solo entra cuando no hay CP.
--
-- Por qué, con los números de la base el 28/10/2026 (muestra de 1.000 fichas):
--
--   · 57 grafías distintas para 52 provincias: MURCIA y Murcia, CADIZ y CÁDIZ,
--     LEON y LEÓN, ALICANTE y ALICANTE/ALACANT... agrupando por ese texto,
--     Alicante sale partida en dos y la zona de un comercial se descuadra.
--   · 523 de esas 1.000 fichas no tienen provincia escrita pero sí CP.
--   · Y lo que decide el asunto: hay textos que CONTRADICEN al código postal.
--     «Barcelona» con CP 50 (Zaragoza), «ASTURIAS» con CP 39 (Cantabria),
--     «ARABA/ÁLAVA» con CP 14 (Córdoba), «ELCHE» —que es un pueblo— y
--     «PORTUGAL». Un código de cinco dígitos se teclea en un campo con
--     formato; el nombre es prosa libre.
--
-- Los dos primeros dígitos de un código postal español son la provincia, por
-- definición y sin excepciones, así que es un dato canónico y no una opinión.
--
-- Las discrepancias no se esconden: la función las cuenta y la pantalla las
-- enseña, que es lo que permite ir a Sage y arreglar esas fichas.

-- ---------------------------------------------------------------------------
-- Las 52 provincias, con su código y su comunidad
-- ---------------------------------------------------------------------------

create table if not exists public.es_provinces (
  code char(2) primary key,
  name text not null,
  region text not null
);

insert into public.es_provinces (code, name, region) values
  ('01','Álava','País Vasco'), ('02','Albacete','Castilla-La Mancha'),
  ('03','Alicante','Comunidad Valenciana'), ('04','Almería','Andalucía'),
  ('05','Ávila','Castilla y León'), ('06','Badajoz','Extremadura'),
  ('07','Baleares','Illes Balears'), ('08','Barcelona','Cataluña'),
  ('09','Burgos','Castilla y León'), ('10','Cáceres','Extremadura'),
  ('11','Cádiz','Andalucía'), ('12','Castellón','Comunidad Valenciana'),
  ('13','Ciudad Real','Castilla-La Mancha'), ('14','Córdoba','Andalucía'),
  ('15','A Coruña','Galicia'), ('16','Cuenca','Castilla-La Mancha'),
  ('17','Girona','Cataluña'), ('18','Granada','Andalucía'),
  ('19','Guadalajara','Castilla-La Mancha'), ('20','Gipuzkoa','País Vasco'),
  ('21','Huelva','Andalucía'), ('22','Huesca','Aragón'),
  ('23','Jaén','Andalucía'), ('24','León','Castilla y León'),
  ('25','Lleida','Cataluña'), ('26','La Rioja','La Rioja'),
  ('27','Lugo','Galicia'), ('28','Madrid','Comunidad de Madrid'),
  ('29','Málaga','Andalucía'), ('30','Murcia','Región de Murcia'),
  ('31','Navarra','Navarra'), ('32','Ourense','Galicia'),
  ('33','Asturias','Asturias'), ('34','Palencia','Castilla y León'),
  ('35','Las Palmas','Canarias'), ('36','Pontevedra','Galicia'),
  ('37','Salamanca','Castilla y León'), ('38','Santa Cruz de Tenerife','Canarias'),
  ('39','Cantabria','Cantabria'), ('40','Segovia','Castilla y León'),
  ('41','Sevilla','Andalucía'), ('42','Soria','Castilla y León'),
  ('43','Tarragona','Cataluña'), ('44','Teruel','Aragón'),
  ('45','Toledo','Castilla-La Mancha'), ('46','Valencia','Comunidad Valenciana'),
  ('47','Valladolid','Castilla y León'), ('48','Bizkaia','País Vasco'),
  ('49','Zamora','Castilla y León'), ('50','Zaragoza','Aragón'),
  ('51','Ceuta','Ceuta'), ('52','Melilla','Melilla')
on conflict (code) do update set name = excluded.name, region = excluded.region;

-- ---------------------------------------------------------------------------
-- Normalizar un texto: mayúsculas y sin tildes, para comparar nombres
-- ---------------------------------------------------------------------------

/*
  Con translate() y no con unaccent(): la extensión no está instalada y pedirla
  para esto sería pagar una dependencia por quitar cuatro tildes.
*/
create or replace function public.texto_llano(p_texto text)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select upper(btrim(translate(coalesce(p_texto, ''),
    'ÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇáàäâãéèëêíìïîóòöôõúùüûñç',
    'AAAAAEEEEIIIIOOOOOUUUUNCAAAAAEEEEIIIIOOOOOUUUUNC')));
$$;

-- ---------------------------------------------------------------------------
-- Los nombres con los que aparece cada provincia escrita
-- ---------------------------------------------------------------------------

create table if not exists public.es_province_aliases (
  alias text primary key,
  code char(2) not null references public.es_provinces (code) on delete cascade
);

-- El nombre oficial de cada una, ya normalizado.
insert into public.es_province_aliases (alias, code)
select public.texto_llano(p.name), p.code from public.es_provinces p
on conflict (alias) do update set code = excluded.code;

/*
  Y las demás formas de escribirlas: las bilingües, las abreviadas y las que
  se han visto de verdad en las fichas. Las que llevan barra se guardan
  enteras y también por mitades, porque Sage escribe unas veces una cosa y
  otras otra.
*/
insert into public.es_province_aliases (alias, code) values
  ('ARABA', '01'), ('ALAVA', '01'), ('ARABA/ALAVA', '01'), ('ALAVA/ARABA', '01'),
  ('ALACANT', '03'), ('ALICANTE/ALACANT', '03'), ('ALACANT/ALICANT', '03'), ('ALICANT', '03'),
  ('ILLES BALEARS', '07'), ('ISLAS BALEARES', '07'), ('BALEARS', '07'), ('MALLORCA', '07'),
  ('CASTELLO', '12'), ('CASTELLON/CASTELLO', '12'), ('CASTELLO/CASTELLON', '12'),
  ('LA CORUNA', '15'), ('CORUNA', '15'), ('A CORUNA', '15'),
  ('GERONA', '17'), ('GUIPUZCOA', '20'), ('GUIPUZKOA', '20'),
  ('LERIDA', '25'), ('RIOJA', '26'), ('LOGRONO', '26'),
  ('ORENSE', '32'), ('PRINCIPADO DE ASTURIAS', '33'), ('OVIEDO', '33'),
  ('GRAN CANARIA', '35'), ('PALMAS', '35'),
  ('TENERIFE', '38'), ('STA CRUZ DE TENERIFE', '38'), ('SANTA CRUZ TENERIFE', '38'),
  ('S C TENERIFE', '38'), ('SANTANDER', '39'),
  ('VALENCIA/VALENCIA', '46'), ('VALENCIA/VALENCIA ', '46'),
  ('VIZCAYA', '48'), ('BILBAO', '48')
on conflict (alias) do update set code = excluded.code;

alter table public.es_provinces enable row level security;
alter table public.es_province_aliases enable row level security;
drop policy if exists es_provinces_read on public.es_provinces;
create policy es_provinces_read on public.es_provinces for select to authenticated using (true);
drop policy if exists es_province_aliases_read on public.es_province_aliases;
create policy es_province_aliases_read on public.es_province_aliases for select to authenticated using (true);
revoke insert, update, delete, truncate on public.es_provinces from anon, authenticated;
revoke insert, update, delete, truncate on public.es_province_aliases from anon, authenticated;

-- ---------------------------------------------------------------------------
-- De un código postal a su provincia
-- ---------------------------------------------------------------------------

/*
  Se queda solo con los dígitos: en las fichas hay códigos con espacios, con
  guiones y alguno de cuatro cifras al que se le ha comido el cero de delante
  («2007» por «02007»), que es lo que pasa cuando el campo pasa por una hoja
  de cálculo.

  Nulo si no sale un código entre 01 y 52: un CP portugués o un teléfono
  metido donde no toca no pueden acabar inventando una provincia.
*/
create or replace function public.provincia_de_cp(p_postal text)
returns char(2)
language sql
stable
set search_path to 'public'
as $$
  select p.code
  from public.es_provinces p
  where p.code = left(lpad(nullif(regexp_replace(coalesce(p_postal, ''), '\D', '', 'g'), ''), 5, '0'), 2);
$$;

create or replace function public.provincia_de_texto(p_texto text)
returns char(2)
language sql
stable
set search_path to 'public'
as $$
  with llano as (select public.texto_llano(p_texto) as t)
  select a.code
  from llano, public.es_province_aliases a
  where a.alias = llano.t
     or a.alias = btrim(split_part(llano.t, '/', 1))
     or a.alias = btrim(split_part(llano.t, '/', 2))
  limit 1;
$$;

/** El código postal manda; el texto solo entra cuando no hay CP que valga. */
create or replace function public.provincia_de(p_postal text, p_texto text)
returns char(2)
language sql
stable
set search_path to 'public'
as $$
  select coalesce(public.provincia_de_cp(p_postal), public.provincia_de_texto(p_texto));
$$;

-- ---------------------------------------------------------------------------
-- Los clientes de cada provincia
-- ---------------------------------------------------------------------------

drop function if exists public.sage_customer_zones(date, date, smallint[], text[], text[], text[], text[], text[]);
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
           coalesce(nullif(btrim(c.municipality), ''), 'Sin municipio') as municipio,
           /*
             Discrepa si los dos datos existen, los dos se entienden, y no
             dicen lo mismo. No cuenta como discrepancia que falte uno.
           */
           (public.provincia_de_cp(c.postal_code) is not null
            and public.provincia_de_texto(c.province) is not null
            and public.provincia_de_cp(c.postal_code) <> public.provincia_de_texto(c.province)) as discrepa
    from sage_customers c
    where (p_companies is null or c.company_code = any(p_companies))
      -- La misma forma que el resto del panel: «sociedad:comercial».
      and (p_reps is null or (c.company_code::text || ':' || coalesce(c.rep_code::text, 'sin')) = any(p_reps))
  ),
  -- Si se filtra por familia, solo cuentan los clientes que compraron de ella
  -- en el periodo: si no, la zona enseñaría clientes que no tienen nada que
  -- ver con lo que se está mirando.
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
           c.municipio,
           c.discrepa,
           v.neto,
           v.albaranes
    from ventas v
    join clientes c on c.company_code = v.company_code and c.customer_code = v.customer_code
  ),
  por_municipio as (
    select j.prov, j.municipio,
           count(*)::bigint as clientes,
           round(sum(j.neto), 2) as neto
    from juntos j
    group by j.prov, j.municipio
  )
  select
    j.prov::char(2) as province_code,
    coalesce(p.name, 'Sin provincia') as province,
    coalesce(p.region, 'Sin asignar') as region,
    count(*)::bigint as customers,
    round(sum(j.neto), 2) as net_amount,
    coalesce(sum(j.albaranes), 0)::bigint as documents,
    count(*) filter (where j.discrepa)::bigint as mismatched,
    (select jsonb_agg(jsonb_build_object('name', m.municipio, 'customers', m.clientes, 'net', m.neto)
                      order by m.neto desc nulls last)
     from por_municipio m where m.prov = j.prov) as municipalities
  from juntos j
  left join public.es_provinces p on p.code = j.prov
  group by j.prov, p.name, p.region
  order by sum(j.neto) desc nulls last;
$$;

revoke execute on function public.sage_customer_zones(date, date, smallint[], text[], text[], text[], text[], text[]) from public, anon;
grant execute on function public.sage_customer_zones(date, date, smallint[], text[], text[], text[], text[], text[]) to authenticated;

comment on function public.sage_customer_zones(date, date, smallint[], text[], text[], text[], text[], text[]) is
  'Clientes y venta por provincia, con el detalle por municipio. La provincia sale del código postal; el texto de Sage solo se usa si no hay CP.';
