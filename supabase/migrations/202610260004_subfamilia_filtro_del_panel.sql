-- La subfamilia, como filtro del panel y no como apaño de una pantalla.
--
-- Hasta ahora marcar una subfamilia solo recortaba la tabla de artículos, y
-- lo hacía con p_subfamily: una sola, y por código suelto. El código de
-- subfamilia se repite entre familias —en Sage son correlativos dentro de
-- cada una—, así que un código suelto puede arrastrar artículos de otra
-- familia en cuanto no haya familia marcada.
--
-- Pasa a ser p_subfamilies, una lista, y cada elemento es la pareja
-- «familia:subfamilia» («11:003»). Es lo mismo que ya se hace con el
-- comercial, que viaja como «sociedad:comercial» por la misma razón.
--
-- p_subfamily se queda donde está por si alguien lo llama desde fuera del
-- panel; los dos se pueden mandar a la vez y suman.
--
-- Las dos funciones se borran antes de crearse. No es por limpieza: añadir un
-- parámetro crea una sobrecarga nueva, y con dos versiones conviviendo
-- PostgREST no sabe a cuál llamar y devuelve 300 (PGRST203) en vez de datos.
-- Ya pasó con p_reps y dejó las subfamilias, las marcas y los artículos
-- vacíos durante días.
--
-- Se puede volver a ejecutar sin romper nada.

drop function if exists public.sage_article_groups(text, date, date, smallint[], text[], date, text[], text[]);
drop function if exists public.sage_article_summary(date, date, smallint[], text[], text, text, integer, date, text[], text[]);

/*
  Los artículos más vendidos, con la subfamilia y la marca que se estén
  mirando.
*/
create or replace function public.sage_article_summary(p_from date, p_to date, p_companies smallint[] default null, p_families text[] default null,
  p_subfamily text default null, p_brand text default null, p_limit integer default 50, p_cost_from date default '2025-11-01',
  p_months text[] default null, p_reps text[] default null, p_subfamilies text[] default null)
returns table(article_code text, name text, brand text, family_code text, subfamily_code text, units numeric, documents bigint,
  net_amount numeric, trusted_net numeric, trusted_cost numeric, trusted_without_cost numeric, gross_amount numeric, gross_net numeric)
language sql
stable
set search_path = public
as $$
  select s.article_code, max(a.name), max(a.brand), s.family_code, max(s.subfamily_code),
    sum(s.units), sum(s.documents)::bigint, sum(s.net_amount),
    coalesce(sum(s.net_amount) filter (where s.month >= date_trunc('month', p_cost_from)), 0),
    coalesce(sum(s.cost_amount) filter (where s.month >= date_trunc('month', p_cost_from)), 0),
    coalesce(sum(s.net_without_cost) filter (where s.month >= date_trunc('month', p_cost_from)), 0),
    coalesce(sum(s.gross_amount), 0),
    coalesce(sum(s.net_amount) filter (where s.gross_amount is not null), 0)
  from sage_article_sales_monthly s
  left join sage_articles a on a.company_code = s.company_code and a.code = s.article_code
  where s.month between date_trunc('month', p_from)::date and p_to
    and (p_months is null or to_char(s.month, 'YYYY-MM') = any(p_months))
    and (p_companies is null or s.company_code = any(p_companies))
    and (p_reps is null or (s.company_code::text || ':' || coalesce(s.rep_code::text, 'sin')) = any(p_reps))
    and (p_families is null or s.family_code = any(p_families))
    and (p_subfamily is null or s.subfamily_code = p_subfamily)
    and (p_subfamilies is null or (s.family_code || ':' || s.subfamily_code) = any(p_subfamilies))
    and (p_brand is null or coalesce(a.brand, '') = p_brand)
  group by s.article_code, s.family_code
  order by sum(s.net_amount) desc
  limit greatest(p_limit, 1);
$$;
revoke all on function public.sage_article_summary(date, date, smallint[], text[], text, text, integer, date, text[], text[], text[]) from public, anon;
grant execute on function public.sage_article_summary(date, date, smallint[], text[], text, text, integer, date, text[], text[], text[]) to authenticated, service_role;

