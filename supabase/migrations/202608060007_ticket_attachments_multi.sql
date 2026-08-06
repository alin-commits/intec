-- Move from a single attachment per ticket to up to 5, so the ticket detail
-- page can show them as a gallery.
alter table tickets drop column attachment_path;

create table ticket_attachments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references tickets(id) on delete cascade,
  path text not null,
  created_at timestamptz not null default now()
);

create index ticket_attachments_ticket_id_idx on ticket_attachments (ticket_id);

alter table ticket_attachments enable row level security;

create policy ticket_attachments_rows_admin_select on ticket_attachments for select to authenticated
  using (current_user_role() = ANY (ARRAY['admin'::app_role, 'it'::app_role]));
