-- Arreglo de seguridad: repartir leads solo pueden hacerlo administración y
-- marketing, y la propia aplicación con su clave de servicio.
--
-- En 202610010001 la comprobación eximía a `current_user` postgres. Dentro de
-- una función SECURITY DEFINER, `current_user` es siempre su propietario
-- (postgres), así que la exención valía para todos y cualquier usuario con
-- sesión podía llamar a estas dos funciones. Ahora no hay exención: o es la
-- clave de servicio, o es alguien con rol de administración o marketing.

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
  if coalesce(auth.role(), '') <> 'service_role'
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
  if coalesce(auth.role(), '') <> 'service_role'
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
