-- Intec Commercial Hub - esquema inicial
-- Ejecutar primero en un proyecto de desarrollo de Supabase.

create extension if not exists pgcrypto;

create type public.app_role as enum ('admin', 'commercial', 'viewer');
create type public.inquiry_type as enum ('web', 'phone');
create type public.campaign_status as enum ('draft', 'active', 'finished', 'archived');
create type public.lead_status as enum ('new', 'contact_attempt', 'contacted', 'offer_sent', 'interested', 'won', 'lost', 'invalid');
create type public.lead_type as enum ('sale', 'distributor', 'quote_request', 'service', 'other');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role public.app_role not null default 'viewer',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.business_units (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  logo_url text,
  brand_color text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint business_units_brand_color_format check (brand_color is null or brand_color ~ '^#[0-9A-Fa-f]{6}$')
);

create table public.inquiries (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references public.business_units(id) on delete restrict,
  inquiry_type public.inquiry_type not null,
  created_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references public.business_units(id) on delete restrict,
  name text not null,
  channel text,
  start_date date,
  end_date date,
  status public.campaign_status not null default 'draft',
  budget numeric(12,2),
  notes text,
  created_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint campaigns_date_order check (end_date is null or start_date is null or end_date >= start_date),
  constraint campaigns_budget_nonnegative check (budget is null or budget >= 0),
  constraint campaigns_unique_name_per_unit unique (business_unit_id, name)
);

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references public.business_units(id) on delete restrict,
  campaign_id uuid references public.campaigns(id) on delete set null,
  contact_name text,
  client_company_name text,
  email text,
  phone text,
  location text,
  product_interest text,
  status public.lead_status not null default 'new',
  lead_type public.lead_type,
  source text,
  notes text,
  sale_value numeric(12,2),
  created_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint leads_identity_required check (
    nullif(btrim(coalesce(contact_name, '')), '') is not null
    or nullif(btrim(coalesce(client_company_name, '')), '') is not null
  ),
  constraint leads_sale_value_nonnegative check (sale_value is null or sale_value >= 0)
);

create table public.lead_status_history (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  previous_status public.lead_status,
  new_status public.lead_status not null,
  changed_by uuid references public.profiles(id) on delete set null default auth.uid(),
  changed_at timestamptz not null default now()
);

create index inquiries_created_at_idx on public.inquiries(created_at desc);
create index inquiries_unit_created_at_idx on public.inquiries(business_unit_id, created_at desc);
create index inquiries_type_created_at_idx on public.inquiries(inquiry_type, created_at desc);
create index campaigns_unit_status_idx on public.campaigns(business_unit_id, status);
create index leads_created_at_idx on public.leads(created_at desc);
create index leads_unit_created_at_idx on public.leads(business_unit_id, created_at desc);
create index leads_campaign_idx on public.leads(campaign_id);
create index leads_status_idx on public.leads(status);
create index lead_status_history_lead_changed_idx on public.lead_status_history(lead_id, changed_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
create trigger business_units_set_updated_at before update on public.business_units
for each row execute function public.set_updated_at();
create trigger campaigns_set_updated_at before update on public.campaigns
for each row execute function public.set_updated_at();
create trigger leads_set_updated_at before update on public.leads
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.email));
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.capture_lead_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status is distinct from new.status then
    insert into public.lead_status_history (lead_id, previous_status, new_status, changed_by)
    values (new.id, old.status, new.status, auth.uid());
  end if;
  return new;
end;
$$;

create trigger leads_capture_status_change
after update of status on public.leads
for each row execute function public.capture_lead_status_change();

create or replace function public.current_user_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid() and is_active = true;
$$;

alter table public.profiles enable row level security;
alter table public.business_units enable row level security;
alter table public.inquiries enable row level security;
alter table public.campaigns enable row level security;
alter table public.leads enable row level security;
alter table public.lead_status_history enable row level security;

create policy profiles_read_authenticated on public.profiles
for select to authenticated using (true);
create policy profiles_update_admin on public.profiles
for update to authenticated using (public.current_user_role() = 'admin')
with check (public.current_user_role() = 'admin');

create policy business_units_read_authenticated on public.business_units
for select to authenticated using (true);
create policy business_units_admin_insert on public.business_units
for insert to authenticated with check (public.current_user_role() = 'admin');
create policy business_units_admin_update on public.business_units
for update to authenticated using (public.current_user_role() = 'admin')
with check (public.current_user_role() = 'admin');

create policy inquiries_read_authenticated on public.inquiries
for select to authenticated using (true);
create policy inquiries_staff_insert on public.inquiries
for insert to authenticated with check (
  public.current_user_role() in ('admin', 'commercial') and created_by = auth.uid()
);
create policy inquiries_recent_undo_or_admin on public.inquiries
for delete to authenticated using (
  public.current_user_role() = 'admin'
  or (created_by = auth.uid() and created_at >= now() - interval '10 minutes')
);

create policy campaigns_read_authenticated on public.campaigns
for select to authenticated using (true);
create policy campaigns_admin_insert on public.campaigns
for insert to authenticated with check (public.current_user_role() = 'admin' and created_by = auth.uid());
create policy campaigns_admin_update on public.campaigns
for update to authenticated using (public.current_user_role() = 'admin')
with check (public.current_user_role() = 'admin');

create policy leads_read_authenticated on public.leads
for select to authenticated using (true);
create policy leads_staff_insert on public.leads
for insert to authenticated with check (
  public.current_user_role() in ('admin', 'commercial') and created_by = auth.uid()
);
create policy leads_staff_update on public.leads
for update to authenticated using (public.current_user_role() in ('admin', 'commercial'))
with check (public.current_user_role() in ('admin', 'commercial'));
create policy leads_admin_delete on public.leads
for delete to authenticated using (public.current_user_role() = 'admin');

create policy lead_status_history_read_authenticated on public.lead_status_history
for select to authenticated using (true);

-- Después de crear el primer usuario, promoverlo manualmente:
-- update public.profiles set role = 'admin' where id = '<UUID DEL USUARIO>';
