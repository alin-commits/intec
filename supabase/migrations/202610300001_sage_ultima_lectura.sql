-- Cuándo se leyó Sage por última vez, para todo el Hub.
--
-- La tabla de lecturas la ven solo dirección y administración, y así se queda:
-- lo que guarda —qué se leyó, cuántas filas, los avisos del agente— es cosa
-- suya. Pero la hora de la última lectura le sirve a cualquiera que mire una
-- cifra del Hub, y sin esto contabilidad veía en Cobros «todavía no consta
-- ninguna lectura de Sage», porque no podía leer la tabla.
--
-- Devuelve solo esa hora: la de la última lectura que terminó bien. Quien no
-- tenga perfil activo recibe null.
create or replace function public.sage_ultima_lectura()
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(r.finished_at, r.started_at)
  from public.sage_sync_runs r
  where r.ok and public.current_user_roles() is not null
  order by r.started_at desc
  limit 1;
$$;

revoke execute on function public.sage_ultima_lectura() from public, anon;
grant execute on function public.sage_ultima_lectura() to authenticated;
