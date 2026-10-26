-- Que la búsqueda use el índice. Tardaba segundos para devolver doce filas.
--
-- Medido con sesión de comercial, que es la que tiene límite de tiempo:
--
--   «compresor» coincide con 101 precios de 300.000 ... y tardaba 8,4 s
--
-- Rankear 101 filas no cuesta 8 segundos. Lo que pasaba es que no se usaba el
-- índice GIN: se recorrían las 300.000 filas una a una.
--
-- Por qué. La versión anterior calculaba el tsquery en un CTE MATERIALIZED
-- para no llamar a catalogos_consulta() una vez por fila. Eso arregló aquello
-- y rompió esto: con el tsquery saliendo de una subconsulta materializada, el
-- planificador ya no puede empujarlo al índice, porque en tiempo de plan no
-- es un valor conocido. Seq Scan.
--
-- En SQL puro no hay forma: o se llama a la función por fila, o se materializa
-- y se pierde el índice. Con PL/pgSQL sí, porque el tsquery va a una variable
-- y la consulta lo recibe como parámetro —un valor, no una subconsulta—, que
-- es justo lo que el índice necesita.
--
-- Se puede volver a ejecutar sin romper nada.

create or replace function public.buscar_en_catalogos(consulta text, laxo boolean default false, tope integer default 8)
returns table (proveedor text, fichero text, pagina integer, anio integer, texto text, relevancia real)
language plpgsql
stable
as $$
declare
  q tsquery;
begin
  q := public.catalogos_consulta(consulta, laxo);
  if q is null then return; end if;

  return query
    select f.supplier, f.file_name, c.page, f.year_hint, c.content, ts_rank(c.search, q)
    from public.catalog_chunks c
    join public.catalog_files f on f.id = c.file_id
    where c.search @@ q
    order by ts_rank(c.search, q) desc,
             -- A igual relevancia, antes lo más reciente: una tarifa de 2026
             -- vale más que la misma de 2022.
             f.year_hint desc nulls last
    limit least(greatest(tope, 1), 40);
end;
$$;

create or replace function public.buscar_en_tarifas(consulta text, laxo boolean default false, tope integer default 12)
returns table (proveedor text, referencia text, ean text, descripcion text, precio numeric,
               fichero text, anio integer, relevancia real)
language plpgsql
stable
as $$
declare
  q tsquery;
begin
  q := public.catalogos_consulta(consulta, laxo);
  if q is null then return; end if;

  return query
    select p.supplier, p.reference, p.ean, p.description, p.price, f.file_name, f.year_hint,
           ts_rank(p.search, q)
    from public.catalog_prices p
    join public.catalog_files f on f.id = p.file_id
    where p.search @@ q
    order by ts_rank(p.search, q) desc,
             f.year_hint desc nulls last
    limit least(greatest(tope, 1), 60);
end;
$$;

create or replace function public.buscar_en_sage(consulta text, laxo boolean default false, tope integer default 12)
returns table (codigo text, nombre text, marca text, fabricante text, familia text, relevancia real)
language plpgsql
stable
as $$
declare
  q tsquery;
begin
  q := public.catalogos_consulta(consulta, laxo);
  if q is null then return; end if;

  -- La expresión va escrita igual que en el índice sage_articles_busqueda,
  -- letra por letra: es la condición para que Postgres lo aproveche.
  return query
    select a.code, a.name, a.brand, a.manufacturer, fam.name,
           ts_rank(to_tsvector('spanish',
             coalesce(a.name, '') || ' ' || coalesce(a.code, '') || ' ' ||
             coalesce(a.brand, '') || ' ' || coalesce(a.manufacturer, '')), q)
    from public.sage_articles a
    left join public.sage_families fam
      on fam.company_code = a.company_code and fam.code = a.family_code
    where to_tsvector('spanish',
            coalesce(a.name, '') || ' ' || coalesce(a.code, '') || ' ' ||
            coalesce(a.brand, '') || ' ' || coalesce(a.manufacturer, '')) @@ q
      -- Lo descatalogado no se ofrece a un cliente.
      and coalesce(a.obsolete, false) = false
    order by ts_rank(to_tsvector('spanish',
               coalesce(a.name, '') || ' ' || coalesce(a.code, '') || ' ' ||
               coalesce(a.brand, '') || ' ' || coalesce(a.manufacturer, '')), q) desc
    limit least(greatest(tope, 1), 40);
end;
$$;
