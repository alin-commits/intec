-- Fase de seguridad (revisión de Fase 2/9): cierra dos huecos que las
-- políticas RLS existentes no cubrían.
--
-- 1) Fechas automáticas: `created_at` solo tenía `default now()`, que
--    Postgres ignora en cuanto el cliente incluye el campo explícitamente
--    en el insert. `updated_at` ya estaba protegido con un trigger; ahora
--    `created_at` recibe el mismo tratamiento en inquiries, leads,
--    campaigns y business_units.
--
-- 2) Auto-promoción de rol: la política `profiles_update_admin` permite
--    a cualquier administrador actualizar cualquier fila de `profiles`,
--    incluida la suya propia. Un trigger impide que un usuario cambie su
--    propio `role` o `is_active`, aunque sea admin; los cambios sobre
--    OTROS usuarios siguen funcionando igual.
--
-- Migración puramente aditiva: no modifica tablas ni políticas existentes.

create or replace function public.force_created_at()
returns trigger
language plpgsql
as $$
begin
  new.created_at = now();
  return new;
end;
$$;

create trigger inquiries_force_created_at before insert on public.inquiries
for each row execute function public.force_created_at();
create trigger leads_force_created_at before insert on public.leads
for each row execute function public.force_created_at();
create trigger campaigns_force_created_at before insert on public.campaigns
for each row execute function public.force_created_at();
create trigger business_units_force_created_at before insert on public.business_units
for each row execute function public.force_created_at();

create or replace function public.prevent_self_role_change()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() = old.id and (new.role is distinct from old.role or new.is_active is distinct from old.is_active) then
    raise exception 'No puedes cambiar tu propio rol o tu propio estado de activación.';
  end if;
  return new;
end;
$$;

create trigger profiles_prevent_self_role_change before update on public.profiles
for each row execute function public.prevent_self_role_change();
