-- Dos arreglos de seguridad urgentes.
--
-- 1. Darse de alta uno mismo no da acceso a nada.
--    El alta pública de Supabase estaba abierta y cada cuenta nueva nacía
--    activa con el rol "solo lectura": cualquiera con un correo podía entrar,
--    leer leads, consultas y ventas, y abrir las contraseñas compartidas.
--    Ahora una cuenta nueva nace desactivada. La invitación de Usuarios ya la
--    activa a mano con sus roles (api/users/invite), así que invitar sigue
--    igual. Los permisos de la base solo cuentan cuentas activas
--    (current_user_roles), y Contraseñas también lo exige.
--    Además conviene desactivar el alta pública en Supabase → Authentication →
--    Sign In / Providers → Email → "Allow new users to sign up".
--
-- 2. Solo un administrador de Contraseñas da o quita los roles de Contraseñas.
--    Un administrador de la aplicación podía ponerle "vault_admin" a una cuenta
--    suya llamando directamente a la base (la pantalla de Usuarios no lo
--    ofrece, pero la base lo dejaba) y llegar a todas las credenciales. Ahora
--    la base lo impide: cambiar quién tiene "vault_admin" o "employee" exige ser
--    administrador de Contraseñas, o la clave de servicio, que es la que usa la
--    pantalla de accesos de Contraseñas (api/vault/access).

alter table public.profiles alter column is_active set default false;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into public.profiles (id, full_name, email, is_active)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
    new.email,
    false
  )
  on conflict (id) do update
  set full_name = excluded.full_name,
      email = excluded.email;
  return new;
end;
$$;

create or replace function public.protect_vault_roles()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  -- Sin usuario detrás es la clave de servicio o el mantenimiento de la base.
  if auth.uid() is null then
    return new;
  end if;
  if (
      ('vault_admin' = any(new.roles)) is distinct from ('vault_admin' = any(old.roles))
      or ('employee' = any(new.roles)) is distinct from ('employee' = any(old.roles))
    )
    and not public.current_user_has_any_role(array['vault_admin']::app_role[]) then
    raise exception 'Solo un administrador de Contraseñas puede dar o quitar los roles de Contraseñas.';
  end if;
  return new;
end;
$$;
revoke all on function public.protect_vault_roles() from public, anon, authenticated;

drop trigger if exists profiles_protect_vault_roles on public.profiles;
create trigger profiles_protect_vault_roles
  before update of roles on public.profiles
  for each row execute function public.protect_vault_roles();

-- De paso: las funciones de disparador que protegen al propietario no tienen
-- por qué poder llamarse desde la API.
revoke execute on function public.protect_owner() from public, anon, authenticated;
revoke execute on function public.protect_owner_delete() from public, anon, authenticated;
