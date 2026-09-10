-- CRM: listado simple de contactos generados a través de campañas o
-- consultas, gestionado a mano por admin/marketing/commercial (igual que
-- Leads hoy no tiene ninguna creación automática). Dirección tiene acceso
-- de solo lectura, igual que en el resto de módulos comerciales.

create table public.crm_contacts (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references public.business_units(id) on delete restrict,
  full_name text not null,
  company_name text,
  phone text,
  company_phone text,
  company_email text,
  notes text,
  created_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index crm_contacts_business_unit_idx on public.crm_contacts(business_unit_id);
create index crm_contacts_created_at_idx on public.crm_contacts(created_at);

create trigger crm_contacts_set_updated_at before update on public.crm_contacts
  for each row execute function public.set_updated_at();

alter table public.crm_contacts enable row level security;

create policy crm_contacts_select on public.crm_contacts
for select to authenticated using (
  public.current_user_has_any_role(ARRAY['admin','marketing','commercial','direction']::app_role[])
);

create policy crm_contacts_staff_insert on public.crm_contacts
for insert to authenticated with check (
  public.current_user_has_any_role(ARRAY['admin','marketing','commercial']::app_role[])
  and created_by = (select auth.uid())
);

create policy crm_contacts_staff_update on public.crm_contacts
for update to authenticated
  using (public.current_user_has_any_role(ARRAY['admin','marketing','commercial']::app_role[]))
  with check (public.current_user_has_any_role(ARRAY['admin','marketing','commercial']::app_role[]));

create policy crm_contacts_staff_delete on public.crm_contacts
for delete to authenticated using (
  public.current_user_has_any_role(ARRAY['admin','marketing','commercial']::app_role[])
);
