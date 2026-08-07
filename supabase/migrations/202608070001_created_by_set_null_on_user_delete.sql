-- Commercial data (consultas, leads, campañas, ventas) is shared across the
-- whole team, not siloed per user — so deleting a user account must never be
-- blocked by their historical records. Switches created_by from ON DELETE
-- RESTRICT to ON DELETE SET NULL (and makes the column nullable) so the
-- records survive with the attribution simply cleared.

alter table public.inquiries alter column created_by drop not null;
alter table public.inquiries drop constraint inquiries_created_by_fkey;
alter table public.inquiries add constraint inquiries_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;

alter table public.leads alter column created_by drop not null;
alter table public.leads drop constraint leads_created_by_fkey;
alter table public.leads add constraint leads_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;

alter table public.campaigns alter column created_by drop not null;
alter table public.campaigns drop constraint campaigns_created_by_fkey;
alter table public.campaigns add constraint campaigns_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;

alter table public.sales_entries alter column created_by drop not null;
alter table public.sales_entries drop constraint sales_entries_created_by_fkey;
alter table public.sales_entries add constraint sales_entries_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;
