-- Marketing department spending: recurring subscriptions (apps, tools) and
-- one-off expenses (fairs, printing...). Admin and marketing manage it;
-- dirección can read it.

create table if not exists public.marketing_expenses (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 120),
  provider text,
  category text not null default 'software'
    check (category in ('software', 'advertising', 'design', 'events', 'print', 'services', 'other')),
  kind text not null default 'subscription' check (kind in ('subscription', 'one_off')),
  -- Price charged each period (subscriptions) or the total (one-off), in euros.
  amount numeric(12, 2) not null check (amount >= 0),
  billing_period text check (billing_period in ('monthly', 'quarterly', 'yearly')),
  -- Subscriptions: first charge date (renewals are counted from it). One-off: date of the expense.
  start_date date not null,
  status text not null default 'active' check (status in ('active', 'cancelled')),
  cancelled_on date,
  business_unit_id uuid references public.business_units(id) on delete set null,
  payment_method text,
  url text,
  notes text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint marketing_expenses_period_matches_kind check (
    (kind = 'subscription' and billing_period is not null) or (kind = 'one_off' and billing_period is null)
  )
);
create index if not exists marketing_expenses_start_date_idx on public.marketing_expenses (start_date);

drop trigger if exists marketing_expenses_set_updated_at on public.marketing_expenses;
create trigger marketing_expenses_set_updated_at before update on public.marketing_expenses
for each row execute function public.set_updated_at();

alter table public.marketing_expenses enable row level security;

drop policy if exists marketing_expenses_read on public.marketing_expenses;
create policy marketing_expenses_read on public.marketing_expenses
for select to authenticated
  using (public.current_user_has_any_role(ARRAY['admin','marketing','direction']::app_role[]));

drop policy if exists marketing_expenses_insert on public.marketing_expenses;
create policy marketing_expenses_insert on public.marketing_expenses
for insert to authenticated
  with check (public.current_user_has_any_role(ARRAY['admin','marketing']::app_role[]));

drop policy if exists marketing_expenses_update on public.marketing_expenses;
create policy marketing_expenses_update on public.marketing_expenses
for update to authenticated
  using (public.current_user_has_any_role(ARRAY['admin','marketing']::app_role[]))
  with check (public.current_user_has_any_role(ARRAY['admin','marketing']::app_role[]));

drop policy if exists marketing_expenses_delete on public.marketing_expenses;
create policy marketing_expenses_delete on public.marketing_expenses
for delete to authenticated
  using (public.current_user_has_any_role(ARRAY['admin','marketing']::app_role[]));
