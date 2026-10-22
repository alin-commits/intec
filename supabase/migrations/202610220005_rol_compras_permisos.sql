-- Qué puede ver el rol de compras.
--
-- Va después de 202610220004_rol_compras.sql, que es la que crea el valor del
-- enum: aquí ya se usa, y Postgres no deja hacer las dos cosas en la misma
-- transacción.
--
-- De paso se arregla algo que estaba mal desde que se montó la pantalla:
-- `sage_suppliers` solo lo podían leer admin, owner y contabilidad. Dirección
-- tenía acceso a Compras pero no a los proveedores, así que veía códigos en
-- vez de nombres y sin correo — con lo cual el botón de reclamar le salía
-- desactivado en todas las filas. Se arregla junto con esto porque es la misma
-- lista.
--
-- Se puede volver a ejecutar sin romper nada.

-- ---------- Las tablas de compras ----------

do $$
declare
  t text;
begin
  foreach t in array array['sage_purchase_orders', 'sage_purchase_order_lines',
                           'purchase_order_tracking', 'purchase_order_chases', 'purchase_order_replies']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select public.current_user_has_any_role(ARRAY[''admin'',''direction'',''purchasing'']::app_role[])))',
      t || '_read', t);
  end loop;
end $$;

-- El seguimiento sí se toca desde la pantalla: aceptar una fecha, apuntar que
-- han contestado, pausar un pedido.
drop policy if exists purchase_order_tracking_write on public.purchase_order_tracking;
create policy purchase_order_tracking_write on public.purchase_order_tracking
  for all to authenticated
  using ((select public.current_user_has_any_role(array['admin', 'direction', 'purchasing']::app_role[])))
  with check ((select public.current_user_has_any_role(array['admin', 'direction', 'purchasing']::app_role[])));

-- ---------- Los proveedores ----------
-- Compras necesita el nombre y el correo del proveedor: sin eso la pantalla
-- enseña códigos y no se le puede escribir a nadie. Dirección estaba fuera por
-- un descuido y entra aquí también.

drop policy if exists sage_suppliers_read on public.sage_suppliers;
create policy sage_suppliers_read on public.sage_suppliers
  for select to authenticated
  using ((select public.current_user_has_any_role(array['admin', 'owner', 'accounting', 'direction', 'purchasing']::app_role[])));

-- ---------- Las sociedades ----------
-- Para poner el nombre de la empresa en el correo que se le manda al proveedor.

drop policy if exists sage_companies_read on public.sage_companies;
create policy sage_companies_read on public.sage_companies
  for select to authenticated
  using ((select public.current_user_has_any_role(array['admin', 'direction', 'accounting', 'purchasing']::app_role[])));
