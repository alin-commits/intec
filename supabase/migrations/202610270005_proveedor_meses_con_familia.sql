-- El gráfico mes a mes de un proveedor, respetando la familia marcada.
--
-- La tabla de proveedores filtra por familia y subfamilia, y su gráfico no:
-- enseñaba la venta del proveedor entero debajo de una fila que decía otra
-- cosa. Dos cifras distintas para lo mismo, en la misma pantalla.
--
-- La versión anterior se borra antes de crear la nueva: añadir parámetros
-- crea otra sobrecarga, y con dos conviviendo PostgREST no sabe a cuál llamar
-- y devuelve 300 en vez de datos.
--
-- Se puede volver a ejecutar sin romper nada.

drop function if exists public.sage_supplier_months(text, date, date, smallint[], text[]);

create or replace function public.sage_supplier_months(p_supplier text, p_from date, p_to date,
  p_companies smallint[] default null, p_reps text[] default null,
  p_families text[] default null, p_subfamilies text[] default null)
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
    and (p_families is null or s.family_code = any(p_families))
    and (p_subfamilies is null or (s.family_code || ':' || s.subfamily_code) = any(p_subfamilies))
  group by s.month
  order by s.month;
$$;
revoke all on function public.sage_supplier_months(text, date, date, smallint[], text[], text[], text[]) from public, anon;
grant execute on function public.sage_supplier_months(text, date, date, smallint[], text[], text[], text[]) to authenticated, service_role;
