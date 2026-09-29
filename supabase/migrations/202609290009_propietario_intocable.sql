-- El rol de propietario, segunda parte: que no se le pueda tocar.
--
-- Hasta ahora, cualquier administrador podía quitarle el rol a otro
-- administrador, desactivarle la cuenta o borrársela. La única barrera era
-- contra uno mismo. Es decir: quien tuviera admin podía echar del sistema a
-- quien se lo dio.
--
-- Con esto hay una ficha intocable. El propietario conserva todo lo que hace
-- como admin —esto no le quita ni le da un solo permiso— pero:
--
--   · nadie puede cambiarle los roles, desactivarle ni borrarle;
--   · el rol de propietario solo lo reparte otro propietario;
--   · él sí puede seguir haciendo todo eso con cualquier administrador.
--
-- La clave de servicio (la que usa el servidor, y el editor SQL de Supabase)
-- queda fuera de la regla a propósito. Quien tiene esa clave ya es dueño de la
-- base entera: fingir lo contrario sería teatro, y además es la única forma de
-- deshacer esto si algún día hace falta. Por eso el borrado de usuarios, que va
-- por esa clave, se para además en la aplicación.
--
-- Se puede volver a ejecutar entera sin romper nada.

create or replace function public.protect_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  quien uuid := auth.uid();
begin
  -- Sin sesión es la clave de servicio: se deja pasar (ver la nota de arriba).
  if quien is null then
    return new;
  end if;

  if 'owner' = any(old.roles) and quien is distinct from old.id then
    raise exception 'La cuenta del propietario no la puede modificar nadie más.';
  end if;

  -- Dar o quitar el rol de propietario es cosa del propietario.
  if ('owner' = any(new.roles)) is distinct from ('owner' = any(old.roles))
     and not public.current_user_has_any_role(ARRAY['owner']::app_role[]) then
    raise exception 'Solo el propietario puede dar o quitar el rol de propietario.';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_protect_owner on public.profiles;
create trigger profiles_protect_owner before update on public.profiles
for each row execute function public.protect_owner();

create or replace function public.protect_owner_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and 'owner' = any(old.roles) then
    raise exception 'La cuenta del propietario no se puede borrar.';
  end if;
  return old;
end;
$$;

drop trigger if exists profiles_protect_owner_delete on public.profiles;
create trigger profiles_protect_owner_delete before delete on public.profiles
for each row execute function public.protect_owner_delete();
