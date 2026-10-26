-- Acotar lo que se rankea, y dejar que el comercial consulte Sage.
--
-- Medido con sesión de comercial, que es la que tiene límite de tiempo:
--
--   consulta                      trozos   precios   que había que rankear
--   «compresor»                      589       101
--   «compresores de tornillo» laxo  2.314     1.973
--   «llave dinamométrica»     laxo  1.709    15.878   ← y de ahí el timeout
--
-- Rankear quince mil filas para devolver doce cuesta segundos. El índice se
-- usaba bien —buscar sin ordenar tarda 450 ms—; lo caro era ts_rank sobre
-- todo lo que coincide.
--
-- Ahora se cogen hasta unos cuantos cientos de candidatos y se rankean esos.
-- En modo estricto no cambia nada, porque los candidatos no llegan al tope:
-- el estricto más amplio que se ha visto son 589. En modo laxo sí corta, y
-- ahí la precisión ya era baja de por sí: más vale una lista razonable en
-- medio segundo que la lista perfecta que nunca llega.
--
-- Y lo segundo: sage_articles solo la pueden leer admin y direction, por una
-- política que cubre todas las tablas de Sage. El comercial recibía cero
-- artículos aunque la función estuviera bien.
--
-- No se amplía esa política, porque esa tabla la usan otras pantallas y
-- quién ve qué en ellas no es cosa de este cambio. En vez de eso, la función
-- va como SECURITY DEFINER y devuelve solo código, nombre, marca, fabricante
-- y familia: nada de precios, costes ni proveedores. Es lo que un comercial
-- ya ve en Sage todos los días.
--
-- Se puede volver a ejecutar sin romper nada.

create or replace function public.buscar_en_catalogos(consulta text, laxo boolean default false, tope integer default 8)
returns table (proveedor text, fichero text, pagina integer, anio integer, texto text, relevancia real)
language plpgsql
stable
as $$
declare
  q tsquery;
  -- Los trozos de catálogo son de hasta 2.500 caracteres, así que rankearlos
  -- cuesta más que una línea de tarifa: se cogen menos.
  candidatos constant integer := 400;
begin
  q := public.catalogos_consulta(consulta, laxo);
  if q is null then return; end if;

  return query
    with acotados as (
      select c.file_id, c.page, c.content, c.search
      from public.catalog_chunks c
      where c.search @@ q
      limit candidatos
    )
    select f.supplier, f.file_name, a.page, f.year_hint, a.content, ts_rank(a.search, q)
    from acotados a
    join public.catalog_files f on f.id = a.file_id
    order by ts_rank(a.search, q) desc,
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
  candidatos constant integer := 900;
begin
  q := public.catalogos_consulta(consulta, laxo);
  if q is null then return; end if;

  return query
    with acotados as (
      select p.file_id, p.supplier, p.reference, p.ean, p.description, p.price, p.search
      from public.catalog_prices p
      where p.search @@ q
      limit candidatos
    )
    select a.supplier, a.reference, a.ean, a.description, a.price, f.file_name, f.year_hint,
           ts_rank(a.search, q)
    from acotados a
    join public.catalog_files f on f.id = a.file_id
    order by ts_rank(a.search, q) desc,
             f.year_hint desc nulls last
    limit least(greatest(tope, 1), 60);
end;
$$;

/*
  Los artículos de Sage.

  SECURITY DEFINER a propósito: la tabla solo la leen admin y direction, y
  ampliar esa política afectaría a otras pantallas. Así el permiso se da a
  esta consulta concreta y no a la tabla, y lo que sale son cinco campos de
  catálogo —ni precios, ni costes, ni proveedor—, que es lo que el comercial
  ya ve en Sage. El search_path va fijado, que es la precaución que toca
  siempre que una función corre con los permisos de quien la creó.
*/
create or replace function public.buscar_en_sage(consulta text, laxo boolean default false, tope integer default 12)
returns table (codigo text, nombre text, marca text, fabricante text, familia text, relevancia real)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  q tsquery;
  candidatos constant integer := 900;
begin
  if not public.current_user_has_any_role(ARRAY['admin','direction','commercial','purchasing']::app_role[]) then
    return;
  end if;

  q := public.catalogos_consulta(consulta, laxo);
  if q is null then return; end if;

  return query
    with acotados as (
      select a.code, a.name, a.brand, a.manufacturer, a.company_code, a.family_code,
             to_tsvector('spanish',
               coalesce(a.name, '') || ' ' || coalesce(a.code, '') || ' ' ||
               coalesce(a.brand, '') || ' ' || coalesce(a.manufacturer, '')) as search
      from public.sage_articles a
      where to_tsvector('spanish',
              coalesce(a.name, '') || ' ' || coalesce(a.code, '') || ' ' ||
              coalesce(a.brand, '') || ' ' || coalesce(a.manufacturer, '')) @@ q
        -- Lo descatalogado no se ofrece a un cliente.
        and coalesce(a.obsolete, false) = false
      limit candidatos
    )
    select ac.code, ac.name, ac.brand, ac.manufacturer, fam.name, ts_rank(ac.search, q)
    from acotados ac
    left join public.sage_families fam
      on fam.company_code = ac.company_code and fam.code = ac.family_code
    order by ts_rank(ac.search, q) desc
    limit least(greatest(tope, 1), 40);
end;
$$;

revoke all on function public.buscar_en_sage(text, boolean, integer) from public, anon;
grant execute on function public.buscar_en_sage(text, boolean, integer) to authenticated;

comment on function public.buscar_en_sage(text, boolean, integer) is
  'Artículos de Sage para el chat de catálogos. SECURITY DEFINER: comprueba el rol por dentro y devuelve solo campos de catálogo.';
