-- Cuentas de prueba: una por rol, para mirar la aplicación con los ojos de cada
-- uno sin pedirle a nadie su contraseña.
--
-- Son cuentas de verdad, con permisos de verdad: es justo lo que se quiere ver
-- —qué menú le sale a un comercial, qué datos carga, dónde le dice que no—,
-- pero significa que hay que tratarlas con cuidado. De ahí esta marca:
--
--   · La ruta que entrega su sesión (solo para dueño o admin) filtra por ella:
--     por diseño no puede devolver la sesión de una persona real.
--   · Las listas de personas las esconden, para que nadie reparta un lead o un
--     ticket a "Comercial de pruebas" ni le lleguen los correos del cron.
--
-- No se marcan como inactivas, que sería lo cómodo, porque current_user_has_any_role()
-- solo mira los roles de las cuentas activas: una cuenta de prueba inactiva no
-- vería nada y la prueba no valdría para nada.
--
-- Se puede volver a ejecutar sin romper nada.

alter table public.profiles add column if not exists is_preview boolean not null default false;

comment on column public.profiles.is_preview is
  'Cuenta de prueba para ver la aplicación como un rol. Se esconde de los listados de personas y es la única que la ruta de cambio de cuenta puede entregar.';

create index if not exists profiles_preview_idx on public.profiles (is_preview) where is_preview;

-- El selector de destinatarios de los avisos internos sale de aquí: si no se
-- filtran, se puede mandar un comunicado a "Comercial de pruebas".
create or replace function public.list_team_members()
returns table (id uuid, full_name text, roles app_role[])
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.full_name, p.roles
  from public.profiles p
  where p.is_active and not p.is_preview and public.current_user_roles() is not null
  order by p.full_name;
$$;
revoke execute on function public.list_team_members() from public, anon;
grant execute on function public.list_team_members() to authenticated;
