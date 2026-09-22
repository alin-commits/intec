-- Marketing invoices: uploaded PDFs (read with AI, confirmed by a person) that
-- count towards the department's spending. An invoice linked to a subscription
-- (expense_id) is kept for the record but not added again to the totals.

create table if not exists public.marketing_invoices (
  id uuid primary key default gen_random_uuid(),
  supplier text not null check (char_length(trim(supplier)) between 1 and 160),
  invoice_number text,
  concept text,
  invoice_date date not null,
  base_amount numeric(12, 2) not null check (base_amount >= 0),
  vat_amount numeric(12, 2) not null default 0 check (vat_amount >= 0),
  total_amount numeric(12, 2) not null check (total_amount >= 0),
  category text not null default 'other'
    check (category in ('software', 'advertising', 'design', 'events', 'print', 'services', 'other')),
  business_unit_id uuid references public.business_units(id) on delete set null,
  expense_id uuid references public.marketing_expenses(id) on delete set null,
  file_path text,
  file_name text,
  notes text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists marketing_invoices_date_idx on public.marketing_invoices (invoice_date);

drop trigger if exists marketing_invoices_set_updated_at on public.marketing_invoices;
create trigger marketing_invoices_set_updated_at before update on public.marketing_invoices
for each row execute function public.set_updated_at();

alter table public.marketing_invoices enable row level security;

drop policy if exists marketing_invoices_read on public.marketing_invoices;
create policy marketing_invoices_read on public.marketing_invoices
for select to authenticated
  using (public.current_user_has_any_role(ARRAY['admin','marketing','direction']::app_role[]));

drop policy if exists marketing_invoices_insert on public.marketing_invoices;
create policy marketing_invoices_insert on public.marketing_invoices
for insert to authenticated
  with check (public.current_user_has_any_role(ARRAY['admin','marketing']::app_role[]));

drop policy if exists marketing_invoices_update on public.marketing_invoices;
create policy marketing_invoices_update on public.marketing_invoices
for update to authenticated
  using (public.current_user_has_any_role(ARRAY['admin','marketing']::app_role[]))
  with check (public.current_user_has_any_role(ARRAY['admin','marketing']::app_role[]));

drop policy if exists marketing_invoices_delete on public.marketing_invoices;
create policy marketing_invoices_delete on public.marketing_invoices
for delete to authenticated
  using (public.current_user_has_any_role(ARRAY['admin','marketing']::app_role[]));

-- Private bucket for the PDFs (max 10 MB, PDF only). Files are opened through
-- short-lived signed URLs, never public links.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('marketing-invoices', 'marketing-invoices', false, 10485760, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists marketing_invoice_files_read on storage.objects;
create policy marketing_invoice_files_read on storage.objects
for select to authenticated
  using (bucket_id = 'marketing-invoices' and public.current_user_has_any_role(ARRAY['admin','marketing','direction']::app_role[]));

drop policy if exists marketing_invoice_files_insert on storage.objects;
create policy marketing_invoice_files_insert on storage.objects
for insert to authenticated
  with check (bucket_id = 'marketing-invoices' and public.current_user_has_any_role(ARRAY['admin','marketing']::app_role[]));

drop policy if exists marketing_invoice_files_delete on storage.objects;
create policy marketing_invoice_files_delete on storage.objects
for delete to authenticated
  using (bucket_id = 'marketing-invoices' and public.current_user_has_any_role(ARRAY['admin','marketing']::app_role[]));
