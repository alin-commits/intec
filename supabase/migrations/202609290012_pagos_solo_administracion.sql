-- Pagos es de Administración, no de Dirección.
--
-- Las remesas de confirming, la tesorería y los contratos con los bancos los
-- llevan Administración (el departamento, rol 'accounting') y quien administra
-- la plataforma ('admin', y el propietario). Dirección no entra: hay IBAN de
-- proveedores y ficheros de pago, y no es su trabajo.
--
-- Además, Administración necesita leer de Sage lo justo para usar Pagos:
--   - el nombre de las sociedades;
--   - el nombre de los clientes (la tesorería dice quién tiene que pagar);
--   - pedir una lectura con el botón "Actualizar desde Sage" y ver cómo va.
-- No ve ventas, márgenes ni el resto del cuadro de mando.

do $$
declare
  t text;
begin
  foreach t in array array['sage_company_details', 'sage_suppliers', 'sage_payment_remittances',
                           'sage_payment_remittance_items', 'sage_open_items', 'payment_bank_settings', 'payment_files']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select public.current_user_has_any_role(ARRAY[''admin'',''owner'',''accounting'']::app_role[])))',
      t || '_read', t);
  end loop;
end $$;

drop policy if exists payment_bank_settings_write on public.payment_bank_settings;
create policy payment_bank_settings_write on public.payment_bank_settings
for all to authenticated
  using ((select public.current_user_has_any_role(ARRAY['admin','owner','accounting']::app_role[])))
  with check ((select public.current_user_has_any_role(ARRAY['admin','owner','accounting']::app_role[])));

drop policy if exists payment_files_insert on public.payment_files;
create policy payment_files_insert on public.payment_files
for insert to authenticated
  with check ((select public.current_user_has_any_role(ARRAY['admin','owner','accounting']::app_role[])) and generated_by = auth.uid());

-- Lo que Administración necesita de Sage para usar Pagos.
drop policy if exists sage_companies_read on public.sage_companies;
create policy sage_companies_read on public.sage_companies
for select to authenticated
  using ((select public.current_user_has_any_role(ARRAY['admin','direction','accounting']::app_role[])));

drop policy if exists sage_customers_read on public.sage_customers;
create policy sage_customers_read on public.sage_customers
for select to authenticated
  using ((select public.current_user_has_any_role(ARRAY['admin','direction','accounting']::app_role[])));

drop policy if exists sage_refresh_requests_read on public.sage_refresh_requests;
create policy sage_refresh_requests_read on public.sage_refresh_requests
for select to authenticated
  using ((select public.current_user_has_any_role(ARRAY['admin','direction','accounting']::app_role[])));

drop policy if exists sage_refresh_requests_insert on public.sage_refresh_requests;
create policy sage_refresh_requests_insert on public.sage_refresh_requests
for insert to authenticated
  with check ((select public.current_user_has_any_role(ARRAY['admin','direction','accounting']::app_role[]))
              and requested_by = (select auth.uid()) and status = 'pendiente');

drop policy if exists sage_agent_status_read on public.sage_agent_status;
create policy sage_agent_status_read on public.sage_agent_status
for select to authenticated
  using ((select public.current_user_has_any_role(ARRAY['admin','direction','accounting']::app_role[])));
