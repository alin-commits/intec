-- Que una línea repetida no tire la lectura entera.
--
-- La primera lectura con compras falló así:
--
--   ON CONFLICT DO UPDATE command cannot affect row a second time
--
-- Es lo que dice Postgres cuando un mismo INSERT trae dos filas con la misma
-- clave: no sabe cuál debe ganar y aborta. Venía de que el número de línea se
-- copiaba de una columna de Sage que en esta instalación no existe (o repite),
-- así que todas las líneas del pedido llegaban con el mismo número.
--
-- El agente ya numera las líneas él mismo, pero esto no puede depender solo de
-- que quien manda los datos se porte bien: lo que llegue repetido se queda con
-- una fila y se sigue. Perder una línea duplicada es mucho menos malo que
-- perder toda la lectura de la noche, que es lo que pasó.
--
-- Se puede volver a ejecutar sin romper nada.

create or replace function public.sage_ingest_purchases(p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_counts jsonb := '{}'::jsonb;
  v_n integer;
begin
  perform pg_advisory_xact_lock(hashtext('public.sage_ingest'));

  if jsonb_typeof(p->'purchase_orders') = 'array' then
    insert into sage_purchase_orders (company_code, year, series, number, order_date, supplier_code, expected_on,
                                      status, net_amount, pending_amount, lines, pending_units, updated_at)
    select distinct on (x.company_code, x.year, coalesce(x.series, ''), x.number)
           x.company_code, x.year, coalesce(x.series, ''), x.number, x.order_date, x.supplier_code, x.expected_on,
           x.status, x.net_amount, coalesce(x.pending_amount, 0), coalesce(x.lines, 0), coalesce(x.pending_units, 0), now()
    from jsonb_to_recordset(p->'purchase_orders') as x(company_code smallint, year smallint, series text, number integer,
         order_date date, supplier_code text, expected_on date, status smallint, net_amount numeric,
         pending_amount numeric, lines integer, pending_units numeric)
    on conflict (company_code, year, series, number) do update set
      order_date = excluded.order_date, supplier_code = excluded.supplier_code, expected_on = excluded.expected_on,
      status = excluded.status, net_amount = excluded.net_amount, pending_amount = excluded.pending_amount,
      lines = excluded.lines, pending_units = excluded.pending_units, updated_at = now();
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('purchase_orders', v_n);
  end if;

  if jsonb_typeof(p->'purchase_order_lines') = 'array' then
    insert into sage_purchase_order_lines (company_code, year, series, number, line_number, article_code, description,
                                           quantity, pending_units, expected_on, net_amount, updated_at)
    select distinct on (x.company_code, x.year, coalesce(x.series, ''), x.number, x.line_number)
           x.company_code, x.year, coalesce(x.series, ''), x.number, x.line_number, x.article_code,
           coalesce(x.description, ''), coalesce(x.quantity, 0), coalesce(x.pending_units, 0), x.expected_on,
           coalesce(x.net_amount, 0), now()
    from jsonb_to_recordset(p->'purchase_order_lines') as x(company_code smallint, year smallint, series text,
         number integer, line_number integer, article_code text, description text, quantity numeric,
         pending_units numeric, expected_on date, net_amount numeric)
    on conflict (company_code, year, series, number, line_number) do update set
      article_code = excluded.article_code, description = excluded.description, quantity = excluded.quantity,
      pending_units = excluded.pending_units, expected_on = excluded.expected_on,
      net_amount = excluded.net_amount, updated_at = now();
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('purchase_order_lines', v_n);
  end if;

  return v_counts;
end;
$$;

revoke execute on function public.sage_ingest_purchases(jsonb) from public, anon, authenticated;
grant execute on function public.sage_ingest_purchases(jsonb) to service_role;
