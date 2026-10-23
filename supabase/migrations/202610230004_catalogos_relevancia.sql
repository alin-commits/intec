-- Buscar por relevancia, y buscar también en los artículos de Sage.
--
-- Lo que pasaba: «búscame todos los compresores de tornillo» devolvía dos
-- catálogos de expositores de BETA y ni un compresor, teniendo 1.890 páginas
-- cargadas que hablan de tornillo. El chat respondía razonablemente con lo
-- poco que le llegaba; el problema era lo que le llegaba.
--
-- Dos motivos:
--
--   1. Sin ORDER BY, una consulta de texto devuelve lo que encuentra primero.
--      Da igual que coincida en una palabra o en cinco. Hace falta ts_rank.
--
--   2. El plan B —si no coincide todo, busca cualquiera de las palabras— sin
--      ranking es peor que no tener plan B: gana el documento con más texto
--      suelto, que es justo el que menos viene a cuento.
--
-- Y una tercera fuente: los artículos de Sage.
--
-- Los comerciales preguntan por las referencias que usan a diario, que son
-- las de Sage, no las del proveedor. Y las marcas de la casa —Jender,
-- BlizzCool— no están en la carpeta de tarifas de proveedor: el secador
-- JKEP 1495 no aparece en ningún catálogo, pero sí en Sage, con su código.
-- Sin esto, media pregunta de comercial no tiene respuesta posible.
--
-- PostgREST no sabe ordenar por una expresión como ts_rank, así que la
-- búsqueda se baja a funciones y el Hub las llama por su nombre.
--
-- Las funciones son SECURITY INVOKER (lo de por defecto): se ejecutan como
-- quien pregunta, así que las políticas de las tablas siguen mandando.
--
-- Se puede volver a ejecutar sin romper nada.

/*
  La consulta, en estricto o en laxo.

  websearch_to_tsquery une las palabras con &: tienen que estar todas. En
  laxo se cambian esos & por |, que basta con una. El texto de un tsquery es
  estable y volver a convertirlo es la forma corta de hacerlo sin repetir el
  análisis morfológico.
*/
create or replace function public.catalogos_consulta(consulta text, laxo boolean default false)
returns tsquery
language sql
immutable
as $$
  select case
    when laxo then nullif(replace(websearch_to_tsquery('spanish', consulta)::text, ' & ', ' | '), '')::tsquery
    else nullif(websearch_to_tsquery('spanish', consulta)::text, '')::tsquery
  end;
$$;

create or replace function public.buscar_en_catalogos(consulta text, laxo boolean default false, tope integer default 8)
returns table (proveedor text, fichero text, pagina integer, anio integer, texto text, relevancia real)
language sql
stable
as $$
  select f.supplier, f.file_name, c.page, f.year_hint, c.content,
         ts_rank(c.search, public.catalogos_consulta(consulta, laxo))
  from public.catalog_chunks c
  join public.catalog_files f on f.id = c.file_id
  where public.catalogos_consulta(consulta, laxo) is not null
    and c.search @@ public.catalogos_consulta(consulta, laxo)
  order by ts_rank(c.search, public.catalogos_consulta(consulta, laxo)) desc,
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
  select p.supplier, p.reference, p.ean, p.description, p.price, f.file_name, f.year_hint,
         ts_rank(p.search, public.catalogos_consulta(consulta, laxo))
  from public.catalog_prices p
  join public.catalog_files f on f.id = p.file_id
  where public.catalogos_consulta(consulta, laxo) is not null
    and p.search @@ public.catalogos_consulta(consulta, laxo)
  order by ts_rank(p.search, public.catalogos_consulta(consulta, laxo)) desc,
           f.year_hint desc nulls last
  limit least(greatest(tope, 1), 60);
$$;

-- ---------------------------------------------------------------------------
-- Los artículos de Sage
-- ---------------------------------------------------------------------------

alter table public.sage_articles
  add column if not exists search tsvector
  generated always as (
    to_tsvector('spanish',
      coalesce(name, '') || ' ' ||
      coalesce(code, '') || ' ' ||
      coalesce(brand, '') || ' ' ||
      coalesce(manufacturer, ''))
  ) stored;

create index if not exists sage_articles_busqueda on public.sage_articles using gin (search);

create or replace function public.buscar_en_sage(consulta text, laxo boolean default false, tope integer default 12)
returns table (codigo text, nombre text, marca text, fabricante text, familia text, relevancia real)
language sql
stable
as $$
  select a.code, a.name, a.brand, a.manufacturer, f.name,
         ts_rank(a.search, public.catalogos_consulta(consulta, laxo))
  from public.sage_articles a
  left join public.sage_families f
    on f.company_code = a.company_code and f.code = a.family_code
  where public.catalogos_consulta(consulta, laxo) is not null
    and a.search @@ public.catalogos_consulta(consulta, laxo)
    -- Lo descatalogado no se ofrece a un cliente.
    and coalesce(a.obsolete, false) = false
  order by ts_rank(a.search, public.catalogos_consulta(consulta, laxo)) desc
  limit least(greatest(tope, 1), 40);
$$;

comment on function public.buscar_en_catalogos(text, boolean, integer) is
  'Páginas de catálogo que hablan de la consulta, las más relevantes primero.';
comment on function public.buscar_en_tarifas(text, boolean, integer) is
  'Productos de tarifa que encajan con la consulta, los más relevantes primero.';
comment on function public.buscar_en_sage(text, boolean, integer) is
  'Artículos de Sage que encajan: es por donde se encuentran las referencias de la casa.';
comment on column public.sage_articles.search is
  'Nombre, código, marca y fabricante juntos, para buscar por palabras en español.';
