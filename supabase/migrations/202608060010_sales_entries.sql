-- Replaces the single inquiries.sale_value field with a proper sales log.
-- Commercial sales are tracked in 3 categories (oferta/seguimiento/pedido),
-- each in euros, and can be logged either against a specific consulta in
-- real time, or as a weekly bulk total when staff log a batch at week's end.

create table public.sales_entries (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references public.business_units(id) on delete restrict,
  sale_type text not null check (sale_type in ('oferta', 'seguimiento', 'pedido')),
  entry_mode text not null check (entry_mode in ('inquiry', 'weekly')),
  inquiry_id uuid references public.inquiries(id) on delete set null,
  week_start date,
  occurred_on date not null,
  count integer not null default 1 check (count >= 1),
  value numeric(12, 2) not null check (value >= 0),
  notes text,
  created_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sales_entries_mode_shape check (
    (entry_mode = 'inquiry' and inquiry_id is not null and week_start is null and count = 1)
    or
    (entry_mode = 'weekly' and week_start is not null and inquiry_id is null)
  )
);

create index sales_entries_business_unit_occurred_idx on public.sales_entries(business_unit_id, occurred_on);
create index sales_entries_occurred_idx on public.sales_entries(occurred_on);
create index sales_entries_inquiry_idx on public.sales_entries(inquiry_id) where inquiry_id is not null;
create index sales_entries_created_by_created_at_idx on public.sales_entries(created_by, created_at desc);

create trigger sales_entries_set_updated_at before update on public.sales_entries
for each row execute function public.set_updated_at();

alter table public.sales_entries enable row level security;

create policy sales_entries_read_authenticated on public.sales_entries
for select to authenticated using (true);

create policy sales_entries_staff_insert on public.sales_entries
for insert to authenticated with check (
  current_user_role() = ANY (ARRAY['admin'::app_role, 'commercial'::app_role])
  and created_by = (select auth.uid())
);

create policy sales_entries_staff_update on public.sales_entries
for update to authenticated
  using (current_user_role() = ANY (ARRAY['admin'::app_role, 'commercial'::app_role]))
  with check (current_user_role() = ANY (ARRAY['admin'::app_role, 'commercial'::app_role]));

create policy sales_entries_recent_undo_or_admin on public.sales_entries
for delete to authenticated using (
  current_user_role() = 'admin'
  or (created_by = (select auth.uid()) and created_at >= now() - interval '10 minutes')
);

-- Carry forward any existing per-consulta sale values (previous single-field
-- model) as 'pedido' entries so historical revenue reporting keeps working.
insert into public.sales_entries (business_unit_id, sale_type, entry_mode, inquiry_id, occurred_on, count, value, created_by)
select business_unit_id, 'pedido', 'inquiry', id, created_at::date, 1, sale_value, created_by
from public.inquiries
where sale_value is not null and sale_value > 0;

alter table public.inquiries drop column sale_value;
