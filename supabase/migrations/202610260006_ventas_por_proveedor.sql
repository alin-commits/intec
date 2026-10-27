-- Qué se vende de cada proveedor, y si sube o baja.
--
-- Hasta ahora el panel sabía qué compramos a cada proveedor (eso está en
-- compras) pero no cuánto vendemos de lo suyo. Son preguntas distintas: un
-- proveedor puede estar creciendo en pedidos nuestros y cayendo en venta,
-- y el que decide la negociación anual necesita la segunda.
--
-- El dato ya está: cada artículo lleva su proveedor y la venta por artículo
-- viene por mes desde la lectura de Sage. Esto solo lo junta.
--
-- Se puede volver a ejecutar sin romper nada.

/*
  La venta de cada proveedor en un tramo.

  Agrupa por el código de proveedor y no por sociedad: el mismo proveedor
  surte a las dos empresas y lo que se mira aquí es su peso en la casa. El
  nombre se coge de la ficha que mande Sage, y si no hay ninguna se queda el
  código, que al menos identifica.

  Los filtros son los del resto del panel —sociedad, comercial, meses,
  familia y subfamilia— para que la página se comporte como las demás.
*/
create or replace function public.sage_supplier_summary(p_from date, p_to date, p_companies smallint[] default null,
  p_families text[] default null, p_subfamilies text[] default null, p_cost_from date default '2025-11-01',
  p_months text[] default null, p_reps text[] default null)
returns table(supplier_code text, supplier_name text, articles bigint, units numeric, net_amount numeric,
  trusted_net numeric, trusted_cost numeric, trusted_without_cost numeric, gross_amount numeric, gross_net numeric)
language sql
stable
set search_path = public
as $$
  with ventas as (
    select coalesce(nullif(btrim(a.supplier_code), ''), '') as proveedor,
      s.article_code, s.units, s.net_amount, s.cost_amount, s.net_without_cost, s.gross_amount, s.month
    from sage_article_sales_monthly s
    join sage_articles a on a.company_code = s.company_code and a.code = s.article_code
    where s.month between date_trunc('month', p_from)::date and p_to
      and (p_months is null or to_char(s.month, 'YYYY-MM') = any(p_months))
      and (p_companies is null or s.company_code = any(p_companies))
      and (p_reps is null or (s.company_code::text || ':' || coalesce(s.rep_code::text, 'sin')) = any(p_reps))
      and (p_families is null or s.family_code = any(p_families))
      and (p_subfamilies is null or (s.family_code || ':' || s.subfamily_code) = any(p_subfamilies))
  ),
  grupos as (
    select v.proveedor,
      count(distinct v.article_code) as articulos,
      sum(v.units) as unidades,
      sum(v.net_amount) as neto,
      coalesce(sum(v.net_amount) filter (where v.month >= date_trunc('month', p_cost_from)), 0) as neto_fiable,
      coalesce(sum(v.cost_amount) filter (where v.month >= date_trunc('month', p_cost_from)), 0) as coste_fiable,
      coalesce(sum(v.net_without_cost) filter (where v.month >= date_trunc('month', p_cost_from)), 0) as sin_coste_fiable,
      coalesce(sum(v.gross_amount), 0) as bruto,
      coalesce(sum(v.net_amount) filter (where v.gross_amount is not null), 0) as neto_con_bruto
    from ventas v
    group by v.proveedor
  )
  select g.proveedor,
    (select max(p.name) from sage_suppliers p where btrim(p.code) = g.proveedor),
    g.articulos, g.unidades, g.neto, g.neto_fiable, g.coste_fiable, g.sin_coste_fiable, g.bruto, g.neto_con_bruto
  from grupos g
  order by g.neto desc;
$$;
revoke all on function public.sage_supplier_summary(date, date, smallint[], text[], text[], date, text[], text[]) from public, anon;
grant execute on function public.sage_supplier_summary(date, date, smallint[], text[], text[], date, text[], text[]) to authenticated, service_role;

