-- El estado de la consulta manda su venta, como ya pasa en leads y en el CRM.
--
-- Había dos sitios diciendo lo mismo: el estado ("Oferta enviada", "Ganado",
-- "Perdido") y un desplegable aparte de "venta asociada" con las mismas
-- palabras (Oferta, Pedido, Perdido). Se podía elegir "Ganado" y "Sin venta" a
-- la vez, que es una contradicción, y nadie sabía cuál de los dos mandaba.
--
-- Ahora manda uno: el estado. El apunte de venta lo lleva un disparador, no la
-- pantalla, con las mismas reglas que los leads:
--
--   · Oferta enviada → oferta (se crea si no estaba).
--   · Seguimiento e Interesado → seguimiento (solo si ya había oferta).
--   · Ganado → pedido (se crea aunque no hubiera oferta).
--   · Perdido → perdido (solo si había oferta: perder a quien solo pidió
--     información no es perder una oferta).
--   · Solo información y Contactado no tienen venta; si se vuelve a ellos, el
--     apunte se quita.
--
-- Las altas semanales no entran aquí: son un recuento sin ficha, y su dinero se
-- sigue apuntando aparte por semana.
--
-- Se hace ahora porque no hay nada que migrar: la tabla de consultas está
-- vacía y no existe ni un apunte de venta de consulta.
--
-- Se puede volver a ejecutar sin romper nada.

alter table public.inquiries add column if not exists sale_value numeric(12, 2);

comment on column public.inquiries.sale_value is
  'Lo que vale la oferta o la venta de esta consulta. Se pide al elegir un estado que lleva dinero.';

-- Un apunte por consulta, como en leads y en el CRM.
delete from public.sales_entries a
  using public.sales_entries b
  where a.inquiry_id is not null and a.inquiry_id = b.inquiry_id and a.id > b.id;
create unique index if not exists sales_entries_inquiry_unique on public.sales_entries (inquiry_id) where inquiry_id is not null;

-- Desde la aplicación ya no se crea ni se borra a mano el apunte de una
-- consulta: lo lleva el disparador. Los semanales siguen igual.
drop policy if exists sales_entries_staff_insert on public.sales_entries;
create policy sales_entries_staff_insert on public.sales_entries for insert to authenticated
  with check (
    (select public.current_user_has_any_role(array['admin', 'commercial']::app_role[]))
    and created_by = (select auth.uid())
    and public.current_user_can_access_unit(business_unit_id)
    and lead_id is null
    and crm_contact_id is null
    and inquiry_id is null
  );

drop policy if exists sales_entries_staff_update on public.sales_entries;
create policy sales_entries_staff_update on public.sales_entries for update to authenticated
  using (
    (select public.current_user_has_any_role(array['admin', 'commercial']::app_role[]))
    and public.current_user_can_access_unit(business_unit_id)
    and lead_id is null
    and crm_contact_id is null
    and inquiry_id is null
  )
  with check (
    (select public.current_user_has_any_role(array['admin', 'commercial']::app_role[]))
    and public.current_user_can_access_unit(business_unit_id)
    and lead_id is null
    and crm_contact_id is null
    and inquiry_id is null
  );

drop policy if exists sales_entries_recent_undo_or_admin on public.sales_entries;
create policy sales_entries_recent_undo_or_admin on public.sales_entries for delete to authenticated
  using (
    lead_id is null
    and crm_contact_id is null
    and inquiry_id is null
    and (
      (select public.current_user_has_any_role(array['admin']::app_role[]))
      or (created_by = (select auth.uid()) and created_at >= now() - interval '10 minutes')
    )
  );

create or replace function public.sync_inquiry_sale()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_stage text;
  v_existing public.sales_entries%rowtype;
  v_today date := (now() at time zone 'Europe/Madrid')::date;
  v_note text := 'Consulta: ' || coalesce(nullif(concat_ws(' · ', nullif(btrim(new.contact_name), ''), nullif(btrim(new.company_name), '')), ''), 'Sin nombre');
begin
  -- Las altas semanales son un recuento: ni ficha ni venta.
  if new.entry_mode is distinct from 'single' then
    return new;
  end if;

  v_stage := case new.status
    when 'oferta_enviada' then 'oferta'
    when 'seguimiento' then 'seguimiento'
    when 'interesado' then 'seguimiento'
    when 'ganado' then 'pedido'
    when 'perdido' then 'perdido'
    else null
  end;

  select * into v_existing from public.sales_entries where inquiry_id = new.id;

  if v_stage is null then
    if found then
      delete from public.sales_entries where inquiry_id = new.id;
    end if;
    return new;
  end if;

  if not found then
    if v_stage in ('seguimiento', 'perdido') then
      return new;
    end if;
    insert into public.sales_entries (business_unit_id, sale_type, entry_mode, inquiry_id, occurred_on, count, value, notes, created_by)
    values (new.business_unit_id, v_stage, 'inquiry', new.id, v_today, 1, greatest(coalesce(new.sale_value, 0), 0), v_note, coalesce(auth.uid(), new.created_by));
    return new;
  end if;

  update public.sales_entries
  set sale_type = v_stage,
      occurred_on = case when v_existing.sale_type is distinct from v_stage then v_today else v_existing.occurred_on end,
      value = greatest(coalesce(new.sale_value, 0), 0),
      business_unit_id = new.business_unit_id,
      notes = v_note
  where inquiry_id = new.id;
  return new;
end;
$$;
revoke all on function public.sync_inquiry_sale() from public, anon, authenticated;

drop trigger if exists inquiries_sync_sale on public.inquiries;
create trigger inquiries_sync_sale
  after insert or update of status, sale_value, business_unit_id, contact_name, company_name on public.inquiries
  for each row execute function public.sync_inquiry_sale();
