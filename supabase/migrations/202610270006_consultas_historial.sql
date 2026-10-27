-- El historial de cada consulta: quién la registró, cada cambio de estado
-- (quién la pasó a «oferta enviada», a «ganado»…) y qué datos se editaron.
-- Se apunta solo y nadie lo puede modificar ni borrar (salvo que se borre la
-- consulta entera). Sale en la ficha, debajo de los campos.
--
-- Es el mismo patrón que ya tienen los leads (lead_log) y el CRM
-- (crm_contact_log): una tabla a la que solo se añade, escrita por un
-- disparador. Que lo escriba la base y no la aplicación es lo que hace que no
-- se pueda olvidar: una consulta cambiada desde cualquier sitio queda apuntada
-- igual.

create table if not exists public.inquiry_log (
  id bigint generated always as identity primary key,
  inquiry_id uuid not null references public.inquiries (id) on delete cascade,
  created_at timestamptz not null default now(),
  actor_id uuid references public.profiles (id) on delete set null,
  -- El nombre se guarda tal cual, para que se siga viendo aunque la persona se vaya.
  actor_name text,
  kind text not null check (kind in ('alta', 'estado', 'datos')),
  text text not null
);
create index if not exists inquiry_log_inquiry_idx on public.inquiry_log (inquiry_id, created_at);

alter table public.inquiry_log enable row level security;
drop policy if exists inquiry_log_read on public.inquiry_log;
-- Los mismos que ven las consultas (CONSULTAS_ROLES), agencia incluida: si
-- alguien puede abrir la ficha, puede ver quién la ha tocado.
create policy inquiry_log_read on public.inquiry_log for select to authenticated
  using ((select public.current_user_has_any_role(array['admin', 'commercial', 'viewer', 'direction', 'agency']::app_role[])));
-- Desde la aplicación no se escribe: lo escribe el disparador.
revoke insert, update, delete, truncate on public.inquiry_log from anon, authenticated;

create or replace function public.inquiry_log_append_only()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.inquiries i where i.id = old.inquiry_id) then
    return old;
  end if;
  raise exception 'El historial de una consulta no se puede modificar ni borrar.';
end;
$$;
drop trigger if exists inquiry_log_append_only on public.inquiry_log;
create trigger inquiry_log_append_only
  before update or delete on public.inquiry_log
  for each row execute function public.inquiry_log_append_only();

create or replace function public.inquiry_status_label(p_status text)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select case p_status
    when 'informacion' then 'Solo información'
    when 'sin_contactar' then 'Sin contactar'
    when 'contactado' then 'Contactado'
    when 'oferta_enviada' then 'Oferta enviada'
    when 'seguimiento' then 'Seguimiento'
    when 'interesado' then 'Interesado'
    when 'ganado' then 'Ganado'
    when 'perdido' then 'Perdido'
    else coalesce(p_status, 'sin estado')
  end;
$$;

create or replace function public.log_inquiry_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_actor uuid := auth.uid();
  v_name text;
  v_fields text[] := '{}';
  v_canal text;
begin
  select nullif(btrim(p.full_name), '') into v_name
  from public.profiles p where p.id = coalesce(v_actor, new.created_by);

  if tg_op = 'INSERT' then
    v_canal := coalesce(new.inquiry_type::text, 'sin canal');
    insert into public.inquiry_log (inquiry_id, actor_id, actor_name, kind, text)
    values (new.id, coalesce(v_actor, new.created_by), v_name, 'alta',
      case when new.entry_mode = 'weekly'
        then 'Recuento semanal registrado · ' || coalesce(new.count, 1) || ' por ' || v_canal
        else 'Consulta registrada · ' || v_canal end);
    return new;
  end if;

  -- Al editar, quien cuenta es quien lo hace, no quien la registró.
  if v_actor is null then
    v_name := null;
  end if;

  if new.status is distinct from old.status then
    insert into public.inquiry_log (inquiry_id, actor_id, actor_name, kind, text)
    values (new.id, v_actor, v_name, 'estado',
      public.inquiry_status_label(old.status) || ' → ' || public.inquiry_status_label(new.status));
  end if;

  if new.business_unit_id is distinct from old.business_unit_id then v_fields := array_append(v_fields, 'marca'); end if;
  if new.inquiry_type is distinct from old.inquiry_type then v_fields := array_append(v_fields, 'canal'); end if;
  if new.contact_name is distinct from old.contact_name then v_fields := array_append(v_fields, 'contacto'); end if;
  if new.company_name is distinct from old.company_name then v_fields := array_append(v_fields, 'empresa'); end if;
  if new.phone is distinct from old.phone then v_fields := array_append(v_fields, 'teléfono'); end if;
  if new.email is distinct from old.email then v_fields := array_append(v_fields, 'correo'); end if;
  if new.product_interest is distinct from old.product_interest then v_fields := array_append(v_fields, 'qué pide'); end if;
  if new.notes is distinct from old.notes then v_fields := array_append(v_fields, 'notas'); end if;
  if new.count is distinct from old.count then v_fields := array_append(v_fields, 'cantidad'); end if;
  if cardinality(v_fields) > 0 then
    insert into public.inquiry_log (inquiry_id, actor_id, actor_name, kind, text)
    values (new.id, v_actor, v_name, 'datos', 'Ha cambiado: ' || array_to_string(v_fields, ', '));
  end if;

  /*
    El importe va aparte y con su cifra.

    En una consulta el valor no es un dato más: es lo que acaba en las cifras
    de ventas. Saber que «cambió el importe» no sirve de nada si no dice de
    cuánto a cuánto.
  */
  if new.sale_value is distinct from old.sale_value then
    insert into public.inquiry_log (inquiry_id, actor_id, actor_name, kind, text)
    values (new.id, v_actor, v_name, 'datos',
      'Importe: ' || coalesce(to_char(old.sale_value, 'FM999G999G990D00') || ' €', 'sin importe')
        || ' → ' || coalesce(to_char(new.sale_value, 'FM999G999G990D00') || ' €', 'sin importe'));
  end if;
  return new;
end;
$$;
revoke all on function public.log_inquiry_change() from public, anon, authenticated;

drop trigger if exists inquiries_log_change on public.inquiries;
create trigger inquiries_log_change
  after insert or update on public.inquiries
  for each row execute function public.log_inquiry_change();

-- Las consultas que ya había empiezan su historial con su alta, para que
-- ninguna ficha se abra vacía.
insert into public.inquiry_log (inquiry_id, created_at, actor_id, actor_name, kind, text)
select i.id, i.created_at, i.created_by, nullif(btrim(p.full_name), ''), 'alta',
  case when i.entry_mode = 'weekly'
    then 'Recuento semanal registrado · ' || coalesce(i.count, 1) || ' por ' || coalesce(i.inquiry_type::text, 'sin canal')
    else 'Consulta registrada · ' || coalesce(i.inquiry_type::text, 'sin canal') end
from public.inquiries i
left join public.profiles p on p.id = i.created_by
where not exists (select 1 from public.inquiry_log l where l.inquiry_id = i.id);
