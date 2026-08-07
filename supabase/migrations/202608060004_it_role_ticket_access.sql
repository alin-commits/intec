-- Extend ticket management RLS to the new 'it' role, alongside 'admin'.
-- Everything else (leads/campaigns/consultas/usuarios) is untouched: 'it'
-- behaves like 'viewer' everywhere except the ticket tables and this bucket.

drop policy tickets_admin_select on tickets;
create policy tickets_admin_select on tickets for select to authenticated
  using (current_user_role() = ANY (ARRAY['admin'::app_role, 'it'::app_role]));

drop policy tickets_admin_update on tickets;
create policy tickets_admin_update on tickets for update to authenticated
  using (current_user_role() = ANY (ARRAY['admin'::app_role, 'it'::app_role]))
  with check (current_user_role() = ANY (ARRAY['admin'::app_role, 'it'::app_role]));

drop policy tickets_admin_delete on tickets;
create policy tickets_admin_delete on tickets for delete to authenticated
  using (current_user_role() = ANY (ARRAY['admin'::app_role, 'it'::app_role]));

drop policy ticket_notes_admin_select on ticket_notes;
create policy ticket_notes_admin_select on ticket_notes for select to authenticated
  using (current_user_role() = ANY (ARRAY['admin'::app_role, 'it'::app_role]));

drop policy ticket_notes_admin_insert on ticket_notes;
create policy ticket_notes_admin_insert on ticket_notes for insert to authenticated
  with check (current_user_role() = ANY (ARRAY['admin'::app_role, 'it'::app_role]) and author_id = (select auth.uid()));

drop policy ticket_events_admin_select on ticket_events;
create policy ticket_events_admin_select on ticket_events for select to authenticated
  using (current_user_role() = ANY (ARRAY['admin'::app_role, 'it'::app_role]));

drop policy ticket_events_admin_insert on ticket_events;
create policy ticket_events_admin_insert on ticket_events for insert to authenticated
  with check (current_user_role() = ANY (ARRAY['admin'::app_role, 'it'::app_role]) and actor_id = (select auth.uid()));

drop policy ticket_attachments_admin_select on storage.objects;
create policy ticket_attachments_admin_select on storage.objects for select to authenticated
  using (bucket_id = 'ticket-attachments' and current_user_role() = ANY (ARRAY['admin'::app_role, 'it'::app_role]));

drop policy ticket_attachments_admin_delete on storage.objects;
create policy ticket_attachments_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'ticket-attachments' and current_user_role() = ANY (ARRAY['admin'::app_role, 'it'::app_role]));