/*
  La venta por subfamilia o por marca.

  La subfamilia marcada no recorta la lista de subfamilias: esa tabla es de
  donde se elige, y filtrada por sí misma dejaría una sola fila y ninguna
  manera de cambiar. En las marcas sí entra, que es el sentido de marcarla.
*/
create or replace function public.sage_article_groups(p_group text, p_from date, p_to date, p_companies smallint[] default null,
  p_families text[] default null, p_cost_from date default '2025-11-01', p_months text[] default null,
  p_reps text[] default null, p_subfamilies text[] default null)
returns table(code text, family_code text, name text, articles bigint, net_amount numeric, trusted_net numeric, trusted_cost numeric,
  trusted_without_cost numeric, gross_amount numeric, gross_net numeric)
language sql
stable
set search_path = public
as $$
  with filas as (
    select s.*,
      case when p_group = 'marca' then coalesce(nullif(a.brand, ''), '') else s.subfamily_code end as grupo,
      -- La misma subfamilia puede repetir código en familias distintas: van aparte.
      case when p_group = 'marca' then '' else s.family_code end as grupo_familia
    from sage_article_sales_monthly s
    left join sage_articles a on a.company_code = s.company_code and a.code = s.article_code
    where s.month between date_trunc('month', p_from)::date and p_to
      and (p_months is null or to_char(s.month, 'YYYY-MM') = any(p_months))
      and (p_companies is null or s.company_code = any(p_companies))
      and (p_reps is null or (s.company_code::text || ':' || coalesce(s.rep_code::text, 'sin')) = any(p_reps))
      and (p_families is null or s.family_code = any(p_families))
      and (p_subfamilies is null or p_group = 'subfamilia'
           or (s.family_code || ':' || s.subfamily_code) = any(p_subfamilies))
  ),
  grupos as (
    select f.grupo, f.grupo_familia,
      count(distinct f.article_code) as articulos,
      sum(f.net_amount) as neto,
      coalesce(sum(f.net_amount) filter (where f.month >= date_trunc('month', p_cost_from)), 0) as neto_fiable,
      coalesce(sum(f.cost_amount) filter (where f.month >= date_trunc('month', p_cost_from)), 0) as coste_fiable,
      coalesce(sum(f.net_without_cost) filter (where f.month >= date_trunc('month', p_cost_from)), 0) as sin_coste_fiable,
      coalesce(sum(f.gross_amount), 0) as bruto,
      coalesce(sum(f.net_amount) filter (where f.gross_amount is not null), 0) as neto_con_bruto
    from filas f
    group by f.grupo, f.grupo_familia
  )
  select g.grupo, g.grupo_familia,
    case when p_group = 'marca' then nullif(g.grupo, '')
         else (select max(sf.name) from sage_subfamilies sf where sf.code = g.grupo and sf.family_code = g.grupo_familia) end,
    g.articulos, g.neto, g.neto_fiable, g.coste_fiable, g.sin_coste_fiable, g.bruto, g.neto_con_bruto
  from grupos g
  order by g.neto desc;
$$;
revoke all on function public.sage_article_groups(text, date, date, smallint[], text[], date, text[], text[], text[]) from public, anon;
grant execute on function public.sage_article_groups(text, date, date, smallint[], text[], date, text[], text[], text[]) to authenticated, service_role;

/*
  La venta mes a mes de unas subfamilias.

  El gráfico de evolución de la pantalla de productos se saca de
  sage_family_sales_daily, que es por familia y no sabe de subfamilias. Esta
  devuelve lo mismo para lo que hay marcado, desde el reparto por artículo,
  que sí la tiene. Es mensual porque esa tabla lo es, y el gráfico también.
*/
create or replace function public.sage_subfamily_months(p_subfamilies text[], p_from date, p_to date,
  p_companies smallint[] default null, p_reps text[] default null)
returns table(month date, net_amount numeric)
language sql
stable
set search_path = public
as $$
  select s.month, sum(s.net_amount)
  from sage_article_sales_monthly s
  where s.month between date_trunc('month', p_from)::date and p_to
    and (p_companies is null or s.company_code = any(p_companies))
    and (p_reps is null or (s.company_code::text || ':' || coalesce(s.rep_code::text, 'sin')) = any(p_reps))
    and (s.family_code || ':' || s.subfamily_code) = any(p_subfamilies)
  group by s.month
  order by s.month;
$$;
revoke all on function public.sage_subfamily_months(text[], date, date, smallint[], text[]) from public, anon;
grant execute on function public.sage_subfamily_months(text[], date, date, smallint[], text[]) to authenticated, service_role;
