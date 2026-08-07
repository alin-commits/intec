-- Ticket informático (IT support) module.
-- Public workers submit via a server-only route (service_role); only the
-- admin role can read/manage tickets through RLS.

create type ticket_category as enum ('erp_apps', 'equipment', 'accounts_access', 'network');
create type ticket_blocking_level as enum ('blocked', 'hindered', 'not_blocked');
create type ticket_priority as enum ('low', 'medium', 'high');
create type ticket_status as enum ('new', 'in_progress', 'pending', 'resolved', 'closed');
create type ticket_note_type as enum ('internal_note', 'whatsapp_contact', 'call', 'intervention', 'vendor', 'resolution');

create sequence ticket_number_seq;

create table tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_number text not null unique,
  reporter_name text not null,
  reporter_phone text not null,
  reporter_email text,
  department text not null,
  title text not null,
  category ticket_category not null,
  description text not null,
  started_at text,
  blocking_level ticket_blocking_level not null,
  restarted boolean not null default false,
  has_error_message boolean not null default false,
  error_message text,
  priority ticket_priority not null,
  status ticket_status not null default 'new',
  attachment_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  closed_at timestamptz,
  archived_at timestamptz
);

create index tickets_ticket_number_idx on tickets (ticket_number);
create index tickets_status_idx on tickets (status);
create index tickets_priority_idx on tickets (priority);
create index tickets_category_idx on tickets (category);
create index tickets_created_at_idx on tickets (created_at);
create index tickets_updated_at_idx on tickets (updated_at);
create index tickets_reporter_name_idx on tickets (reporter_name);
create index tickets_reporter_phone_idx on tickets (reporter_phone);

create table ticket_notes (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references tickets(id) on delete cascade,
  author_id uuid not null references auth.users(id),
  note_type ticket_note_type not null,
  content text not null,
  created_at timestamptz not null default now()
);

create index ticket_notes_ticket_id_idx on ticket_notes (ticket_id);

create table ticket_events (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references tickets(id) on delete cascade,
  actor_id uuid references auth.users(id),
  event_type text not null,
  previous_value text,
  new_value text,
  created_at timestamptz not null default now()
);

create index ticket_events_ticket_id_idx on ticket_events (ticket_id);

-- Basic per-IP rate limiting for the public submission route (checked/inserted
-- via service_role from the server; no RLS access needed for any client role).
create table ticket_submission_log (
  id uuid primary key default gen_random_uuid(),
  ip text not null,
  created_at timestamptz not null default now()
);

create index ticket_submission_log_ip_created_idx on ticket_submission_log (ip, created_at);

create trigger set_tickets_updated_at
  before update on tickets
  for each row execute function set_updated_at();

create function set_ticket_number()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.ticket_number is null then
    new.ticket_number := 'TIC-' || lpad(nextval('ticket_number_seq')::text, 4, '0');
  end if;
  return new;
end;
$$;

create trigger set_tickets_ticket_number
  before insert on tickets
  for each row execute function set_ticket_number();

alter table tickets enable row level security;
alter table ticket_notes enable row level security;
alter table ticket_events enable row level security;
alter table ticket_submission_log enable row level security;

create policy tickets_admin_select on tickets for select to authenticated
  using (current_user_role() = 'admin');
create policy tickets_admin_update on tickets for update to authenticated
  using (current_user_role() = 'admin') with check (current_user_role() = 'admin');
create policy tickets_admin_delete on tickets for delete to authenticated
  using (current_user_role() = 'admin');

create policy ticket_notes_admin_select on ticket_notes for select to authenticated
  using (current_user_role() = 'admin');
create policy ticket_notes_admin_insert on ticket_notes for insert to authenticated
  with check (current_user_role() = 'admin' and author_id = (select auth.uid()));

create policy ticket_events_admin_select on ticket_events for select to authenticated
  using (current_user_role() = 'admin');
create policy ticket_events_admin_insert on ticket_events for insert to authenticated
  with check (current_user_role() = 'admin' and actor_id = (select auth.uid()));

-- ticket_submission_log: no policies for any client role. Only service_role
-- (which bypasses RLS) reads/writes it from the public submission route.

insert into storage.buckets (id, name, public)
values ('ticket-attachments', 'ticket-attachments', false)
on conflict (id) do nothing;

create policy ticket_attachments_admin_select on storage.objects for select to authenticated
  using (bucket_id = 'ticket-attachments' and current_user_role() = 'admin');
create policy ticket_attachments_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'ticket-attachments' and current_user_role() = 'admin');
