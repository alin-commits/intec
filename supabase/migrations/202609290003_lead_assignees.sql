-- Un lead puede tener varios responsables, y los pone administración.
--
-- Hasta ahora el responsable era una sola columna en la propia tabla de leads
-- (leads.assigned_to). Eso traía dos problemas:
--
--   1. Un lead que llevan dos comerciales no se podía representar.
--   2. Postgres no sabe restringir permisos por columna dentro de una fila: si
--      un comercial puede editar el lead (y tiene que poder, para cambiar el
--      estado o apuntar el valor de la venta), también puede cambiarse el
--      responsable a sí mismo. Sacando el responsable a su propia tabla, el
--      permiso se puede dar por separado: los comerciales la leen, pero no la
--      escriben.
--
-- Quien asigna: admin y marketing. Dirección no, porque en toda la aplicación
-- solo mira. Comercial tampoco: ve quién lleva cada lead, pero no lo toca.
--
-- Se puede volver a ejecutar entera sin romper nada.

create table if not exists public.lead_assignees (
  lead_id uuid not null references public.leads(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  assigned_by uuid references public.profiles(id) on delete set null default auth.uid(),
  primary key (lead_id, profile_id)
);

-- "Los leads de este comercial" es la consulta más frecuente (el aviso de la
-- barra superior y el correo de leads sin contactar).
create index if not exists lead_assignees_profile_idx on public.lead_assignees (profile_id);

alter table public.lead_assignees enable row level security;

-- Ver: los mismos roles que ven los leads. Un lead sin su responsable al lado
-- no sirve de nada.
drop policy if exists lead_assignees_read_by_role on public.lead_assignees;
create policy lead_assignees_read_by_role on public.lead_assignees
  for select to authenticated
  using ((select public.current_user_has_any_role(ARRAY['admin','commercial','marketing','viewer','direction']::app_role[])));

-- Escribir: solo quien reparte el trabajo. Esta es la razón de ser de la tabla.
drop policy if exists lead_assignees_write on public.lead_assignees;
create policy lead_assignees_write on public.lead_assignees
  for all to authenticated
  using ((select public.current_user_has_any_role(ARRAY['admin','marketing']::app_role[])))
  with check ((select public.current_user_has_any_role(ARRAY['admin','marketing']::app_role[])));

-- ---------- Lo que ya estaba asignado ----------
-- Cada responsable único pasa a ser el primer responsable de su lead.
insert into public.lead_assignees (lead_id, profile_id)
select l.id, l.assigned_to
from public.leads l
where l.assigned_to is not null
on conflict (lead_id, profile_id) do nothing;

-- La columna vieja no se borra aquí: se queda como copia de seguridad de lo
-- que había el día de la migración, por si hubiera que mirar atrás. La
-- aplicación ya no la lee ni la escribe, así que no hay dos verdades: manda
-- lead_assignees. Cuando se confirme que no falta nada, se puede tirar con
--   alter table public.leads drop column assigned_to;
comment on column public.leads.assigned_to is
  'OBSOLETA. El responsable vive en public.lead_assignees desde 202609290003. Se conserva solo como copia de lo que había antes de la migración.';
