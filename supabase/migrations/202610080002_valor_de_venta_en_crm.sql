-- El valor de venta en el CRM, igual que en los leads.
--
-- En el CRM se apunta a quien se conoce en una feria o en persona. Hasta ahora
-- se podía marcar "Ganado" pero no decir por cuánto, así que esa venta no
-- existía en ninguna cifra: quedaba un contacto verde y nada más.
--
-- No se inventa un sitio nuevo para ese dinero. `sales_entries` ya es el libro
-- común —de ahí cuelgan las consultas y los leads— y el apunte lo lleva un
-- disparador, no la pantalla, para que no haya dos versiones de la misma venta.
-- Las reglas son las mismas que en los leads:
--
--   · Oferta enviada → oferta (se crea si no estaba).
--   · Interesado     → seguimiento (solo si ya había oferta).
--   · Ganado         → pedido (se crea aunque no hubiera oferta: en una feria
--                      se cierra sin pasar por ahí).
--   · Perdido        → perdido (solo si había oferta: perder a alguien con
--                      quien no se llegó a ofertar no es perder una oferta).
--   · Volver atrás (sin contactar, contactado) quita el apunte.
--
-- Lo que esto significa: a partir de ahora una venta cerrada en el CRM suma en
-- las cifras de ventas, igual que ya suma la de un lead. Es lo que se busca,
-- pero conviene saberlo antes de mirar los totales del mes.
--
-- No se rellena nada hacia atrás: los contactos que ya están en "Ganado" no
-- tienen importe, y crearles un apunte de 0 € solo ensuciaría los números. En
-- cuanto se les ponga el valor, aparece su apunte.
--
-- Se puede volver a ejecutar sin romper nada.

alter table public.crm_contacts add column if not exists sale_value numeric(12, 2);

comment on column public.crm_contacts.sale_value is
  'Lo que se vendió a este contacto. Se pide al pasarlo a oferta o a ganado, igual que en un lead.';

alter table public.sales_entries add column if not exists crm_contact_id uuid references public.crm_contacts (id) on delete cascade;
create unique index if not exists sales_entries_crm_unique on public.sales_entries (crm_contact_id) where crm_contact_id is not null;

alter table public.sales_entries drop constraint if exists sales_entries_entry_mode_check;
alter table public.sales_entries add constraint sales_entries_entry_mode_check
  check (entry_mode in ('inquiry', 'weekly', 'lead', 'crm'));

alter table public.sales_entries drop constraint if exists sales_entries_mode_shape;
alter table public.sales_entries add constraint sales_entries_mode_shape check (
  (entry_mode = 'inquiry' and inquiry_id is not null and week_start is null and count = 1 and lead_id is null and crm_contact_id is null)
  or (entry_mode = 'weekly' and week_start is not null and inquiry_id is null and lead_id is null and crm_contact_id is null)
  or (entry_mode = 'lead' and lead_id is not null and inquiry_id is null and week_start is null and count = 1 and crm_contact_id is null)
  or (entry_mode = 'crm' and crm_contact_id is not null and inquiry_id is null and lead_id is null and week_start is null and count = 1)
);

-- Desde la aplicación tampoco se toca a mano un apunte del CRM: lo lleva el
-- disparador, como el de los leads.
drop policy if exists sales_entries_staff_insert on public.sales_entries;
create policy sales_entries_staff_insert on public.sales_entries for insert to authenticated
  with check (
    (select public.current_user_has_any_role(array['admin', 'commercial']::app_role[]))
    and created_by = (select auth.uid())
    and public.current_user_can_access_unit(business_unit_id)
    and lead_id is null
    and crm_contact_id is null
  );

drop policy if exists sales_entries_staff_update on public.sales_entries;
create policy sales_entries_staff_update on public.sales_entries for update to authenticated
  using (
    (select public.current_user_has_any_role(array['admin', 'commercial']::app_role[]))
    and public.current_user_can_access_unit(business_unit_id)
    and lead_id is null
    and crm_contact_id is null
  )
  with check (
    (select public.current_user_has_any_role(array['admin', 'commercial']::app_role[]))
    and public.current_user_can_access_unit(business_unit_id)
    and lead_id is null
    and crm_contact_id is null
  );

drop policy if exists sales_entries_recent_undo_or_admin on public.sales_entries;
create policy sales_entries_recent_undo_or_admin on public.sales_entries for delete to authenticated
  using (
    lead_id is null
    and crm_contact_id is null
    and (
      (select public.current_user_has_any_role(array['admin']::app_role[]))
      or (created_by = (select auth.uid()) and created_at >= now() - interval '10 minutes')
    )
  );

/* Lleva el apunte al estado del contacto. Mismas reglas que en los leads. */
create or replace function public.sync_crm_sale()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_stage text;
  v_existing public.sales_entries%rowtype;
  v_today date := (now() at time zone 'Europe/Madrid')::date;
  -- Para reconocerlo en Consultas: "CRM: Laura Pérez · Clima Alacant S.L.".
  v_note text := 'CRM: ' || coalesce(nullif(concat_ws(' · ', nullif(btrim(new.full_name), ''), nullif(btrim(new.company_name), '')), ''), 'Sin nombre');
begin
  v_stage := case new.status
    when 'oferta_enviada' then 'oferta'
    when 'interesado' then 'seguimiento'
    when 'ganado' then 'pedido'
    when 'perdido' then 'perdido'
    else null
  end;

  select * into v_existing from public.sales_entries where crm_contact_id = new.id;

  if v_stage is null then
    if found then
      delete from public.sales_entries where crm_contact_id = new.id;
    end if;
    return new;
  end if;

  if not found then
    -- Un seguimiento o una pérdida sin oferta previa no abren apunte.
    if v_stage in ('seguimiento', 'perdido') then
      return new;
    end if;
    insert into public.sales_entries (business_unit_id, sale_type, entry_mode, crm_contact_id, occurred_on, count, value, notes, created_by)
    values (new.business_unit_id, v_stage, 'crm', new.id, v_today, 1, greatest(coalesce(new.sale_value, 0), 0), v_note, coalesce(auth.uid(), new.created_by));
    return new;
  end if;

  update public.sales_entries
  set sale_type = v_stage,
      occurred_on = case when v_existing.sale_type is distinct from v_stage then v_today else v_existing.occurred_on end,
      value = greatest(coalesce(new.sale_value, 0), 0),
      business_unit_id = new.business_unit_id,
      notes = v_note
  where crm_contact_id = new.id;
  return new;
end;
$$;
revoke all on function public.sync_crm_sale() from public, anon, authenticated;

drop trigger if exists crm_contacts_sync_sale on public.crm_contacts;
create trigger crm_contacts_sync_sale
  after insert or update of status, sale_value, business_unit_id, full_name, company_name on public.crm_contacts
  for each row execute function public.sync_crm_sale();
