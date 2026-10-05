-- Arreglo del historial del CRM (202610030005): al editar un dato del contacto
-- (teléfono, correo, notas…) la lista de campos cambiados se juntaba mal y la base
-- daba error, así que no dejaba guardar. Solo cambia esta función.

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
