-- Lets staff record the sale value on a consulta that closed directly,
-- without going through the full lead pipeline. Resolves the pending
-- decision from earlier: option (a), value lives on the inquiry itself.
alter table inquiries add column sale_value numeric(12, 2);

create policy inquiries_staff_update on inquiries for update to authenticated
  using (current_user_role() = ANY (ARRAY['admin'::app_role, 'commercial'::app_role]))
  with check (current_user_role() = ANY (ARRAY['admin'::app_role, 'commercial'::app_role]));
