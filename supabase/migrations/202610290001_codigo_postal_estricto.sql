-- Un código postal que no es español ya no cae en una provincia española.
--
-- La provincia salía de quitarle al código todo lo que no fuera cifra y
-- quedarse con las dos primeras. Con un código portugués eso daba una
-- provincia al azar: «3505-459» (Viseu) se quedaba en 35054 y caía en Las
-- Palmas; «3064-908» en Murcia; «4410-160» en Teruel; un «1975BV» de Países
-- Bajos en Álava y un «111121» de Bogotá en Cádiz. Eran 26 clientes pintados
-- en el mapa donde no están.
--
-- Ahora el código solo cuenta si es de verdad un código español: cuatro o
-- cinco cifras y nada más —cuatro, porque a muchos se les ha comido el cero
-- de delante—, admitiendo espacios y puntos de por medio. Si no lo es, la
-- provincia sale del texto que hay escrito en la ficha, y si tampoco se
-- entiende, el cliente va a «Sin provincia», que es lo honrado.
--
-- Comprobado antes de escribirlo sobre los 6.945 clientes: cambian 26, y los
-- 26 pasan de una provincia inventada a la del texto o a ninguna. Ninguno
-- cambia de una provincia española a otra.
--
-- Misma firma que antes, así que no deja ninguna versión vieja al lado.

create or replace function public.provincia_de_cp(p_postal text)
returns char(2)
language sql
stable
set search_path to 'public'
as $$
  select p.code
  from public.es_provinces p
  where regexp_replace(btrim(coalesce(p_postal, '')), '[\s.]', '', 'g') ~ '^[0-9]{4,5}$'
    and p.code = left(lpad(regexp_replace(btrim(p_postal), '[\s.]', '', 'g'), 5, '0'), 2);
$$;

-- Lo mismo para el municipio: «030139» lleva MURCIA escrito, y recortado a
-- cinco cifras daba un código de Alicante que existe.
create or replace function public.municipio_de_cp(p_postal text, p_texto text default null)
returns char(5)
language sql
stable
set search_path to 'public'
as $$
  with codigo as (
    select regexp_replace(btrim(coalesce(p_postal, '')), '[\s.]', '', 'g') as limpio
  ),
  candidatos as (
    select m.ine, m.name
    from public.cp_municipios m, codigo
    where codigo.limpio ~ '^[0-9]{4,5}$'
      and m.postal_code = lpad(codigo.limpio, 5, '0')
  )
  select ine from (
    select c.ine,
           case when public.municipio_llano(c.name) = public.municipio_llano(p_texto) then 0 else 1 end as orden
    from candidatos c
  ) ordenados
  order by orden, ine
  limit 1;
$$;
