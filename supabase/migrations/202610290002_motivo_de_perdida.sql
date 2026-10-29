-- Por qué se pierde un lead o una consulta.
--
-- Marcar «perdido» decía que se había perdido y nada más. Sin el porqué no hay
-- forma de saber si se pierde por precio, por plazo o porque el cliente dejó
-- de contestar, que son tres problemas distintos con tres arreglos distintos.
--
-- Una sola lista para leads y consultas: es el mismo embudo visto desde dos
-- puertas, y el motivo tiene que poder sumarse entre las dos. Los motivos de
-- rechazo de Sage no sirven de vocabulario: son códigos del 1 al 6 sin nombre,
-- y el 98 % lleva el 1, que es el valor por defecto del campo.
--
-- Se puede volver a ejecutar sin romper nada.

-- ---------- Las columnas ----------

alter table public.leads add column if not exists lost_reason text;
alter table public.leads add column if not exists lost_detail text;
alter table public.inquiries add column if not exists lost_reason text;
alter table public.inquiries add column if not exists lost_detail text;

/*
  Solo los motivos de la lista, y «otro» con su explicación.

  Va en la base y no solo en la pantalla porque hay seis sitios desde los que
  se marca algo como perdido, y un séptimo que se escriba mañana no tiene que
  poder saltárselo. Las filas que ya estaban perdidas no tienen motivo y no lo
  necesitan: un nulo pasa la comprobación, así que no hay que inventárselo.
*/
alter table public.leads drop constraint if exists leads_lost_reason_check;
alter table public.leads add constraint leads_lost_reason_check check (
  (lost_reason is null or lost_reason in ('precio', 'plazo', 'competencia', 'sin_stock', 'condiciones', 'sin_presupuesto', 'no_encaja', 'no_contesta', 'otro'))
  and (lost_reason is distinct from 'otro' or nullif(btrim(lost_detail), '') is not null)
  and (lost_detail is null or char_length(lost_detail) <= 300)
);
alter table public.inquiries drop constraint if exists inquiries_lost_reason_check;
alter table public.inquiries add constraint inquiries_lost_reason_check check (
  (lost_reason is null or lost_reason in ('precio', 'plazo', 'competencia', 'sin_stock', 'condiciones', 'sin_presupuesto', 'no_encaja', 'no_contesta', 'otro'))
  and (lost_reason is distinct from 'otro' or nullif(btrim(lost_detail), '') is not null)
  and (lost_detail is null or char_length(lost_detail) <= 300)
);

comment on column public.leads.lost_reason is 'Por qué se perdió. Solo con el lead perdido: al salir de «perdido» se borra solo.';
comment on column public.inquiries.lost_reason is 'Por qué se perdió. Solo con la consulta perdida: al salir de «perdido» se borra solo.';

-- El nombre de cada motivo, para el historial. La misma lista que la pantalla.
create or replace function public.lost_reason_label(p_reason text)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select case p_reason
    when 'precio' then 'Precio'
    when 'plazo' then 'Plazo de entrega'
    when 'competencia' then 'Se fue con la competencia'
    when 'sin_stock' then 'No lo tenemos o sin stock'
    when 'condiciones' then 'Condiciones de pago'
    when 'sin_presupuesto' then 'Sin presupuesto o lo aplaza'
    when 'no_encaja' then 'No es lo que necesitaba'
    when 'no_contesta' then 'Dejó de contestar'
    when 'otro' then 'Otro motivo'
    else p_reason
  end;
$$;

-- ---------- Fuera de «perdido», sin motivo ----------

/*
  Si algo vuelve de perdido a interesado, el motivo de antes ya no es verdad:
  se borra solo. Así no hace falta que cada pantalla se acuerde de limpiarlo,
  y no queda un «perdido por precio» colgando de una venta ganada.
*/
create or replace function public.limpiar_motivo_de_perdida()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if coalesce(new.status::text, '') not in ('lost', 'perdido') then
    new.lost_reason := null;
    new.lost_detail := null;
  else
    new.lost_detail := nullif(btrim(new.lost_detail), '');
  end if;
  return new;
