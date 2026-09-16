-- Scopes "commercial" users to their assigned business units in Consultas
-- and Ventas (sales_entries) only — CRM/leads/campaigns stay shared across
-- all comerciales. Also lifts the "direction is exclusive" constraint added
-- in 202608070002_multi_role_support.sql: direction can now combine with
-- other roles, getting the combined role's own privileges (including this
-- unit restriction when combined with commercial) plus direction's
-- read-everything behavior only where the combined role doesn't already
-- define something narrower.

create table public.profile_business_units (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  business_unit_id uuid not null references public.business_units(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (profile_id, business_unit_id)
);
create index profile_business_units_unit_idx on public.profile_business_units (business_unit_id);
alter table public.profile_business_units enable row level security;

create policy profile_business_units_select on public.profile_business_units
for select to authenticated
  using (profile_id = (select auth.uid()) or public.current_user_has_any_role(ARRAY['admin']::app_role[]));

create policy profile_business_units_admin_write on public.profile_business_units
for all to authenticated
  using (public.current_user_has_any_role(ARRAY['admin']::app_role[]))
  with check (public.current_user_has_any_role(ARRAY['admin']::app_role[]));

create or replace function public.current_user_business_units()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(business_unit_id), '{}')
  from public.profile_business_units where profile_id = auth.uid();
$$;

create or replace function public.current_user_can_access_unit(unit_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.current_user_has_any_role(ARRAY['admin','viewer']::app_role[])
    or (
      public.current_user_has_any_role(ARRAY['commercial']::app_role[])
      and unit_id = any(public.current_user_business_units())
    )
    or (
      public.current_user_has_any_role(ARRAY['direction']::app_role[])
      and not public.current_user_has_any_role(ARRAY['commercial']::app_role[])
    );
$$;

revoke execute on function public.current_user_business_units() from public, anon;
revoke execute on function public.current_user_can_access_unit(uuid) from public, anon;

-- inquiries: add unit scoping on top of the existing role checks
drop policy inquiries_read_authenticated on public.inquiries;
create policy inquiries_read_authenticated on public.inquiries
for select to authenticated
  using (public.current_user_can_access_unit(business_unit_id));

drop policy inquiries_staff_insert on public.inquiries;
create policy inquiries_staff_insert on public.inquiries
for insert to authenticated
  with check (
    public.current_user_has_any_role(ARRAY['admin','commercial']::app_role[])
    and created_by = (select auth.uid())
    and public.current_user_can_access_unit(business_unit_id)
  );

drop policy inquiries_staff_update on public.inquiries;
create policy inquiries_staff_update on public.inquiries
for update to authenticated
  using (public.current_user_has_any_role(ARRAY['admin','commercial']::app_role[]) and public.current_user_can_access_unit(business_unit_id))
  with check (public.current_user_has_any_role(ARRAY['admin','commercial']::app_role[]) and public.current_user_can_access_unit(business_unit_id));

-- sales_entries: same scoping, same reasoning (registered from the same page)
drop policy sales_entries_read_authenticated on public.sales_entries;
create policy sales_entries_read_authenticated on public.sales_entries
for select to authenticated
  using (public.current_user_can_access_unit(business_unit_id));

drop policy sales_entries_staff_insert on public.sales_entries;
create policy sales_entries_staff_insert on public.sales_entries
for insert to authenticated
  with check (
    public.current_user_has_any_role(ARRAY['admin','commercial']::app_role[])
    and created_by = (select auth.uid())
    and public.current_user_can_access_unit(business_unit_id)
  );

drop policy sales_entries_staff_update on public.sales_entries;
create policy sales_entries_staff_update on public.sales_entries
for update to authenticated
  using (public.current_user_has_any_role(ARRAY['admin','commercial']::app_role[]) and public.current_user_can_access_unit(business_unit_id))
  with check (public.current_user_has_any_role(ARRAY['admin','commercial']::app_role[]) and public.current_user_can_access_unit(business_unit_id));

-- Direction can now combine with other roles.
alter table public.profiles drop constraint profiles_roles_direction_exclusive;
