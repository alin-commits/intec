-- Weekly bulk-entry support for inquiries, mirroring the existing sales_entries pattern.
alter table public.inquiries
  add column entry_mode text not null default 'single',
  add column week_start date,
  add column count integer not null default 1;

alter table public.inquiries
  add constraint inquiries_entry_mode_check check (entry_mode in ('single', 'weekly'));

alter table public.inquiries
  add constraint inquiries_count_check check (count >= 1);

alter table public.inquiries
  add constraint inquiries_mode_shape check (
    (entry_mode = 'single' and week_start is null and count = 1)
    or (entry_mode = 'weekly' and week_start is not null)
  );

-- Only force created_at to now() for individual real-time submissions (anti-backdating);
-- weekly bulk catch-up entries may set an explicit past date, like sales_entries already allows.
create or replace function public.force_created_at()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.entry_mode = 'single' then
    new.created_at = now();
  end if;
  return new;
end;
$$;

-- Add "perdido" (lost quote) as a sale type, alongside oferta/seguimiento/pedido.
alter table public.sales_entries drop constraint sales_entries_sale_type_check;
alter table public.sales_entries add constraint sales_entries_sale_type_check check (sale_type in ('oferta', 'seguimiento', 'pedido', 'perdido'));
