-- Las carpetas del gestor vuelven a estar anidadas, como en TurtlePass.
--
-- La migración desde el gestor anterior metió la ruta entera dentro del nombre
-- ("Dpto. Marketing e IT / Blizzcool") porque esta tabla no tenía jerarquía. El
-- panel partía ese texto para dibujar el árbol, pero en Accesos, en la ficha de
-- la credencial y en el desplegable de carpeta se veía el nombre completo, que
-- no es como se llama la carpeta en TurtlePass.
--
-- Aquí la madre pasa a ser una columna y el nombre se queda solo con su parte
-- ("Blizzcool"). Ninguna credencial cambia de carpeta: category_id no se toca.

alter table public.vault_categories
  add column if not exists parent_id uuid references public.vault_categories(id) on delete set null;

comment on column public.vault_categories.parent_id is
  'Carpeta madre, null en las de primer nivel. Refleja el árbol que ya tenía el gestor anterior.';

-- Al quitar el prefijo quedan nombres repetidos en departamentos distintos
-- (cuatro "Contraseña PC s" y dos "Contraseñas PC s", con apóstrofe), así que el nombre pasa a
-- ser único dentro de cada madre en vez de único en toda la tabla.
alter table public.vault_categories drop constraint if exists vault_categories_name_key;

-- coalesce en vez de (parent_id, name) a secas: en un índice único los null
-- cuentan como distintos, y dos carpetas de primer nivel podrían repetir nombre.
create unique index if not exists vault_categories_name_per_parent_idx
  on public.vault_categories (coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), name);

create index if not exists vault_categories_parent_idx on public.vault_categories (parent_id);

-- Cuelga cada carpeta de su madre y le deja solo su nombre. Corta por el último
-- " / ", así que una nieta encuentra a su madre aunque la madre se arregle en la
-- misma pasada. El bucle es por si quedara algún nivel más: en cuanto una vuelta
-- no mueve nada, sale.
do $$
declare
  moved integer;
begin
  loop
    with pending as (
      select id,
             regexp_replace(name, ' / [^/]*$', '') as parent_name,
             regexp_replace(name, '^.* / ', '') as leaf
      from public.vault_categories
      where name like '% / %'
    )
    update public.vault_categories as child
    set parent_id = parent.id,
        name = pending.leaf
    from pending
    join public.vault_categories as parent on parent.name = pending.parent_name
    where child.id = pending.id;
    get diagnostics moved = row_count;
    exit when moved = 0;
  end loop;
end $$;

-- TurtlePass tiene una carpeta "Personal" vacía. La importación no la creó porque
-- solo hacía carpeta para lo que traía credenciales dentro.
insert into public.vault_categories (name, description, sort_order)
select 'Personal', 'Carpeta del gestor anterior', 240
where not exists (
  select 1 from public.vault_categories where name = 'Personal' and parent_id is null
);
