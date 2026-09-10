-- Virtual business cards: one per employee, tied to a business unit for its
-- logo, with a public (no-login) page reached via a unique slug. Managed
-- only by admin/marketing/it (mirrors the RRSS/campaigns staff pattern).

create table public.business_cards (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references public.business_units(id) on delete restrict,
  slug text not null unique,
  full_name text not null,
  position text not null,
  phone text,
  email text,
  website text,
  company_address text,
  instagram_url text,
  facebook_url text,
  linkedin_url text,
  primary_color text not null default '#2563eb' check (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  is_active boolean not null default true,
  created_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index business_cards_unit_idx on public.business_cards(business_unit_id);

create trigger business_cards_set_updated_at before update on public.business_cards
  for each row execute function public.set_updated_at();

alter table public.business_cards enable row level security;

-- Public card page needs anonymous read access (no session). Scoped to
-- active cards only; every column here is already meant to be public-facing.
create policy business_cards_public_select on public.business_cards
for select to anon, authenticated using (is_active = true);

create policy business_cards_staff_insert on public.business_cards
for insert to authenticated with check (
  public.current_user_has_any_role(ARRAY['admin','marketing','it']::app_role[])
  and created_by = (select auth.uid())
);

create policy business_cards_staff_update on public.business_cards
for update to authenticated
  using (public.current_user_has_any_role(ARRAY['admin','marketing','it']::app_role[]))
  with check (public.current_user_has_any_role(ARRAY['admin','marketing','it']::app_role[]));

create policy business_cards_staff_delete on public.business_cards
for delete to authenticated using (
  public.current_user_has_any_role(ARRAY['admin','marketing','it']::app_role[])
);
