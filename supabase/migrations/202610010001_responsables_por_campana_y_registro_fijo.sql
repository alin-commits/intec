-- Dos cosas para tener control de los leads:
--
-- 1. Un registro de cada lead que nadie puede tocar: lo que llegó de Meta, cada
--    cambio de estado (cuándo, cuánto tardó desde que entró y quién) y las
--    asignaciones automáticas. Antes iba dentro de "Observaciones", que se puede
--    editar y borrar; ahora va aparte y solo se puede añadir.
-- 2. Responsables por campaña: los leads que entran de una campaña se asignan
--    solos a sus comerciales, a todos o por turnos.

-- ---------- El registro ----------

create table if not exists public.lead_log (
  id bigint generated always as identity primary key,
  lead_id uuid not null references public.leads (id) on delete cascade,
  created_at timestamptz not null default now(),
  kind text not null check (kind in ('meta', 'estado', 'asignacion')),
  text text not null
);
create index if not exists lead_log_lead_idx on public.lead_log (lead_id, created_at);

alter table public.lead_log enable row level security;
drop policy if exists lead_log_read on public.lead_log;
create policy lead_log_read on public.lead_log for select to authenticated
  using ((select public.current_user_has_any_role(array['admin', 'commercial', 'marketing', 'viewer', 'direction']::app_role[])));
-- Desde la aplicación no se escribe: lo escriben la base y la sincronización.
revoke insert, update, delete, truncate on public.lead_log from anon, authenticated;

-- Y una vez escrito no se cambia, ni con la clave de servicio. Solo desaparece
-- si se borra el lead entero (el borrado en cascada llega cuando el lead ya no
-- existe).
create or replace function public.lead_log_append_only()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.leads l where l.id = old.lead_id) then
    return old;
  end if;
  raise exception 'El registro de un lead no se puede modificar ni borrar.';
end;
$$;
drop trigger if exists lead_log_append_only on public.lead_log;
create trigger lead_log_append_only
  before update or delete on public.lead_log
  for each row execute function public.lead_log_append_only();

-- Los cambios de estado van al registro, no a las observaciones.
create or replace function public.log_lead_status_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  segundos bigint;
  tiempo text;
  quien text;
begin
  if old.status is not distinct from new.status then
    return new;
  end if;
  segundos := greatest(extract(epoch from (now() - new.created_at))::bigint, 0);
  tiempo := case
    when segundos < 3600 then (segundos / 60) || ' min'
    when segundos < 86400 then (segundos / 3600) || ' h ' || ((segundos % 3600) / 60) || ' min'
    else (segundos / 86400) || case when segundos / 86400 = 1 then ' día' else ' días' end
      || case when (segundos % 86400) / 3600 > 0 then ' y ' || ((segundos % 86400) / 3600) || ' h' else '' end
  end;
  select nullif(btrim(p.full_name), '') into quien from public.profiles p where p.id = auth.uid();
  insert into public.lead_log (lead_id, kind, text)
  values (new.id, 'estado',
    public.lead_status_label(old.status) || ' → ' || public.lead_status_label(new.status)
      || ' · ' || tiempo || ' después de entrar' || coalesce(' · ' || quien, ''));
  return new;
end;
$$;
revoke all on function public.log_lead_status_change() from public, anon, authenticated;

drop trigger if exists leads_note_status_change on public.leads;
drop function if exists public.note_lead_status_change();
drop trigger if exists leads_log_status_change on public.leads;
create trigger leads_log_status_change
  after update of status on public.leads
  for each row execute function public.log_lead_status_change();

-- La fecha de entrada de un lead no cambia nunca, y lo que lo ata a Meta solo
-- lo cambia la propia aplicación (la clave de servicio).
create or replace function public.guard_lead_fixed_fields()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  new.created_at := old.created_at;
  if coalesce(auth.role(), '') <> 'service_role' and current_user not in ('postgres', 'supabase_admin') then
    new.meta_lead_id := old.meta_lead_id;
    new.meta_campaign_id := old.meta_campaign_id;
    new.created_by := old.created_by;
  end if;
  return new;
end;
$$;
drop trigger if exists leads_guard_fixed_fields on public.leads;
create trigger leads_guard_fixed_fields
  before update on public.leads
  for each row execute function public.guard_lead_fixed_fields();

-- Lo automático que ya estaba en las observaciones pasa al registro.
-- a) Lo que llegó de Meta en los leads que entraron solos (todo su texto).
insert into public.lead_log (lead_id, created_at, kind, text)
select l.id, l.created_at, 'meta', btrim(l.notes)
from public.leads l
where l.created_by is null and l.meta_lead_id is not null and l.notes like 'Entró por Meta Ads:%';
update public.leads l
set notes = null
where l.created_by is null and l.meta_lead_id is not null and l.notes like 'Entró por Meta Ads:%';

-- b) Las líneas de cambio de estado ("30/09/2026 16:24 · Nuevo → Contactado · …"),
-- con su fecha y hora de Madrid.
insert into public.lead_log (lead_id, created_at, kind, text)
select l.id,
  make_timestamp(m[3]::int, m[2]::int, m[1]::int, m[4]::int, m[5]::int, 0) at time zone 'Europe/Madrid',
  'estado',
  m[6]
