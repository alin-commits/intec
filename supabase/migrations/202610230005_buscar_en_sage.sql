-- Las tres búsquedas, calculando la consulta una sola vez. Y la de Sage.
--
-- Dos problemas que se vieron probando con una sesión de comercial de verdad,
-- y que como administrador no se notan:
--
-- 1. TIMEOUT. buscar_en_tarifas se pasaba del límite de tiempo que tienen los
--    usuarios normales (el rol de servicio no lo tiene, por eso parecía que
--    todo iba bien). El motivo: cada función llamaba a catalogos_consulta()
--    tres veces —en el where, en el select y en el order by—. Postgres no la
--    inlinea, así que la ejecutaba una vez POR FILA. Con 300.000 precios, eso
--    son 900.000 llamadas para devolver veinte resultados.
--
--    Ahora se calcula una vez en un CTE MATERIALIZED y se reutiliza.
--
-- 2. La parte de Sage de la migración anterior no llegó a aplicarse. Un ALTER
--    TABLE ADD COLUMN ... STORED reescribe la tabla entera y con 141.527
--    artículos se pasa del tiempo del editor de Supabase; al cortarse se
--    deshizo con ella el índice y la función. Aquí no hay columna nueva: el
--    índice va sobre la expresión y la función usa esa misma expresión,
--    letra por letra, que es la condición para que Postgres lo aproveche.
--    Crear el índice recorre la tabla una vez; no la reescribe.
--
-- Por qué hace falta Sage: los comerciales preguntan por las referencias que
-- usan a diario, y las marcas de la casa no están en la carpeta de tarifas de
-- proveedor. El secador JKEP 1495 no sale en ningún catálogo, pero sí aquí.
--
-- Se puede volver a ejecutar sin romper nada.

create or replace function public.buscar_en_catalogos(consulta text, laxo boolean default false, tope integer default 8)
returns table (proveedor text, fichero text, pagina integer, anio integer, texto text, relevancia real)
language sql
stable
as $$
  with q as materialized (select public.catalogos_consulta(consulta, laxo) as t)
  select f.supplier, f.file_name, c.page, f.year_hint, c.content, ts_rank(c.search, q.t)
  from public.catalog_chunks c
  join public.catalog_files f on f.id = c.file_id
  cross join q
  where q.t is not null and c.search @@ q.t
  order by ts_rank(c.search, q.t) desc,
           -- A igual relevancia, antes lo más reciente: una tarifa de 2026
           -- vale más que la misma de 2022.
           f.year_hint desc nulls last
  limit least(greatest(tope, 1), 40);
$$;

create or replace function public.buscar_en_tarifas(consulta text, laxo boolean default false, tope integer default 12)
returns table (proveedor text, referencia text, ean text, descripcion text, precio numeric,
               fichero text, anio integer, relevancia real)
language sql
stable
as $$
  with q as materialized (select public.catalogos_consulta(consulta, laxo) as t)
  select p.supplier, p.reference, p.ean, p.description, p.price, f.file_name, f.year_hint,
         ts_rank(p.search, q.t)
  from public.catalog_prices p
  join public.catalog_files f on f.id = p.file_id
  cross join q
  where q.t is not null and p.search @@ q.t
  order by ts_rank(p.search, q.t) desc,
           f.year_hint desc nulls last
  limit least(greatest(tope, 1), 60);
$$;

-- ---------------------------------------------------------------------------
-- Los artículos de Sage
-- ---------------------------------------------------------------------------

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
  with q as materialized (select public.catalogos_consulta(consulta, laxo) as t)
  select a.code, a.name, a.brand, a.manufacturer, fam.name,
         ts_rank(to_tsvector('spanish',
           coalesce(a.name, '') || ' ' || coalesce(a.code, '') || ' ' ||
           coalesce(a.brand, '') || ' ' || coalesce(a.manufacturer, '')), q.t)
  from public.sage_articles a
  cross join q
  left join public.sage_families fam
    on fam.company_code = a.company_code and fam.code = a.family_code
  where q.t is not null
    and to_tsvector('spanish',
          coalesce(a.name, '') || ' ' || coalesce(a.code, '') || ' ' ||
          coalesce(a.brand, '') || ' ' || coalesce(a.manufacturer, '')) @@ q.t
    -- Lo descatalogado no se ofrece a un cliente.
    and coalesce(a.obsolete, false) = false
  order by ts_rank(to_tsvector('spanish',
             coalesce(a.name, '') || ' ' || coalesce(a.code, '') || ' ' ||
             coalesce(a.brand, '') || ' ' || coalesce(a.manufacturer, '')), q.t) desc
  limit least(greatest(tope, 1), 40);
$$;

comment on function public.buscar_en_sage(text, boolean, integer) is
  'Artículos de Sage que encajan: es por donde se encuentran las referencias de la casa.';
