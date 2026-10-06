-- Las tarjetas desactivadas también se ven desde administración.
--
-- business_cards solo tenía una regla de lectura, la pública: `is_active =
-- true`. La pantalla de tarjetas lee por esa misma regla, así que al poner una
-- tarjeta en "Inactiva" desaparecía de la lista y no quedaba manera de volver a
-- activarla desde la aplicación —aunque la propia pantalla pinta una insignia
-- "Inactiva" que nadie podía llegar a ver nunca.
--
-- De paso arregla otra cosa: cuando la respuesta a un guardado no trae la fila,
-- la pantalla no puede distinguir "guardado" de "la base no me ha dejado". Con
-- esta regla, quien gestiona las tarjetas siempre recibe la fila de vuelta.
--
-- La regla pública se queda igual: quien entra sin cuenta sigue viendo solo las
-- activas. Las políticas se suman, no se restan.
--
-- Se puede volver a ejecutar sin romper nada.

drop policy if exists business_cards_staff_select on public.business_cards;
create policy business_cards_staff_select on public.business_cards
for select to authenticated
  using ((select public.current_user_has_any_role(ARRAY['admin', 'marketing', 'it']::app_role[])));

comment on policy business_cards_staff_select on public.business_cards is
  'Quien gestiona las tarjetas ve también las desactivadas; la regla pública solo deja ver las activas.';
