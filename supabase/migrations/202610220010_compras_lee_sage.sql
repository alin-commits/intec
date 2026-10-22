-- Compras también puede pedir una lectura de Sage.
--
-- La pantalla de Compras vive de lo que trae el agente: los pedidos a
-- proveedor, sus líneas y lo que falta por llegar. Cuando alguien acaba de
-- meter un pedido en Sage y quiere verlo aquí, hasta ahora tenía que esperar a
-- la lectura programada o pedírselo a alguien de dirección.
--
-- El botón ya existía; lo que faltaba era que las reglas de la base dejaran
-- entrar al rol de compras. Sigue habiendo un tope de una lectura por hora
-- para toda la casa, que es lo que protege al servidor de la oficina: esto no
-- añade lecturas, solo deja pedirlas a quien le hacen falta.
--
-- Se puede volver a ejecutar sin romper nada.

drop policy if exists sage_refresh_requests_read on public.sage_refresh_requests;
create policy sage_refresh_requests_read on public.sage_refresh_requests
for select to authenticated
  using ((select public.current_user_has_any_role(ARRAY['admin','direction','accounting','purchasing']::app_role[])));

drop policy if exists sage_refresh_requests_insert on public.sage_refresh_requests;
create policy sage_refresh_requests_insert on public.sage_refresh_requests
for insert to authenticated
  with check ((select public.current_user_has_any_role(ARRAY['admin','direction','accounting','purchasing']::app_role[]))
              and requested_by = (select auth.uid()) and status = 'pendiente');

-- Para saber si el servidor de Sage sigue preguntando: sin esto el botón no
-- puede distinguir «va a tardar un poco» de «la tarea del servidor está parada».
drop policy if exists sage_agent_status_read on public.sage_agent_status;
create policy sage_agent_status_read on public.sage_agent_status
for select to authenticated
  using ((select public.current_user_has_any_role(ARRAY['admin','direction','accounting','purchasing']::app_role[])));
