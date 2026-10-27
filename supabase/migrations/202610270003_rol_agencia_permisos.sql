-- Qué puede ver la agencia externa. Va después de 202610270002, no a la vez.
--
-- Lee las consultas y las ventas apuntadas de las unidades que se le asignen,
-- igual que un comercial, y ahí se acaba. No hace falta tocar ninguna política
-- de escritura: las de inquiries y sales_entries ya exigen ser 'admin' o
-- 'commercial' para insertar, actualizar o borrar, así que un rol que no es
-- ninguno de los dos no puede escribir aunque alguien se lo pida desde fuera
-- de la pantalla.
--
-- Por qué va por unidades y no de golpe: la agencia lleva la captación de una
-- parte del negocio, y el día que lleve otra se le añade la unidad. Si no se
-- le asigna ninguna, no ve nada — que es el estado seguro para una cuenta de
-- fuera de la casa.
--
-- Esta función la usan SOLO las políticas de lectura y actualización de
-- inquiries y sales_entries, así que añadir aquí el rol no le abre ninguna
-- otra tabla. Comprobado antes de escribir esto.
--
-- Se puede volver a ejecutar sin romper nada.

create or replace function public.current_user_can_access_unit(unit_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.current_user_has_any_role(ARRAY['admin','viewer']::app_role[])
    or (
      public.current_user_has_any_role(ARRAY['commercial']::app_role[])
      and unit_id = any(public.current_user_business_units())
    )
    or (
      public.current_user_has_any_role(ARRAY['direction']::app_role[])
      and not public.current_user_has_any_role(ARRAY['commercial']::app_role[])
    )
    or (
      public.current_user_has_any_role(ARRAY['agency']::app_role[])
      and unit_id = any(public.current_user_business_units())
    );
$$;

revoke execute on function public.current_user_can_access_unit(uuid) from public, anon;
