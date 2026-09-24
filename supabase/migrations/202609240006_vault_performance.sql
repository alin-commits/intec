-- Hace que el gestor cargue rápido sin cambiar quién ve qué.
--
-- El problema: las reglas de seguridad llamaban a current_user_roles(),
-- current_user_has_any_role() y vault_category_allows() UNA VEZ POR FILA. Con
-- 613 credenciales eso son miles de consultas a profiles y a la tabla de
-- accesos en cada carga. Envolviéndolas en (select ...) Postgres las calcula
-- una sola vez por consulta, porque pasan a ser un subplan inicial.
--
-- Las condiciones son exactamente las mismas: solo cambia cuántas veces se
-- evalúan. Nadie gana ni pierde acceso con esta migración.

-- ---------- Carpetas que esta persona NO puede ver ----------
-- Antes se preguntaba "¿me deja entrar esta carpeta?" fila a fila. Ahora se
-- pide una sola vez la lista de carpetas vetadas y cada fila solo mira si la
-- suya está en esa lista.
create or replace function public.vault_blocked_categories()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct a.category_id), '{}'::uuid[])
  from public.vault_category_access a
  where not exists (
    select 1 from public.vault_category_access mine
    where mine.category_id = a.category_id and mine.user_id = auth.uid()
  );
$$;
revoke execute on function public.vault_blocked_categories() from public, anon;
grant execute on function public.vault_blocked_categories() to authenticated;

-- ---------- Cuántas credenciales tiene cada carpeta ----------
-- Antes el servidor se traía una fila por credencial solo para contarlas.
-- Ahora las cuenta la propia base de datos y devuelve una fila por carpeta.
-- Es security invoker a propósito: se aplican las reglas de quien pregunta,
-- así que cada uno cuenta solo lo que puede ver.
create or replace function public.vault_folder_counts()
-- Los nombres de salida no repiten los de las columnas a propósito, para que no
-- haya ninguna duda de a qué se refiere cada uno dentro de la función.
returns table (folder_id uuid, folder_total bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select e.category_id, count(*)::bigint
  from public.vault_entries e
  where e.is_active
  group by e.category_id;
$$;
grant execute on function public.vault_folder_counts() to authenticated;

-- ---------- Reglas de lectura y escritura ----------

drop policy if exists vault_entries_read on public.vault_entries;
create policy vault_entries_read on public.vault_entries
for select to authenticated
  using (
    is_active
    and (
      created_by = (select auth.uid())
      or (visibility <> 'personal' and (select public.current_user_has_any_role(ARRAY['vault_admin']::app_role[])))
      or (
        visibility = 'shared'
        and (select public.current_user_roles()) is not null
        -- El casteo a uuid[] es obligatorio: sin él Postgres lee el (select ...)
        -- como una subconsulta y compara uuid con uuid[].
        and (category_id is null or not ((select public.vault_blocked_categories())::uuid[] @> array[category_id]))
      )
      or (visibility = 'restricted' and public.vault_has_permission(id, 'view'))
    )
  );

drop policy if exists vault_entries_insert on public.vault_entries;
create policy vault_entries_insert on public.vault_entries
for insert to authenticated
  with check ((select public.current_user_roles()) is not null and created_by = (select auth.uid()));

drop policy if exists vault_entries_update on public.vault_entries;
create policy vault_entries_update on public.vault_entries
for update to authenticated
  using (
    created_by = (select auth.uid())
    or (visibility <> 'personal' and (select public.current_user_has_any_role(ARRAY['vault_admin']::app_role[])))
    or (visibility <> 'personal' and public.vault_has_permission(id, 'edit'))
  )
  with check (
    created_by = (select auth.uid())
    or (visibility <> 'personal' and (select public.current_user_has_any_role(ARRAY['vault_admin']::app_role[])))
    or (visibility <> 'personal' and public.vault_has_permission(id, 'edit'))
  );

drop policy if exists vault_entries_delete on public.vault_entries;
create policy vault_entries_delete on public.vault_entries
for delete to authenticated
  using (
    created_by = (select auth.uid())
    or (visibility <> 'personal' and (select public.current_user_has_any_role(ARRAY['vault_admin']::app_role[])))
    or (visibility <> 'personal' and public.vault_has_permission(id, 'delete'))
  );

drop policy if exists vault_categories_read on public.vault_categories;
create policy vault_categories_read on public.vault_categories
for select to authenticated
  using ((select public.current_user_roles()) is not null);

drop policy if exists vault_categories_write on public.vault_categories;
create policy vault_categories_write on public.vault_categories
for all to authenticated
  using ((select public.current_user_has_any_role(ARRAY['vault_admin']::app_role[])))
  with check ((select public.current_user_has_any_role(ARRAY['vault_admin']::app_role[])));

drop policy if exists vault_permissions_read on public.vault_permissions;
create policy vault_permissions_read on public.vault_permissions
for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.current_user_has_any_role(ARRAY['vault_admin']::app_role[]))
    or public.vault_entry_owner(vault_entry_id) = (select auth.uid())
  );

drop policy if exists vault_permissions_write on public.vault_permissions;
create policy vault_permissions_write on public.vault_permissions
for all to authenticated
  using (
    (select public.current_user_has_any_role(ARRAY['vault_admin']::app_role[]))
    or public.vault_entry_owner(vault_entry_id) = (select auth.uid())
  )
  with check (
    (select public.current_user_has_any_role(ARRAY['vault_admin']::app_role[]))
    or public.vault_entry_owner(vault_entry_id) = (select auth.uid())
  );

drop policy if exists vault_category_access_read on public.vault_category_access;
create policy vault_category_access_read on public.vault_category_access
for select to authenticated
  using (user_id = (select auth.uid()) or (select public.current_user_has_any_role(ARRAY['vault_admin']::app_role[])));

drop policy if exists vault_audit_log_read on public.vault_audit_log;
create policy vault_audit_log_read on public.vault_audit_log
for select to authenticated
  using ((select public.current_user_has_any_role(ARRAY['vault_admin']::app_role[])));

-- ---------- Índices que faltaban ----------
-- La lista va ordenada por nombre: sin este índice hay que ordenar las 613
-- cada vez. El otro es para la pestaña de favoritas.
create index if not exists vault_entries_name_sort_idx on public.vault_entries (name);
create index if not exists vault_favorites_user_idx on public.vault_favorites (user_id);
