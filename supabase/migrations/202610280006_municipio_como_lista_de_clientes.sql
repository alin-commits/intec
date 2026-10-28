-- Los clientes de un municipio pasan a ser una lista más de las del panel.
--
-- Antes devolvían sus propias columnas y se pintaban en una ventana aparte.
-- El problema de eso se vio en cuanto se usó: desde esa ventana se abría la
-- ficha de un cliente y, al cerrarla, se cerraba todo y había que volver a
-- buscar el municipio en el mapa.
--
-- El panel ya tiene resuelto ese camino —la lista se queda viva detrás de la
-- ficha y se vuelve a ella con un botón—, pero solo para sus listas. Así que
-- en vez de montar otro «volver» en paralelo, esto devuelve exactamente las
-- mismas columnas que sage_customer_list y el municipio se convierte en una
-- lista más, con su buscador y su descarga a Excel de regalo.
--
-- Se implementa filtrando sobre esa función en vez de copiar su cuerpo: los
-- contactos, el bruto y el descuento se calculan en un solo sitio, y si
-- mañana cambian, cambian para todos.

drop function if exists public.sage_municipality_customers(char, date, date, smallint[], text[], text[], text[], text[], text[]);

create or replace function public.sage_municipality_customers(
  p_ine char(5),
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
  company_code smallint,
  customer_code text,
  name text,
  trade_name text,
  phone text,
  email text,
  province text,
  municipality text,
  rep_code integer,
  first_purchase date,
  last_purchase date,
  net_amount numeric,
  documents bigint,
  days_since_last integer,
  contact_name text,
  contact_phone text,
  contact_email text,
  gross_amount numeric,
  gross_net numeric
)
language sql
stable
security invoker
set search_path to 'public'
as $$
  select l.*
  from public.sage_customer_list(
    p_kind => 'activos',
    p_from => p_from,
    p_to => p_to,
    p_companies => p_companies,
    p_reps => p_reps,
    p_series => p_series,
    p_families => p_families,
    p_days => 30,
    p_months => p_months,
    p_subfamilies => p_subfamilies
  ) l
  join sage_customers c
    on c.company_code = l.company_code and c.code = l.customer_code
  -- El municipio se decide igual que en el mapa, por código postal: así la
  -- lista de un municipio es la misma gente que lo pinta de azul.
  where public.municipio_de_cp(c.postal_code, c.municipality) = p_ine;
$$;

revoke execute on function public.sage_municipality_customers(char, date, date, smallint[], text[], text[], text[], text[], text[]) from public, anon;
grant execute on function public.sage_municipality_customers(char, date, date, smallint[], text[], text[], text[], text[], text[]) to authenticated;

comment on function public.sage_municipality_customers(char, date, date, smallint[], text[], text[], text[], text[], text[]) is
  'Los clientes de un municipio, con las mismas columnas que sage_customer_list para que el panel los enseñe como una lista más.';
