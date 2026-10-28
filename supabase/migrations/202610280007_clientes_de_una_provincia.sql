-- Los clientes de una provincia, para abrirlos desde el mapa de España.
--
-- El mapa municipal solo está dibujado para la Comunidad Valenciana, que es
-- donde está el grueso de la cartera. Pero pulsar Madrid o Sevilla tiene que
-- hacer algo: sin esto, fuera de esas tres provincias el mapa se quedaba en
-- un adorno que se pintaba de azul y nada más.
--
-- La provincia se decide igual que en el mapa, por código postal, así que la
-- lista de una provincia es exactamente la misma gente que la pinta. Y
-- devuelve las mismas columnas que sage_customer_list para que el panel la
-- enseñe como una lista más, con su buscador, su descarga y su botón de
-- volver desde la ficha de un cliente.

create or replace function public.sage_province_customers(
  p_province char(2),
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
  -- «ZZ» son los que no tienen ni código postal ni provincia entendible: el
  -- mapa los deja fuera y la tabla los junta bajo «Sin provincia», así que
  -- esa fila también se tiene que poder abrir.
  where coalesce(public.provincia_de(c.postal_code, c.province), 'ZZ') = p_province;
$$;

revoke execute on function public.sage_province_customers(char, date, date, smallint[], text[], text[], text[], text[], text[]) from public, anon;
grant execute on function public.sage_province_customers(char, date, date, smallint[], text[], text[], text[], text[], text[]) to authenticated;

comment on function public.sage_province_customers(char, date, date, smallint[], text[], text[], text[], text[], text[]) is
  'Los clientes de una provincia, con las mismas columnas que sage_customer_list. La provincia sale del código postal, igual que en el mapa.';
