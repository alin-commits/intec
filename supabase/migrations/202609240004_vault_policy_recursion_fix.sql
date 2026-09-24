-- Fixes "infinite recursion detected in policy": the policy on vault_entries
-- queried vault_permissions, whose own policy queried vault_entries back.
-- The lookups now live in security-definer helpers, which are not subject to
-- RLS themselves, so each policy answers without calling the other one.

create or replace function public.vault_has_permission(entry_id uuid, permission text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select case permission
      when 'view' then p.can_view
      when 'edit' then p.can_edit
      when 'delete' then p.can_delete
      when 'manage' then p.can_manage_permissions
      else false
    end
    from public.vault_permissions p
    where p.vault_entry_id = entry_id and p.user_id = auth.uid()
  ), false);
$$;
revoke execute on function public.vault_has_permission(uuid, text) from public, anon;
grant execute on function public.vault_has_permission(uuid, text) to authenticated;

create or replace function public.vault_entry_owner(entry_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select e.created_by from public.vault_entries e where e.id = entry_id;
$$;
revoke execute on function public.vault_entry_owner(uuid) from public, anon;
grant execute on function public.vault_entry_owner(uuid) to authenticated;

create or replace function public.vault_entry_visibility(entry_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select e.visibility from public.vault_entries e where e.id = entry_id;
$$;
revoke execute on function public.vault_entry_visibility(uuid) from public, anon;
grant execute on function public.vault_entry_visibility(uuid) to authenticated;

-- ---------- Entries ----------

drop policy if exists vault_entries_read on public.vault_entries;
create policy vault_entries_read on public.vault_entries
for select to authenticated
  using (
    is_active
    and (
      (visibility = 'shared' and public.current_user_roles() is not null)
      or created_by = (select auth.uid())
      or (visibility <> 'personal' and public.current_user_has_any_role(ARRAY['vault_admin']::app_role[]))
      or (visibility = 'restricted' and public.vault_has_permission(id, 'view'))
    )
  );

drop policy if exists vault_entries_update on public.vault_entries;
create policy vault_entries_update on public.vault_entries
for update to authenticated
  using (
    created_by = (select auth.uid())
    or (visibility <> 'personal' and public.current_user_has_any_role(ARRAY['vault_admin']::app_role[]))
    or (visibility <> 'personal' and public.vault_has_permission(id, 'edit'))
  )
  with check (
    created_by = (select auth.uid())
    or (visibility <> 'personal' and public.current_user_has_any_role(ARRAY['vault_admin']::app_role[]))
    or (visibility <> 'personal' and public.vault_has_permission(id, 'edit'))
  );

drop policy if exists vault_entries_delete on public.vault_entries;
create policy vault_entries_delete on public.vault_entries
for delete to authenticated
  using (
    created_by = (select auth.uid())
    or (visibility <> 'personal' and public.current_user_has_any_role(ARRAY['vault_admin']::app_role[]))
    or (visibility <> 'personal' and public.vault_has_permission(id, 'delete'))
  );

-- ---------- Permissions ----------

drop policy if exists vault_permissions_read on public.vault_permissions;
create policy vault_permissions_read on public.vault_permissions
for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.current_user_has_any_role(ARRAY['vault_admin']::app_role[])
    or public.vault_entry_owner(vault_entry_id) = (select auth.uid())
  );

drop policy if exists vault_permissions_write on public.vault_permissions;
create policy vault_permissions_write on public.vault_permissions
for all to authenticated
  using (
    public.current_user_has_any_role(ARRAY['vault_admin']::app_role[])
    or public.vault_entry_owner(vault_entry_id) = (select auth.uid())
  )
  with check (
    public.current_user_has_any_role(ARRAY['vault_admin']::app_role[])
    or public.vault_entry_owner(vault_entry_id) = (select auth.uid())
  );
