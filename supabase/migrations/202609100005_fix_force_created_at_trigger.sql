-- Bug real y activo: la migración 202608180001 reescribió (create or
-- replace) la función compartida public.force_created_at() para comprobar
-- new.entry_mode, pensando solo en la tabla inquiries. Pero esa misma
-- función también está enganchada como trigger BEFORE INSERT en
-- business_units, leads y campaigns, ninguna de las cuales tiene columna
-- entry_mode. Desde que se aplicó esa migración, cualquier intento de
-- crear una unidad de negocio, un lead o una campaña falla con:
--   ERROR 42703: record "new" has no field "entry_mode"
-- Confirmado contra producción: no hay ningún lead ni ninguna unidad de
-- negocio creados después del 17 de agosto.
--
-- Arreglo: separar la lógica. force_created_at() (con el chequeo de
-- entry_mode) se queda solo para inquiries; business_units/leads/campaigns
-- vuelven a su comportamiento original (forzar siempre created_at = now(),
-- sin mirar entry_mode) mediante una función nueva.

create or replace function public.force_created_at_always()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  new.created_at = now();
  return new;
end;
$$;

drop trigger if exists business_units_force_created_at on public.business_units;
create trigger business_units_force_created_at before insert on public.business_units
for each row execute function public.force_created_at_always();

drop trigger if exists leads_force_created_at on public.leads;
create trigger leads_force_created_at before insert on public.leads
for each row execute function public.force_created_at_always();

drop trigger if exists campaigns_force_created_at on public.campaigns;
create trigger campaigns_force_created_at before insert on public.campaigns
for each row execute function public.force_created_at_always();
