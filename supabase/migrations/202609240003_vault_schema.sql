-- Password vault: encrypted credentials, sharing rules, permissions and audit log.
-- Run 202609240002_vault_roles.sql first (it adds the new app_role values).
--
-- Secrets are encrypted with AES-256-GCM by the server (VAULT_ENCRYPTION_KEY) and
-- never decrypted in the database. RLS is a second line of defence: every
-- sensitive operation also goes through a server-side check in /api/vault/*.
-- On top of RLS, the ciphertext columns are removed from the `authenticated`
-- grants, so a leaked anon key cannot read them at all.

-- ---------- Categories ----------

create table if not exists public.vault_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(trim(name)) between 1 and 60),
  description text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

insert into public.vault_categories (name, description, sort_order) values
  ('Microsoft 365', 'Cuentas y servicios de Microsoft', 10),
  ('Web y CMS', 'WordPress, Prestashop y webs propias', 20),
  ('Hosting y dominios', 'Paneles de hosting, dominios y DNS', 30),
  ('Correo', 'Buzones, IMAP/SMTP y alias', 40),
  ('ERP y gestión', 'SAGE y software de gestión', 50),
  ('Servidores y NAS', 'Servidores, NAS y acceso remoto', 60),
  ('Red y routers', 'Routers, wifi y electrónica de red', 70),
  ('Proveedores', 'Portales y extranets de proveedores', 80),
  ('Marketing y RRSS', 'Herramientas de marketing y redes sociales', 90),
  ('FTP y APIs', 'Accesos técnicos, FTP/SFTP y claves de API', 100),
  ('Bancos', 'Banca y medios de pago', 110),
  ('Otros', 'Sin clasificar', 120)
on conflict (name) do nothing;

-- ---------- Entries ----------

create table if not exists public.vault_entries (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 160),
  url text,
  username text,
  -- AES-256-GCM, base64. Never readable by the `authenticated` role (see grants below).
  password_ciphertext text not null,
  password_iv text not null,
  password_tag text not null,
  notes_ciphertext text,
  notes_iv text,
  notes_tag text,
  -- Lets the UI show "has notes" without reading the ciphertext.
  has_notes boolean generated always as (notes_ciphertext is not null) stored,
  category_id uuid references public.vault_categories(id) on delete set null,
  business_unit_id uuid references public.business_units(id) on delete set null,
  -- shared: everyone with vault access · personal: only its owner · restricted: only vault_permissions
  visibility text not null default 'shared' check (visibility in ('shared', 'personal', 'restricted')),
  entry_type text not null default 'plain' check (entry_type in ('plain', 'email', 'server', 'bank', 'other')),
  tags text[] not null default '{}',
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_password_change_at timestamptz not null default now(),
  is_active boolean not null default true,
  encryption_version smallint not null default 1,
  -- Where a migrated entry came from, to trace the import.
  legacy_source text,
  legacy_id text
);

create index if not exists vault_entries_created_by_idx on public.vault_entries (created_by);
create index if not exists vault_entries_category_idx on public.vault_entries (category_id);
create index if not exists vault_entries_visibility_idx on public.vault_entries (is_active, visibility);
create index if not exists vault_entries_name_idx on public.vault_entries (lower(name));

drop trigger if exists vault_entries_set_updated_at on public.vault_entries;
create trigger vault_entries_set_updated_at before update on public.vault_entries
for each row execute function public.set_updated_at();

-- ---------- Per-entry permissions (used by 'restricted' entries) ----------

create table if not exists public.vault_permissions (
  id uuid primary key default gen_random_uuid(),
  vault_entry_id uuid not null references public.vault_entries(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  can_view boolean not null default true,
  can_edit boolean not null default false,
  can_delete boolean not null default false,
  can_manage_permissions boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  unique (vault_entry_id, user_id)
);
create index if not exists vault_permissions_user_idx on public.vault_permissions (user_id);

-- ---------- Audit log ----------

create table if not exists public.vault_audit_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  vault_entry_id uuid references public.vault_entries(id) on delete set null,
  -- Kept so the log still makes sense after an entry is deleted. Never a secret.
  entry_name text,
  action text not null check (action in (
    'VAULT_OPEN', 'VAULT_UNLOCK_FAILED', 'ENTRY_LIST', 'ENTRY_VIEW', 'PASSWORD_REVEAL', 'PASSWORD_COPY',
    'ENTRY_CREATE', 'ENTRY_UPDATE', 'ENTRY_DELETE', 'PERMISSION_ADD', 'PERMISSION_REMOVE', 'IMPORT'
  )),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists vault_audit_log_created_idx on public.vault_audit_log (created_at desc);
create index if not exists vault_audit_log_user_idx on public.vault_audit_log (user_id, created_at desc);
create index if not exists vault_audit_log_entry_idx on public.vault_audit_log (vault_entry_id, created_at desc);

-- ---------- Row level security ----------

alter table public.vault_categories enable row level security;
alter table public.vault_entries enable row level security;
alter table public.vault_permissions enable row level security;
alter table public.vault_audit_log enable row level security;

-- Categories: readable by any active user; only vault admins change them.
drop policy if exists vault_categories_read on public.vault_categories;
create policy vault_categories_read on public.vault_categories
for select to authenticated
  using (public.current_user_roles() is not null);

drop policy if exists vault_categories_write on public.vault_categories;
create policy vault_categories_write on public.vault_categories
for all to authenticated
  using (public.current_user_has_any_role(ARRAY['vault_admin']::app_role[]))
  with check (public.current_user_has_any_role(ARRAY['vault_admin']::app_role[]));

-- Entries: shared ones for everybody with vault access, personal ones only for
-- their owner (not even vault admins), restricted ones only through permissions.
drop policy if exists vault_entries_read on public.vault_entries;
create policy vault_entries_read on public.vault_entries
for select to authenticated
  using (
    is_active
    and (
      (visibility = 'shared' and public.current_user_roles() is not null)
      or created_by = (select auth.uid())
      or (visibility <> 'personal' and public.current_user_has_any_role(ARRAY['vault_admin']::app_role[]))
      or exists (
        select 1 from public.vault_permissions p
        where p.vault_entry_id = vault_entries.id and p.user_id = (select auth.uid()) and p.can_view
      )
    )
  );

drop policy if exists vault_entries_insert on public.vault_entries;
create policy vault_entries_insert on public.vault_entries
for insert to authenticated
  with check (public.current_user_roles() is not null and created_by = (select auth.uid()));

drop policy if exists vault_entries_update on public.vault_entries;
create policy vault_entries_update on public.vault_entries
for update to authenticated
  using (
    created_by = (select auth.uid())
    or (visibility <> 'personal' and public.current_user_has_any_role(ARRAY['vault_admin']::app_role[]))
    or exists (select 1 from public.vault_permissions p where p.vault_entry_id = vault_entries.id and p.user_id = (select auth.uid()) and p.can_edit)
  )
  with check (
    created_by = (select auth.uid())
    or (visibility <> 'personal' and public.current_user_has_any_role(ARRAY['vault_admin']::app_role[]))
    or exists (select 1 from public.vault_permissions p where p.vault_entry_id = vault_entries.id and p.user_id = (select auth.uid()) and p.can_edit)
  );

drop policy if exists vault_entries_delete on public.vault_entries;
create policy vault_entries_delete on public.vault_entries
for delete to authenticated
  using (
    created_by = (select auth.uid())
    or (visibility <> 'personal' and public.current_user_has_any_role(ARRAY['vault_admin']::app_role[]))
    or exists (select 1 from public.vault_permissions p where p.vault_entry_id = vault_entries.id and p.user_id = (select auth.uid()) and p.can_delete)
  );

-- Permissions: you can see your own access and the access to entries you own or manage.
drop policy if exists vault_permissions_read on public.vault_permissions;
create policy vault_permissions_read on public.vault_permissions
for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.current_user_has_any_role(ARRAY['vault_admin']::app_role[])
    or exists (select 1 from public.vault_entries e where e.id = vault_permissions.vault_entry_id and e.created_by = (select auth.uid()))
  );

-- Granting access is limited to vault admins and the entry's owner; the server
-- checks this again and writes an audit entry for every change.
drop policy if exists vault_permissions_write on public.vault_permissions;
create policy vault_permissions_write on public.vault_permissions
for all to authenticated
  using (
    public.current_user_has_any_role(ARRAY['vault_admin']::app_role[])
    or exists (select 1 from public.vault_entries e where e.id = vault_permissions.vault_entry_id and e.created_by = (select auth.uid()))
  )
  with check (
    public.current_user_has_any_role(ARRAY['vault_admin']::app_role[])
    or exists (select 1 from public.vault_entries e where e.id = vault_permissions.vault_entry_id and e.created_by = (select auth.uid()))
  );

-- Audit log: only vault admins read it. Nobody writes it from the client:
-- entries are inserted server-side with the service role.
drop policy if exists vault_audit_log_read on public.vault_audit_log;
create policy vault_audit_log_read on public.vault_audit_log
for select to authenticated
  using (public.current_user_has_any_role(ARRAY['vault_admin']::app_role[]));

-- ---------- Column privileges: the ciphertext never leaves the server ----------

-- Listing is read directly (metadata only); every write and every decryption
-- happens server-side with the service role, so `authenticated` gets no write
-- privileges here. The policies above stay as a second layer in case that changes.
revoke all on public.vault_entries from authenticated, anon;
grant select (
  id, name, url, username, has_notes, category_id, business_unit_id, visibility, entry_type, tags,
  created_by, created_at, updated_at, last_password_change_at, is_active, encryption_version, legacy_source, legacy_id
) on public.vault_entries to authenticated;

revoke all on public.vault_permissions from authenticated, anon;
grant select on public.vault_permissions to authenticated;

revoke all on public.vault_audit_log from authenticated, anon;
grant select on public.vault_audit_log to authenticated;
