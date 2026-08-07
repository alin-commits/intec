-- Marketing gets write access to leads and campaigns, matching commercial/admin.
-- Direction gets read-only access across the board (tickets included), never write.

drop policy leads_staff_insert on leads;
create policy leads_staff_insert on leads for insert to authenticated
  with check (current_user_role() = ANY (ARRAY['admin'::app_role, 'commercial'::app_role, 'marketing'::app_role]) and created_by = (select auth.uid()));

drop policy leads_staff_update on leads;
create policy leads_staff_update on leads for update to authenticated
  using (current_user_role() = ANY (ARRAY['admin'::app_role, 'commercial'::app_role, 'marketing'::app_role]))
  with check (current_user_role() = ANY (ARRAY['admin'::app_role, 'commercial'::app_role, 'marketing'::app_role]));

drop policy campaigns_admin_insert on campaigns;
create policy campaigns_staff_insert on campaigns for insert to authenticated
  with check (current_user_role() = ANY (ARRAY['admin'::app_role, 'marketing'::app_role]) and created_by = (select auth.uid()));

drop policy campaigns_admin_update on campaigns;
create policy campaigns_staff_update on campaigns for update to authenticated
  using (current_user_role() = ANY (ARRAY['admin'::app_role, 'marketing'::app_role]))
  with check (current_user_role() = ANY (ARRAY['admin'::app_role, 'marketing'::app_role]));

-- Direction: read-only visibility into tickets (previously admin/it only for select).
drop policy tickets_admin_select on tickets;
create policy tickets_admin_select on tickets for select to authenticated
  using (current_user_role() = ANY (ARRAY['admin'::app_role, 'it'::app_role, 'direction'::app_role]));

drop policy ticket_notes_admin_select on ticket_notes;
create policy ticket_notes_admin_select on ticket_notes for select to authenticated
  using (current_user_role() = ANY (ARRAY['admin'::app_role, 'it'::app_role, 'direction'::app_role]));

drop policy ticket_events_admin_select on ticket_events;
create policy ticket_events_admin_select on ticket_events for select to authenticated
  using (current_user_role() = ANY (ARRAY['admin'::app_role, 'it'::app_role, 'direction'::app_role]));

drop policy ticket_attachments_rows_admin_select on ticket_attachments;
create policy ticket_attachments_rows_admin_select on ticket_attachments for select to authenticated
  using (current_user_role() = ANY (ARRAY['admin'::app_role, 'it'::app_role, 'direction'::app_role]));

drop policy ticket_attachments_admin_select on storage.objects;
create policy ticket_attachments_admin_select on storage.objects for select to authenticated
  using (bucket_id = 'ticket-attachments' and current_user_role() = ANY (ARRAY['admin'::app_role, 'it'::app_role, 'direction'::app_role]));
