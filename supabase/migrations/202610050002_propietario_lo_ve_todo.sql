-- El propietario ve y hace todo, sin tener que ir añadiéndolo a cada regla.
--
-- Cuando se creó el rol se dejó como un escudo puro: protegía la cuenta pero no
-- abría ninguna puerta, y quien lo tenía seguía dependiendo de su "admin". Eso
-- deja una trampa: el día que falte un rol o aparezca una pantalla nueva, el
-- dueño de la casa se queda fuera de su propia aplicación.
--
-- Se arregla en un solo sitio. Todas las reglas de la base preguntan por
-- current_user_has_any_role(), así que basta con que esa función diga que sí
-- cuando quien pregunta es el propietario. No hay que tocar las 182 políticas,
-- y lo que se añada mañana queda cubierto sin acordarse de nada.
--
-- Lo que esto NO abre: las credenciales marcadas como personales en el gestor
-- de contraseñas. Esa regla excluye lo personal por su cuenta, antes de mirar
-- ningún rol, así que sigue siendo privado incluso para el propietario. Es lo
-- correcto: "verlo todo" es la empresa, no la caja fuerte de cada uno.
--
-- Se puede volver a ejecutar sin romper nada.

create or replace function public.current_user_has_any_role(check_roles app_role[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    'owner' = any(public.current_user_roles())
    or public.current_user_roles() && check_roles,
    false
  );
$$;