from public.leads l
cross join lateral regexp_split_to_table(l.notes, E'\n') as linea
cross join lateral regexp_match(linea, '^(\d{2})/(\d{2})/(\d{4}) (\d{2}):(\d{2}) · (.+ → .+)$') as m
where l.notes is not null and m is not null;
update public.leads l
set notes = nullif(btrim(coalesce((
  select string_agg(t.linea, E'\n' order by t.n)
  from regexp_split_to_table(l.notes, E'\n') with ordinality as t(linea, n)
  where t.linea !~ '^\d{2}/\d{2}/\d{4} \d{2}:\d{2} · .+ → .+$'
), '')), '')
where l.notes ~ '(^|\n)\d{2}/\d{2}/\d{4} \d{2}:\d{2} · .+ → .+';

-- ---------- Responsables por campaña ----------

alter table public.campaigns add column if not exists leads_assign_mode text not null default 'todos';
alter table public.campaigns drop constraint if exists campaigns_leads_assign_mode_check;
alter table public.campaigns add constraint campaigns_leads_assign_mode_check check (leads_assign_mode in ('todos', 'turnos'));

create table if not exists public.campaign_assignees (
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (campaign_id, profile_id)
);
alter table public.campaign_assignees enable row level security;
drop policy if exists campaign_assignees_read on public.campaign_assignees;
create policy campaign_assignees_read on public.campaign_assignees for select to authenticated
  using ((select public.current_user_has_any_role(array['admin', 'commercial', 'marketing', 'viewer', 'direction']::app_role[])));
-- Los configura quien reparte los leads: administración y marketing.
drop policy if exists campaign_assignees_write on public.campaign_assignees;
create policy campaign_assignees_write on public.campaign_assignees for all to authenticated
  using ((select public.current_user_has_any_role(array['admin', 'marketing']::app_role[])))
  with check ((select public.current_user_has_any_role(array['admin', 'marketing']::app_role[])));

/*
  Asigna un lead sin responsable según su campaña: a todos sus comerciales, o
  por turnos al que menos leads lleva de esa campaña. Lo apunta en el registro
  y devuelve a quién se asignó (para avisarles). Si el lead ya tiene
  responsable, o su campaña no tiene comerciales, no hace nada.
*/
create or replace function public.assign_lead_from_campaign(p_lead uuid)
returns uuid[]
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_campaign uuid;
  v_mode text;
  v_ids uuid[];
  v_names text;
begin
  if coalesce(auth.role(), '') <> 'service_role' and current_user not in ('postgres', 'supabase_admin')
    and not public.current_user_has_any_role(array['admin', 'marketing']::app_role[]) then
    raise exception 'No tienes permiso para repartir leads.';
  end if;

  select l.campaign_id into v_campaign from public.leads l where l.id = p_lead;
  if v_campaign is null or exists (select 1 from public.lead_assignees a where a.lead_id = p_lead) then
    return '{}';
  end if;
  select c.leads_assign_mode into v_mode from public.campaigns c where c.id = v_campaign;

  if v_mode = 'turnos' then
    select array[ca.profile_id] into v_ids
    from public.campaign_assignees ca
    join public.profiles p on p.id = ca.profile_id and p.is_active
    where ca.campaign_id = v_campaign
    order by (
      select count(*) from public.lead_assignees la
      join public.leads l2 on l2.id = la.lead_id
      where l2.campaign_id = v_campaign and la.profile_id = ca.profile_id
    ), ca.added_at, ca.profile_id
    limit 1;
  else
    select array_agg(ca.profile_id order by ca.added_at) into v_ids
    from public.campaign_assignees ca
    join public.profiles p on p.id = ca.profile_id and p.is_active
    where ca.campaign_id = v_campaign;
  end if;
  if v_ids is null or cardinality(v_ids) = 0 then
    return '{}';
  end if;

  insert into public.lead_assignees (lead_id, profile_id, assigned_by)
  select p_lead, unnest(v_ids), null
  on conflict do nothing;

  select string_agg(coalesce(nullif(btrim(p.full_name), ''), 'Usuario'), ', ' order by p.full_name) into v_names
  from public.profiles p where p.id = any(v_ids);
  insert into public.lead_log (lead_id, kind, text)
  values (p_lead, 'asignacion', 'Asignado solo por su campaña' || case when v_mode = 'turnos' then ' (por turnos)' else '' end || ': ' || v_names);
  return v_ids;
end;
$$;

-- Reparte de golpe los leads abiertos de una campaña que todavía no tienen
-- responsable (por ejemplo, al configurarla). Devuelve a quién fue cada uno.
create or replace function public.assign_campaign_backlog(p_campaign uuid)
returns table(lead_id uuid, profile_ids uuid[])
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lead uuid;
  v_ids uuid[];
begin
  if coalesce(auth.role(), '') <> 'service_role' and current_user not in ('postgres', 'supabase_admin')
    and not public.current_user_has_any_role(array['admin', 'marketing']::app_role[]) then
    raise exception 'No tienes permiso para repartir leads.';
  end if;
  for v_lead in
    select l.id from public.leads l
    where l.campaign_id = p_campaign
      and l.status not in ('won', 'lost', 'invalid')
      and not exists (select 1 from public.lead_assignees a where a.lead_id = l.id)
    order by l.created_at
  loop
    v_ids := public.assign_lead_from_campaign(v_lead);
    if cardinality(v_ids) > 0 then
      lead_id := v_lead;
      profile_ids := v_ids;
      return next;
    end if;
  end loop;
end;
$$;

revoke all on function public.assign_lead_from_campaign(uuid) from public, anon;
revoke all on function public.assign_campaign_backlog(uuid) from public, anon;
grant execute on function public.assign_lead_from_campaign(uuid) to authenticated, service_role;
grant execute on function public.assign_campaign_backlog(uuid) to authenticated, service_role;