end;
$$;
revoke all on function public.limpiar_motivo_de_perdida() from public, anon, authenticated;

drop trigger if exists leads_motivo_de_perdida on public.leads;
create trigger leads_motivo_de_perdida
  before insert or update on public.leads
  for each row execute function public.limpiar_motivo_de_perdida();

drop trigger if exists inquiries_motivo_de_perdida on public.inquiries;
create trigger inquiries_motivo_de_perdida
  before insert or update on public.inquiries
  for each row execute function public.limpiar_motivo_de_perdida();

-- ---------- El motivo, en el historial ----------

-- Lead: la misma línea de siempre, con el motivo al final cuando se pierde.
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
      || case when new.status::text = 'lost' and new.lost_reason is not null
           then ' · Motivo: ' || public.lost_reason_label(new.lost_reason) || coalesce(' (' || new.lost_detail || ')', '')
           else '' end
      || ' · ' || tiempo || ' después de entrar' || coalesce(' · ' || quien, ''));
  return new;
end;
$$;
revoke all on function public.log_lead_status_change() from public, anon, authenticated;

/*
  Consulta: la versión vigente del registro (la de 202610270007, con el canal
  por su nombre) más el motivo. En la línea de estado cuando se pierde, y en
  una línea propia si se cambia el motivo de algo que ya estaba perdido.
*/
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
    v_canal := public.inquiry_channel_label(new.inquiry_type::text);
    insert into public.inquiry_log (inquiry_id, actor_id, actor_name, kind, text)
    values (new.id, coalesce(v_actor, new.created_by), v_name, 'alta',
      case when new.entry_mode = 'weekly'
        then 'Recuento semanal registrado · ' || coalesce(new.count, 1) || ' por ' || v_canal
        else 'Consulta registrada · ' || v_canal
          || case when new.status = 'perdido' and new.lost_reason is not null
               then ' · Perdida: ' || public.lost_reason_label(new.lost_reason) || coalesce(' (' || new.lost_detail || ')', '')
               else '' end
      end);
    return new;
  end if;

  -- Al editar, quien cuenta es quien lo hace, no quien la registró.
  if v_actor is null then
    v_name := null;
  end if;

  if new.status is distinct from old.status then
    insert into public.inquiry_log (inquiry_id, actor_id, actor_name, kind, text)
    values (new.id, v_actor, v_name, 'estado',
      public.inquiry_status_label(old.status) || ' → ' || public.inquiry_status_label(new.status)
        || case when new.status = 'perdido' and new.lost_reason is not null
             then ' · Motivo: ' || public.lost_reason_label(new.lost_reason) || coalesce(' (' || new.lost_detail || ')', '')
             else '' end);
  elsif new.status = 'perdido'
    and (new.lost_reason is distinct from old.lost_reason or new.lost_detail is distinct from old.lost_detail) then
    insert into public.inquiry_log (inquiry_id, actor_id, actor_name, kind, text)
    values (new.id, v_actor, v_name, 'estado',
      'Motivo de pérdida: ' || coalesce(public.lost_reason_label(new.lost_reason), 'sin motivo')
        || coalesce(' (' || new.lost_detail || ')', ''));
  end if;

  if new.inquiry_type is distinct from old.inquiry_type then
    insert into public.inquiry_log (inquiry_id, actor_id, actor_name, kind, text)
    values (new.id, v_actor, v_name, 'datos',
      'Canal: ' || public.inquiry_channel_label(old.inquiry_type::text)
        || ' → ' || public.inquiry_channel_label(new.inquiry_type::text));
  end if;

  if new.business_unit_id is distinct from old.business_unit_id then v_fields := array_append(v_fields, 'marca'); end if;
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
