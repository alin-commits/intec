-- Usability for a vault with hundreds of credentials: favourites, a health
-- check (reused or weak passwords) and access per folder instead of per entry.

-- ---------- Health: fingerprint and strength ----------
-- The fingerprint is a keyed hash of the password, computed on the server. It
-- reveals nothing by itself, but two identical passwords share it, which is
-- what lets the app warn about reuse without ever storing anything readable.
alter table public.vault_entries add column if not exists password_fingerprint text;
alter table public.vault_entries add column if not exists password_strength text
  check (password_strength is null or password_strength in ('weak', 'fair', 'strong'));
create index if not exists vault_entries_fingerprint_idx on public.vault_entries (password_fingerprint);

grant select (password_strength) on public.vault_entries to authenticated;

-- ---------- Favourites ----------

create table if not exists public.vault_favorites (
  user_id uuid not null references public.profiles(id) on delete cascade,
  vault_entry_id uuid not null references public.vault_entries(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, vault_entry_id)
);
alter table public.vault_favorites enable row level security;

-- Favourites are not secrets and only ever belong to one person, so the client
-- may write its own rows directly.
drop policy if exists vault_favorites_own on public.vault_favorites;
create policy vault_favorites_own on public.vault_favorites
for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
grant select, insert, delete on public.vault_favorites to authenticated;

-- ---------- Access per folder ----------
-- A folder with no rows here is open to everyone with vault access. As soon as
-- it has one, only the listed people (and vault admins) can see what is inside.

create table if not exists public.vault_category_access (
  category_id uuid not null references public.vault_categories(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  primary key (category_id, user_id)
);
alter table public.vault_category_access enable row level security;

drop policy if exists vault_category_access_read on public.vault_category_access;
create policy vault_category_access_read on public.vault_category_access
for select to authenticated
  using (user_id = (select auth.uid()) or public.current_user_has_any_role(ARRAY['vault_admin']::app_role[]));
grant select on public.vault_category_access to authenticated;

/** True when the folder is open to everyone, or the caller is on its list. */
create or replace function public.vault_category_allows(category uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when category is null then true
    when not exists (select 1 from public.vault_category_access a where a.category_id = category) then true
    else exists (select 1 from public.vault_category_access a where a.category_id = category and a.user_id = auth.uid())
  end;
$$;
revoke execute on function public.vault_category_allows(uuid) from public, anon;
grant execute on function public.vault_category_allows(uuid) to authenticated;

-- Shared entries now also respect their folder's access list.
drop policy if exists vault_entries_read on public.vault_entries;
create policy vault_entries_read on public.vault_entries
for select to authenticated
  using (
    is_active
    and (
      created_by = (select auth.uid())
      or (visibility <> 'personal' and public.current_user_has_any_role(ARRAY['vault_admin']::app_role[]))
      or (visibility = 'shared' and public.current_user_roles() is not null and public.vault_category_allows(category_id))
      or (visibility = 'restricted' and public.vault_has_permission(id, 'view'))
    )
  );
