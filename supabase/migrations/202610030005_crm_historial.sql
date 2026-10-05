-- El historial de cada contacto del CRM: quién lo creó, cada cambio de estado
-- (quién lo pasó a "contactado", a "oferta enviada"…), los cambios de origen y
-- qué datos se editaron. Se apunta solo y nadie lo puede modificar ni borrar
-- (salvo que se borre el contacto entero). Sale en la ficha, bajo las notas.

create table if not exists public.crm_contact_log (
  id bigint generated always as identity primary key,
  contact_id uuid not null references public.crm_contacts (id) on delete cascade,
  created_at timestamptz not null default now(),
  actor_id uuid references public.profiles (id) on delete set null,
  -- El nombre se guarda tal cual, para que se siga viendo aunque la persona se vaya.
  actor_name text,
  kind text not null check (kind in ('alta', 'estado', 'origen', 'datos')),
  text text not null
);
create index if not exists crm_contact_log_contact_idx on public.crm_contact_log (contact_id, created_at);

alter table public.crm_contact_log enable row level security;
drop policy if exists crm_contact_log_read on public.crm_contact_log;
create policy crm_contact_log_read on public.crm_contact_log for select to authenticated
  using ((select public.current_user_has_any_role(array['admin', 'marketing', 'commercial', 'direction']::app_role[])));
revoke insert, update, delete, truncate on public.crm_contact_log from anon, authenticated;

create or replace function public.crm_contact_log_append_only()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.crm_contacts c where c.id = old.contact_id) then
    return old;
  end if;
  raise exception 'El historial de un contacto no se puede modificar ni borrar.';
end;
$$;
drop trigger if exists crm_contact_log_append_only on public.crm_contact_log;
create trigger crm_contact_log_append_only
  before update or delete on public.crm_contact_log
  for each row execute function public.crm_contact_log_append_only();

create or replace function public.crm_status_label(p_status text)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select case p_status
    when 'sin_contactar' then 'Sin contactar'
    when 'contactado' then 'Contactado'
    when 'oferta_enviada' then 'Oferta enviada'
    when 'interesado' then 'Interesado'
    when 'ganado' then 'Ganado'
    when 'perdido' then 'Perdido'
    else coalesce(p_status, '—')
  end;
$$;

create or replace function public.log_crm_contact_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_actor uuid := auth.uid();
  v_name text;
  v_fields text[] := '{}';
begin
  select nullif(btrim(p.full_name), '') into v_name from public.profiles p where p.id = coalesce(v_actor, new.created_by);

  if tg_op = 'INSERT' then
    insert into public.crm_contact_log (contact_id, actor_id, actor_name, kind, text)
    values (new.id, coalesce(v_actor, new.created_by), v_name, 'alta',
      'Contacto creado' || coalesce(' · origen: ' || nullif(btrim(new.origin), ''), ''));
    return new;
  end if;

  -- Al editar, quien cuenta es quien lo hace, no quien lo creó.
  if v_actor is null then
    v_name := null;
  end if;

  if new.status is distinct from old.status then
    insert into public.crm_contact_log (contact_id, actor_id, actor_name, kind, text)
    values (new.id, v_actor, v_name, 'estado', public.crm_status_label(old.status) || ' → ' || public.crm_status_label(new.status));
  end if;

  if nullif(btrim(new.origin), '') is distinct from nullif(btrim(old.origin), '') then
    insert into public.crm_contact_log (contact_id, actor_id, actor_name, kind, text)
    values (new.id, v_actor, v_name, 'origen',
      'Origen: ' || coalesce(nullif(btrim(old.origin), ''), 'sin origen') || ' → ' || coalesce(nullif(btrim(new.origin), ''), 'sin origen'));
  end if;

  if new.full_name is distinct from old.full_name then v_fields := array_append(v_fields, 'nombre'); end if;
  if new.company_name is distinct from old.company_name then v_fields := array_append(v_fields, 'empresa'); end if;
  if new.business_unit_id is distinct from old.business_unit_id then v_fields := array_append(v_fields, 'marca'); end if;
  if new.phone is distinct from old.phone then v_fields := array_append(v_fields, 'teléfono'); end if;
  if new.company_email is distinct from old.company_email then v_fields := array_append(v_fields, 'correo'); end if;
  if new.city is distinct from old.city then v_fields := array_append(v_fields, 'población'); end if;
  if new.notes is distinct from old.notes then v_fields := array_append(v_fields, 'notas'); end if;
  if cardinality(v_fields) > 0 then
    insert into public.crm_contact_log (contact_id, actor_id, actor_name, kind, text)
    values (new.id, v_actor, v_name, 'datos', 'Ha cambiado: ' || array_to_string(v_fields, ', '));
  end if;
  return new;
end;
$$;
revoke all on function public.log_crm_contact_change() from public, anon, authenticated;

drop trigger if exists crm_contacts_log_change on public.crm_contacts;
create trigger crm_contacts_log_change
  after insert or update on public.crm_contacts
  for each row execute function public.log_crm_contact_change();

-- Los contactos que ya había empiezan su historial con su alta.
insert into public.crm_contact_log (contact_id, created_at, actor_id, actor_name, kind, text)
select c.id, c.created_at, c.created_by, nullif(btrim(p.full_name), ''), 'alta',
  'Contacto creado' || coalesce(' · origen: ' || nullif(btrim(c.origin), ''), '')
from public.crm_contacts c
left join public.profiles p on p.id = c.created_by
where not exists (select 1 from public.crm_contact_log l where l.contact_id = c.id);
