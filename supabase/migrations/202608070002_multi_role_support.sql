-- Lets a user hold several roles at once (e.g. marketing + it), getting the
-- union of nav/permissions from all of them. Dirección stays exclusive: it's
-- a read-only department-preview mode, not a real operational role, so it
-- can never combine with anything else.

alter table public.profiles add column roles app_role[] not null default '{}';
update public.profiles set roles = ARRAY[role];
-- Keeps the same default the old `role` column had (`viewer`), since
-- handle_new_user() inserts profiles without specifying a role at all.
alter table public.profiles alter column roles set default ARRAY['viewer']::app_role[];
alter table public.profiles add constraint profiles_roles_not_empty check (array_length(roles, 1) >= 1);
alter table public.profiles add constraint profiles_roles_direction_exclusive
  check (not ('direction' = ANY (roles)) or array_length(roles, 1) = 1);

create or replace function public.current_user_roles()
returns app_role[]
language sql
stable
security definer
set search_path = public
as $$
  select roles from public.profiles where id = auth.uid() and is_active = true;
$$;

create or replace function public.current_user_has_any_role(check_roles app_role[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_user_roles() && check_roles, false);
$$;

-- profiles
drop policy profiles_update_admin on public.profiles;
create policy profiles_update_admin on public.profiles
for update to authenticated
  using (public.current_user_has_any_role(ARRAY['admin']::app_role[]))
  with check (public.current_user_has_any_role(ARRAY['admin']::app_role[]));

-- business_units
drop policy business_units_admin_insert on public.business_units;
create policy business_units_admin_insert on public.business_units
for insert to authenticated
  with check (public.current_user_has_any_role(ARRAY['admin']::app_role[]));

drop policy business_units_admin_update on public.business_units;
create policy business_units_admin_update on public.business_units
for update to authenticated
  using (public.current_user_has_any_role(ARRAY['admin']::app_role[]))
  with check (public.current_user_has_any_role(ARRAY['admin']::app_role[]));

-- inquiries
drop policy inquiries_staff_insert on public.inquiries;
create policy inquiries_staff_insert on public.inquiries
for insert to authenticated
  with check (public.current_user_has_any_role(ARRAY['admin','commercial']::app_role[]) and created_by = (select auth.uid()));

drop policy inquiries_staff_update on public.inquiries;
create policy inquiries_staff_update on public.inquiries
for update to authenticated
  using (public.current_user_has_any_role(ARRAY['admin','commercial']::app_role[]))
  with check (public.current_user_has_any_role(ARRAY['admin','commercial']::app_role[]));

drop policy inquiries_recent_undo_or_admin on public.inquiries;
create policy inquiries_recent_undo_or_admin on public.inquiries
for delete to authenticated
  using (public.current_user_has_any_role(ARRAY['admin']::app_role[]) or (created_by = (select auth.uid()) and created_at >= now() - interval '10 minutes'));

-- leads
drop policy leads_admin_delete on public.leads;
create policy leads_admin_delete on public.leads
for delete to authenticated
  using (public.current_user_has_any_role(ARRAY['admin']::app_role[]));

drop policy leads_staff_insert on public.leads;
create policy leads_staff_insert on public.leads
for insert to authenticated
  with check (public.current_user_has_any_role(ARRAY['admin','commercial','marketing']::app_role[]) and created_by = (select auth.uid()));

drop policy leads_staff_update on public.leads;
create policy leads_staff_update on public.leads
for update to authenticated
  using (public.current_user_has_any_role(ARRAY['admin','commercial','marketing']::app_role[]))
  with check (public.current_user_has_any_role(ARRAY['admin','commercial','marketing']::app_role[]));

-- campaigns
drop policy campaigns_staff_insert on public.campaigns;
create policy campaigns_staff_insert on public.campaigns
for insert to authenticated
  with check (public.current_user_has_any_role(ARRAY['admin','marketing']::app_role[]) and created_by = (select auth.uid()));

drop policy campaigns_staff_update on public.campaigns;
create policy campaigns_staff_update on public.campaigns
for update to authenticated
  using (public.current_user_has_any_role(ARRAY['admin','marketing']::app_role[]))
  with check (public.current_user_has_any_role(ARRAY['admin','marketing']::app_role[]));

-- sales_entries
drop policy sales_entries_staff_insert on public.sales_entries;
create policy sales_entries_staff_insert on public.sales_entries
for insert to authenticated
  with check (public.current_user_has_any_role(ARRAY['admin','commercial']::app_role[]) and created_by = (select auth.uid()));

drop policy sales_entries_staff_update on public.sales_entries;
create policy sales_entries_staff_update on public.sales_entries
for update to authenticated
  using (public.current_user_has_any_role(ARRAY['admin','commercial']::app_role[]))
  with check (public.current_user_has_any_role(ARRAY['admin','commercial']::app_role[]));

drop policy sales_entries_recent_undo_or_admin on public.sales_entries;
create policy sales_entries_recent_undo_or_admin on public.sales_entries
for delete to authenticated
  using (public.current_user_has_any_role(ARRAY['admin']::app_role[]) or (created_by = (select auth.uid()) and created_at >= now() - interval '10 minutes'));

-- tickets
drop policy tickets_admin_select on public.tickets;
create policy tickets_admin_select on public.tickets
for select to authenticated
  using (public.current_user_has_any_role(ARRAY['admin','it','direction']::app_role[]));

drop policy tickets_admin_update on public.tickets;
create policy tickets_admin_update on public.tickets
for update to authenticated
  using (public.current_user_has_any_role(ARRAY['admin','it']::app_role[]))
  with check (public.current_user_has_any_role(ARRAY['admin','it']::app_role[]));

drop policy tickets_admin_delete on public.tickets;
create policy tickets_admin_delete on public.tickets
for delete to authenticated
  using (public.current_user_has_any_role(ARRAY['admin','it']::app_role[]));

-- ticket_notes
drop policy ticket_notes_admin_select on public.ticket_notes;
create policy ticket_notes_admin_select on public.ticket_notes
for select to authenticated
  using (public.current_user_has_any_role(ARRAY['admin','it','direction']::app_role[]));

drop policy ticket_notes_admin_insert on public.ticket_notes;
create policy ticket_notes_admin_insert on public.ticket_notes
for insert to authenticated
  with check (public.current_user_has_any_role(ARRAY['admin','it']::app_role[]) and author_id = (select auth.uid()));

-- ticket_events
drop policy ticket_events_admin_select on public.ticket_events;
create policy ticket_events_admin_select on public.ticket_events
for select to authenticated
  using (public.current_user_has_any_role(ARRAY['admin','it','direction']::app_role[]));

drop policy ticket_events_admin_insert on public.ticket_events;
create policy ticket_events_admin_insert on public.ticket_events
for insert to authenticated
  with check (public.current_user_has_any_role(ARRAY['admin','it']::app_role[]) and actor_id = (select auth.uid()));

-- ticket_attachments
drop policy ticket_attachments_rows_admin_select on public.ticket_attachments;
create policy ticket_attachments_rows_admin_select on public.ticket_attachments
for select to authenticated
  using (public.current_user_has_any_role(ARRAY['admin','it','direction']::app_role[]));

-- storage.objects (ticket-attachments bucket)
drop policy ticket_attachments_admin_select on storage.objects;
create policy ticket_attachments_admin_select on storage.objects
for select to authenticated
  using (bucket_id = 'ticket-attachments' and public.current_user_has_any_role(ARRAY['admin','it','direction']::app_role[]));

drop policy ticket_attachments_admin_delete on storage.objects;
create policy ticket_attachments_admin_delete on storage.objects
for delete to authenticated
  using (bucket_id = 'ticket-attachments' and public.current_user_has_any_role(ARRAY['admin','it']::app_role[]));

-- Nothing references the singular role column or current_user_role() anymore.
drop function public.current_user_role();
alter table public.profiles drop column role;

-- prevent_self_role_change() still referenced the dropped `role` column.
create or replace function public.prevent_self_role_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() = old.id and (new.roles is distinct from old.roles or new.is_active is distinct from old.is_active) then
    raise exception 'No puedes cambiar tu propio rol o tu propio estado de activación.';
  end if;
  return new;
end;
$$;

-- Match the anon/public execute hardening already applied to current_user_role().
revoke execute on function public.current_user_roles() from public, anon;
revoke execute on function public.current_user_has_any_role(app_role[]) from public, anon;
