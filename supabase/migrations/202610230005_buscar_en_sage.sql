-- Buscar en los artículos de Sage, sin reescribir la tabla.
--
-- La migración anterior intentaba añadir una columna generada a
-- sage_articles. Un ALTER TABLE ADD COLUMN ... STORED reescribe la tabla
-- entera, y con 141.527 artículos eso se pasa del tiempo que aguanta el
-- editor de Supabase: se cortó a medias y se deshizo con ella el índice y la
-- función que venían detrás. Por eso quedaron buscar_en_catalogos y
-- buscar_en_tarifas pero no buscar_en_sage.
--
-- Aquí no hay columna nueva. El índice va sobre la expresión y la función usa
-- esa misma expresión, letra por letra, que es la condición para que Postgres
-- lo aproveche. Crear el índice recorre la tabla una vez; no la reescribe.
--
-- Por qué hace falta: los comerciales preguntan por las referencias que usan
-- a diario, que son las de Sage. Y las marcas de la casa no están en la
-- carpeta de tarifas de proveedor: el secador JKEP 1495 no sale en ningún
-- catálogo, pero sí aquí, con su código.
--
-- Se puede volver a ejecutar sin romper nada.

create index if not exists sage_articles_busqueda on public.sage_articles
  using gin (to_tsvector('spanish',
    coalesce(name, '') || ' ' ||
    coalesce(code, '') || ' ' ||
    coalesce(brand, '') || ' ' ||
    coalesce(manufacturer, '')));

create or replace function public.buscar_en_sage(consulta text, laxo boolean default false, tope integer default 12)
returns table (codigo text, nombre text, marca text, fabricante text, familia text, relevancia real)
language sql
stable
as $$
  select a.code, a.name, a.brand, a.manufacturer, fam.name,
         ts_rank(
           to_tsvector('spanish',
             coalesce(a.name, '') || ' ' ||
             coalesce(a.code, '') || ' ' ||
             coalesce(a.brand, '') || ' ' ||
             coalesce(a.manufacturer, '')),
           public.catalogos_consulta(consulta, laxo))
  from public.sage_articles a
  left join public.sage_families fam
    on fam.company_code = a.company_code and fam.code = a.family_code
  where public.catalogos_consulta(consulta, laxo) is not null
    and to_tsvector('spanish',
          coalesce(a.name, '') || ' ' ||
          coalesce(a.code, '') || ' ' ||
          coalesce(a.brand, '') || ' ' ||
          coalesce(a.manufacturer, '')) @@ public.catalogos_consulta(consulta, laxo)
    -- Lo descatalogado no se ofrece a un cliente.
    and coalesce(a.obsolete, false) = false
  order by ts_rank(
             to_tsvector('spanish',
               coalesce(a.name, '') || ' ' ||
               coalesce(a.code, '') || ' ' ||
               coalesce(a.brand, '') || ' ' ||
               coalesce(a.manufacturer, '')),
             public.catalogos_consulta(consulta, laxo)) desc
  limit least(greatest(tope, 1), 40);
$$;

comment on function public.buscar_en_sage(text, boolean, integer) is
  'Artículos de Sage que encajan: es por donde se encuentran las referencias de la casa.';
