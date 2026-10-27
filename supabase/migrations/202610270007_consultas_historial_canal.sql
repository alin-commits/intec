-- El historial de una consulta decía el canal en bruto: «email_form» en vez de
-- «Email/Formulario», «portal_rrss» en vez de «Portal/RRSS». El estado sí salía
-- con su nombre, porque tenía su función de etiquetas; el canal no la tenía.
--
-- Esto añade la que faltaba, la usa el disparador a partir de ahora, y arregla
-- de una vez las líneas que ya se escribieron mal.
--
-- Se puede volver a ejecutar sin romper nada.

create or replace function public.inquiry_channel_label(p_channel text)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select case p_channel
    when 'phone' then 'Teléfono'
    when 'chat' then 'Chat'
    when 'email_form' then 'Email/Formulario'
    when 'whatsapp' then 'Whatsapp'
    when 'portal_rrss' then 'Portal/RRSS'
    else coalesce(p_channel, 'sin canal')
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
    v_canal := public.inquiry_channel_label(new.inquiry_type::text);
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

  /*
    El canal cambiado se dice entero, no como «ha cambiado el canal».

    Es el mismo motivo que el importe: saber que cambió no sirve de nada si no
    dice de qué a qué, y en una consulta el canal es por dónde entró el cliente.
  */
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

/*
  Y las líneas que ya se escribieron con el canal en bruto.

  El historial es de solo añadir —un disparador impide tocarlo— y eso está
  bien: nadie debe poder reescribir lo que pasó. Pero esto no cambia lo que
  pasó, sino cómo lo escribió la aplicación, que lo escribió mal. Se quita la
  guarda, se corrige y se vuelve a poner, todo aquí, para que no quede un rato
  en el que el historial se pueda editar desde fuera.

  Solo toca las líneas de alta, que son las únicas que llevaban el código: las
  de estado ya usaban su etiqueta, y las de datos no nombran el canal.
*/
drop trigger if exists inquiry_log_append_only on public.inquiry_log;

update public.inquiry_log l
set text = left(l.text, length(l.text) - length(i.inquiry_type::text))
           || public.inquiry_channel_label(i.inquiry_type::text)
from public.inquiries i
where i.id = l.inquiry_id
  and l.kind = 'alta'
  and l.text like '%' || i.inquiry_type::text;

create trigger inquiry_log_append_only
  before update or delete on public.inquiry_log
  for each row execute function public.inquiry_log_append_only();
