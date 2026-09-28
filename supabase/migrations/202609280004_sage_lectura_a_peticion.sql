-- "Actualizar desde Sage": leer Sage en el momento, además de las lecturas programadas.
--
-- El Hub está en internet y Sage en el servidor de la oficina: el Hub no puede
-- entrar en ese servidor. Así que el botón deja una petición aquí y el agente,
-- que cada minuto pregunta si hay alguna, la recoge, lee Sage y avisa al
-- terminar. Nada de abrir puertos en la oficina.
--
-- Solo puede haber una petición en marcha a la vez: si alguien pulsa mientras
-- otra espera o se está leyendo, se le enseña esa.

create table if not exists public.sage_refresh_requests (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid references public.profiles(id) on delete set null default auth.uid(),
  requested_at timestamptz not null default now(),
  days integer not null default 2 check (days between 1 and 90),
  status text not null default 'pendiente' check (status in ('pendiente', 'leyendo', 'hecho', 'error', 'caducada')),
  started_at timestamptz,
  finished_at timestamptz,
  message text
);
create index if not exists sage_refresh_requests_requested_idx on public.sage_refresh_requests (requested_at desc);
create unique index if not exists sage_refresh_requests_una_activa_idx
  on public.sage_refresh_requests ((true)) where status in ('pendiente', 'leyendo');

-- Cuándo preguntó el agente por última vez: si deja de preguntar, el botón lo
-- dice en vez de quedarse esperando para siempre.
create table if not exists public.sage_agent_status (
  id smallint primary key default 1 check (id = 1),
  last_poll_at timestamptz
);

alter table public.sage_refresh_requests enable row level security;
alter table public.sage_agent_status enable row level security;

drop policy if exists sage_refresh_requests_read on public.sage_refresh_requests;
create policy sage_refresh_requests_read on public.sage_refresh_requests
for select to authenticated
  using ((select public.current_user_has_any_role(ARRAY['admin','direction']::app_role[])));

-- Pedir una lectura: dirección y administración, a su nombre y siempre como pendiente.
drop policy if exists sage_refresh_requests_insert on public.sage_refresh_requests;
create policy sage_refresh_requests_insert on public.sage_refresh_requests
for insert to authenticated
  with check (
    (select public.current_user_has_any_role(ARRAY['admin','direction']::app_role[]))
    and requested_by = (select auth.uid())
    and status = 'pendiente'
  );

drop policy if exists sage_agent_status_read on public.sage_agent_status;
create policy sage_agent_status_read on public.sage_agent_status
for select to authenticated
  using ((select public.current_user_has_any_role(ARRAY['admin','direction']::app_role[])));

-- El agente recoge la siguiente petición. De paso:
--   - apunta que ha preguntado (para saber que está vivo);
--   - da por caducadas las que llevan más de 15 minutos esperando (el agente no
--     estaba preguntando) y por fallidas las que llevan más de 30 leyendo (el
--     agente se cortó), para que no bloqueen el botón.
create or replace function public.sage_claim_refresh()
returns table (id uuid, days integer)
language plpgsql
security invoker
set search_path = public
as $$
#variable_conflict use_column
begin
  insert into sage_agent_status (id, last_poll_at) values (1, now())
  on conflict (id) do update set last_poll_at = now();

  update sage_refresh_requests r
  set status = 'caducada', finished_at = now(), message = 'El servidor de Sage no recogió la petición a tiempo.'
  where r.status = 'pendiente' and r.requested_at < now() - interval '15 minutes';

  update sage_refresh_requests r
  set status = 'error', finished_at = now(), message = 'La lectura empezó pero no terminó.'
  where r.status = 'leyendo' and r.started_at < now() - interval '30 minutes';

  return query
  update sage_refresh_requests r
  set status = 'leyendo', started_at = now()
  where r.id = (
    select q.id from sage_refresh_requests q
    where q.status = 'pendiente'
    order by q.requested_at
    limit 1
    for update skip locked
  )
  returning r.id, r.days;
end;
$$;

revoke all on function public.sage_claim_refresh() from public, anon, authenticated;
grant execute on function public.sage_claim_refresh() to service_role;
