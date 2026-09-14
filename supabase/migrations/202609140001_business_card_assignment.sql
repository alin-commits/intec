-- Varias tarjetas por empleado: cada business_card puede asignarse a un
-- usuario, que la ve en su propia pestaña Tarjetas (aunque no tenga rol de
-- gestión) pero no puede editarla ni borrarla — eso sigue siendo cosa de
-- admin/marketing/it vía las políticas business_cards_staff_* existentes.
-- No hace falta tocar la política de lectura (business_cards_public_select
-- ya cubre a "authenticated"); el filtrado "solo las mías" se hace en cliente.

alter table public.business_cards
  add column assigned_user_id uuid references public.profiles(id) on delete set null;

create index business_cards_assigned_user_idx on public.business_cards(assigned_user_id);

-- Preferencia personal: qué tarjeta marca cada usuario como "la que usa".
-- Tabla aparte (no una columna en business_cards) para no tener que dar a
-- un empleado permiso de UPDATE sobre la fila de la tarjeta en sí — solo
-- puede tocar su propia fila de preferencia.
create table public.business_card_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  card_id uuid not null references public.business_cards(id) on delete cascade
);

alter table public.business_card_preferences enable row level security;

create policy business_card_preferences_self_select on public.business_card_preferences
for select to authenticated using (user_id = (select auth.uid()));

create policy business_card_preferences_self_insert on public.business_card_preferences
for insert to authenticated with check (user_id = (select auth.uid()));

create policy business_card_preferences_self_update on public.business_card_preferences
for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy business_card_preferences_self_delete on public.business_card_preferences
for delete to authenticated using (user_id = (select auth.uid()));
