-- Un lead y su venta en Consultas, enlazados.
--
-- Cuando un lead pasa a "Oferta enviada", en Consultas → Ventas comerciales
-- aparece solo su oferta; al pasar a "Interesado" es un seguimiento, a
-- "Ganado" un pedido (la venta) y a "Perdido" una oferta perdida. El importe
-- es siempre el "Valor de venta" del lead.
--
-- Es UN solo apunte, enlazado al lead (sales_entries.lead_id): la venta cuenta
-- en su campaña (por el lead), en las ventas de Consultas (por el apunte) y en
-- el total de ventas de Inicio, que no la suma dos veces. Ese apunte solo se
-- cambia desde el lead: en Consultas se ve, pero no se edita ni se borra.

alter table public.sales_entries add column if not exists lead_id uuid references public.leads (id) on delete cascade;
create unique index if not exists sales_entries_lead_unique on public.sales_entries (lead_id) where lead_id is not null;

alter table public.sales_entries drop constraint if exists sales_entries_entry_mode_check;
alter table public.sales_entries add constraint sales_entries_entry_mode_check check (entry_mode in ('inquiry', 'weekly', 'lead'));
alter table public.sales_entries drop constraint if exists sales_entries_mode_shape;
alter table public.sales_entries add constraint sales_entries_mode_shape check (
  (entry_mode = 'inquiry' and inquiry_id is not null and week_start is null and count = 1 and lead_id is null)
  or (entry_mode = 'weekly' and week_start is not null and inquiry_id is null and lead_id is null)
  or (entry_mode = 'lead' and lead_id is not null and inquiry_id is null and week_start is null and count = 1)
);

-- Desde la aplicación no se crea, cambia ni borra un apunte de lead: lo lleva
-- el disparador de abajo.
drop policy if exists sales_entries_staff_insert on public.sales_entries;
create policy sales_entries_staff_insert on public.sales_entries for insert to authenticated
  with check (
    (select public.current_user_has_any_role(array['admin', 'commercial']::app_role[]))
    and created_by = (select auth.uid())
    and public.current_user_can_access_unit(business_unit_id)
    and lead_id is null
  );
drop policy if exists sales_entries_staff_update on public.sales_entries;
create policy sales_entries_staff_update on public.sales_entries for update to authenticated
  using (
    (select public.current_user_has_any_role(array['admin', 'commercial']::app_role[]))
    and public.current_user_can_access_unit(business_unit_id)
    and lead_id is null
  )
  with check (
    (select public.current_user_has_any_role(array['admin', 'commercial']::app_role[]))
    and public.current_user_can_access_unit(business_unit_id)
    and lead_id is null
  );
drop policy if exists sales_entries_recent_undo_or_admin on public.sales_entries;
create policy sales_entries_recent_undo_or_admin on public.sales_entries for delete to authenticated
  using (
    lead_id is null
    and (
      (select public.current_user_has_any_role(array['admin']::app_role[]))
      or (created_by = (select auth.uid()) and created_at >= now() - interval '10 minutes')
    )
  );

/*
  Lleva el apunte de Consultas al estado del lead:
  - Oferta enviada → oferta (lo crea si no estaba).
  - Interesado → seguimiento (solo si ya había oferta).
  - Ganado → pedido (lo crea si no estaba: se puede ganar sin pasar por oferta).
  - Perdido → perdido (solo si había oferta: perder un lead sin oferta no es
    perder una oferta).
  - Si vuelve atrás (nuevo, contactado…) o es "No válido", la oferta ya no
    está en pie y el apunte se quita.
  La fecha del apunte es la del último cambio de etapa, para que la venta caiga
  en el mes en que se ganó.
*/
create or replace function public.sync_lead_sale()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_stage text;
  v_existing public.sales_entries%rowtype;
  v_today date := (now() at time zone 'Europe/Madrid')::date;
  -- Para reconocerlo en Consultas: "Lead: Laura Pérez · Clima Alacant S.L.".
  v_note text := 'Lead: ' || coalesce(nullif(concat_ws(' · ', nullif(btrim(new.contact_name), ''), nullif(btrim(new.client_company_name), '')), ''), 'Sin nombre');
begin
  v_stage := case new.status
    when 'offer_sent' then 'oferta'
    when 'interested' then 'seguimiento'
    when 'won' then 'pedido'
    when 'lost' then 'perdido'
    else null
  end;

  select * into v_existing from public.sales_entries where lead_id = new.id;

  if v_stage is null then
    if found then
      delete from public.sales_entries where lead_id = new.id;
    end if;
    return new;
  end if;

  if not found then
    if v_stage in ('seguimiento', 'perdido') then
      return new;
    end if;
    insert into public.sales_entries (business_unit_id, sale_type, entry_mode, lead_id, occurred_on, count, value, notes, created_by)
    values (new.business_unit_id, v_stage, 'lead', new.id, v_today, 1, greatest(coalesce(new.sale_value, 0), 0), v_note, coalesce(auth.uid(), new.created_by));
    return new;
  end if;

  update public.sales_entries
  set sale_type = v_stage,
      occurred_on = case when v_existing.sale_type is distinct from v_stage then v_today else v_existing.occurred_on end,
      value = greatest(coalesce(new.sale_value, 0), 0),
      business_unit_id = new.business_unit_id,
      notes = v_note
  where lead_id = new.id;
  return new;
end;
$$;
revoke all on function public.sync_lead_sale() from public, anon, authenticated;

drop trigger if exists leads_sync_sale on public.leads;
create trigger leads_sync_sale
  after insert or update of status, sale_value, business_unit_id, contact_name, client_company_name on public.leads
  for each row execute function public.sync_lead_sale();

-- Los leads que ya están en una de esas etapas tienen su apunte desde hoy,
-- con la fecha en que llegaron a ella.
insert into public.sales_entries (business_unit_id, sale_type, entry_mode, lead_id, occurred_on, count, value, notes, created_by)
select l.business_unit_id,
  case l.status when 'offer_sent' then 'oferta' when 'interested' then 'seguimiento' when 'won' then 'pedido' else 'perdido' end,
  'lead', l.id,
  (coalesce((select max(h.changed_at) from public.lead_status_history h where h.lead_id = l.id and h.new_status = l.status), l.updated_at, l.created_at)
    at time zone 'Europe/Madrid')::date,
  1, greatest(coalesce(l.sale_value, 0), 0),
  'Lead: ' || coalesce(nullif(concat_ws(' · ', nullif(btrim(l.contact_name), ''), nullif(btrim(l.client_company_name), '')), ''), 'Sin nombre'),
  l.created_by
from public.leads l
where not exists (select 1 from public.sales_entries s where s.lead_id = l.id)
  and (
    l.status in ('offer_sent', 'won')
    or (l.status in ('interested', 'lost') and exists (select 1 from public.lead_status_history h where h.lead_id = l.id and h.new_status = 'offer_sent'))
  );
