-- Si el pedido ya se le ha pasado al proveedor.
--
-- En Sage hay una casilla «Pasado a proveedor» con dos valores, sí y no.
-- Mientras esté en «no», el proveedor no ha recibido el pedido, y el aviso
-- automático le estaba reclamando la fecha de algo que no le había llegado.
--
-- Queda en nulo mientras el agente de Sage no mande la columna, y entonces se
-- sigue reclamando como hasta ahora: dejar de reclamar por falta de un dato
-- sería peor que el problema que arregla. En cuanto el agente nuevo corra una
-- vez, la columna se llena sola.
--
-- Se puede volver a ejecutar sin romper nada.

alter table public.sage_purchase_orders
  add column if not exists sent_to_supplier boolean;

comment on column public.sage_purchase_orders.sent_to_supplier is
  'La casilla «Pasado a proveedor» de Sage. Nulo: no se sabe todavía, y entonces se reclama igual.';

/*
  Y que la lectura de Sage la guarde.

  Es la misma función de antes con la columna añadida en los tres sitios donde
  hace falta: la lista del insert, los tipos de jsonb_to_recordset y el update
  del conflicto. Lo demás —el distinct on que evita que una línea repetida
  tire la lectura entera— se queda igual.

  Un agente antiguo no manda el campo, y jsonb_to_recordset lo deja en nulo,
  que es justo lo que significa «no se sabe».
*/
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
                                      sent_to_supplier, status, net_amount, pending_amount, lines, pending_units, updated_at)
    select distinct on (x.company_code, x.year, coalesce(x.series, ''), x.number)
           x.company_code, x.year, coalesce(x.series, ''), x.number, x.order_date, x.supplier_code, x.expected_on,
           x.sent_to_supplier, x.status, x.net_amount, coalesce(x.pending_amount, 0), coalesce(x.lines, 0),
           coalesce(x.pending_units, 0), now()
    from jsonb_to_recordset(p->'purchase_orders') as x(company_code smallint, year smallint, series text, number integer,
         order_date date, supplier_code text, expected_on date, sent_to_supplier boolean, status smallint,
         net_amount numeric, pending_amount numeric, lines integer, pending_units numeric)
    on conflict (company_code, year, series, number) do update set
      order_date = excluded.order_date, supplier_code = excluded.supplier_code, expected_on = excluded.expected_on,
      sent_to_supplier = excluded.sent_to_supplier,
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
