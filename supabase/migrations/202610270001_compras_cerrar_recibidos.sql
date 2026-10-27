-- Cerrar los pedidos de compra que ya se han recibido.
--
-- El agente lee de Sage los pedidos que tienen unidades pendientes. Cuando un
-- pedido se recibe entero, deja de salir en esa consulta — y como el Hub solo
-- sabe de lo que le llega, su fila se quedaba ahí con las unidades pendientes
-- de la última vez que lo vio. Para siempre.
--
-- Lo que eso provoca: el aviso automático le sigue reclamando al proveedor la
-- fecha de entrega de material que ya está en el almacén. En el momento de
-- escribir esto hay 93 pedidos así de 613.
--
-- Ahora el agente dice, al mandar el bloque entero, desde qué día ha mirado.
-- Lo que esté dentro de ese tramo y no venga en el envío es que ya no tiene
-- pendientes: se pone a cero. Fuera del tramo no se toca nada, que es lo que
-- impide que un envío corto cierre pedidos vivos de antes.
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
  v_desde date := nullif(p->>'purchase_orders_from', '')::date;
  v_entero boolean := coalesce((p->>'purchase_orders_replace')::boolean, false);
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

    /*
      Lo que ya no viene es que ya no tiene pendientes.

      Hace falta que el agente diga las dos cosas —que manda el bloque entero
      y desde qué día— para no cerrar nada por un envío a medias. Si falta
      cualquiera de ellas, esto no corre y todo se comporta como antes.
    */
    if v_entero and v_desde is not null then
      update sage_purchase_orders o
         set pending_units = 0, pending_amount = 0, updated_at = now()
       where o.pending_units > 0
         and o.order_date >= v_desde
         and not exists (
           select 1
           from jsonb_to_recordset(p->'purchase_orders') as y(company_code smallint, year smallint, series text, number integer)
           where y.company_code = o.company_code and y.year = o.year
             and coalesce(y.series, '') = o.series and y.number = o.number);
      get diagnostics v_n = row_count;
      if v_n > 0 then v_counts := v_counts || jsonb_build_object('purchase_orders_closed', v_n); end if;
    end if;
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

    -- Y las líneas de esos mismos pedidos, por lo mismo: una línea pendiente
    -- de un pedido cerrado es la que hace que la pantalla lo cuente como «sin
    -- fecha» aunque el pedido ya esté a cero.
    if v_entero and v_desde is not null then
      update sage_purchase_order_lines l
         set pending_units = 0, updated_at = now()
       where l.pending_units > 0
         and exists (select 1 from sage_purchase_orders o
                      where o.company_code = l.company_code and o.year = l.year
                        and o.series = l.series and o.number = l.number
                        and o.order_date >= v_desde and o.pending_units = 0);
      get diagnostics v_n = row_count;
      if v_n > 0 then v_counts := v_counts || jsonb_build_object('purchase_order_lines_closed', v_n); end if;
    end if;
  end if;

  return v_counts;
end;
$$;

revoke execute on function public.sage_ingest_purchases(jsonb) from public, anon, authenticated;