/*
  Los artículos de un proveedor, para abrir su detalle.

  Es la misma lista de artículos más vendidos de la pantalla de productos,
  pero acotada a un proveedor. Va aparte y no como un parámetro más de
  sage_article_summary para no tocar una función que usa media pantalla:
  esta solo la llama la página de proveedores.
*/
create or replace function public.sage_supplier_articles(p_supplier text, p_from date, p_to date,
  p_companies smallint[] default null, p_families text[] default null, p_subfamilies text[] default null,
  p_limit integer default 50, p_cost_from date default '2025-11-01', p_months text[] default null,
  p_reps text[] default null)
returns table(article_code text, name text, brand text, family_code text, units numeric, documents bigint,
  net_amount numeric, trusted_net numeric, trusted_cost numeric, trusted_without_cost numeric,
  gross_amount numeric, gross_net numeric)
language sql
stable
set search_path = public
as $$
  select s.article_code, max(a.name), max(a.brand), s.family_code,
    sum(s.units), sum(s.documents)::bigint, sum(s.net_amount),
    coalesce(sum(s.net_amount) filter (where s.month >= date_trunc('month', p_cost_from)), 0),
    coalesce(sum(s.cost_amount) filter (where s.month >= date_trunc('month', p_cost_from)), 0),
    coalesce(sum(s.net_without_cost) filter (where s.month >= date_trunc('month', p_cost_from)), 0),
    coalesce(sum(s.gross_amount), 0),
    coalesce(sum(s.net_amount) filter (where s.gross_amount is not null), 0)
  from sage_article_sales_monthly s
  join sage_articles a on a.company_code = s.company_code and a.code = s.article_code
  where s.month between date_trunc('month', p_from)::date and p_to
    and coalesce(nullif(btrim(a.supplier_code), ''), '') = p_supplier
    and (p_months is null or to_char(s.month, 'YYYY-MM') = any(p_months))
    and (p_companies is null or s.company_code = any(p_companies))
    and (p_reps is null or (s.company_code::text || ':' || coalesce(s.rep_code::text, 'sin')) = any(p_reps))
    and (p_families is null or s.family_code = any(p_families))
    and (p_subfamilies is null or (s.family_code || ':' || s.subfamily_code) = any(p_subfamilies))
  group by s.article_code, s.family_code
  order by sum(s.net_amount) desc
  limit greatest(p_limit, 1);
$$;
revoke all on function public.sage_supplier_articles(text, date, date, smallint[], text[], text[], integer, date, text[], text[]) from public, anon;
grant execute on function public.sage_supplier_articles(text, date, date, smallint[], text[], text[], integer, date, text[], text[]) to authenticated, service_role;

/*
  La venta de un proveedor mes a mes, para su gráfico.

  Sale del reparto por artículo, que es mensual; el gráfico también lo es.
*/
create or replace function public.sage_supplier_months(p_supplier text, p_from date, p_to date,
  p_companies smallint[] default null, p_reps text[] default null)
returns table(month date, net_amount numeric)
language sql
stable
set search_path = public
as $$
  select s.month, sum(s.net_amount)
  from sage_article_sales_monthly s
  join sage_articles a on a.company_code = s.company_code and a.code = s.article_code
  where s.month between date_trunc('month', p_from)::date and p_to
    and coalesce(nullif(btrim(a.supplier_code), ''), '') = p_supplier
    and (p_companies is null or s.company_code = any(p_companies))
    and (p_reps is null or (s.company_code::text || ':' || coalesce(s.rep_code::text, 'sin')) = any(p_reps))
  group by s.month
  order by s.month;
$$;
revoke all on function public.sage_supplier_months(text, date, date, smallint[], text[]) from public, anon;
grant execute on function public.sage_supplier_months(text, date, date, smallint[], text[]) to authenticated, service_role;

-- Unir la venta por artículo con su ficha es lo que hacen las tres: que el
-- código de artículo esté indexado en la ficha evita recorrerla entera.
create index if not exists sage_articles_supplier_idx on public.sage_articles (supplier_code);
