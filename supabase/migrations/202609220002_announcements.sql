-- Internal notices ("avisos") that dirección, admin, marketing and IT can send
-- to chosen users. They show up in each recipient's bell and can optionally
-- be emailed. Writes go through the server (/api/announcements, service_role),
-- so clients only get read access to what was sent to them.

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid references public.profiles(id) on delete set null,
  -- Stored at send time: recipients may not be allowed to read other profiles.
  sender_name text not null,
  title text not null check (char_length(title) between 1 and 120),
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

create table public.announcement_recipients (
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  read_at timestamptz,
  primary key (announcement_id, recipient_id)
);
create index announcement_recipients_recipient_idx on public.announcement_recipients (recipient_id, read_at);

alter table public.announcements enable row level security;
alter table public.announcement_recipients enable row level security;

create policy announcement_recipients_select_own on public.announcement_recipients
for select to authenticated
  using (recipient_id = (select auth.uid()));

create policy announcements_select_received on public.announcements
for select to authenticated
  using (exists (
    select 1 from public.announcement_recipients r
    where r.announcement_id = announcements.id and r.recipient_id = (select auth.uid())
  ));

-- Marking as read only touches the caller's own rows (no client update policy).
create or replace function public.mark_announcements_read(announcement_ids uuid[])
returns void
language sql
security definer
set search_path = public
as $$
  update public.announcement_recipients
  set read_at = now()
  where recipient_id = auth.uid() and announcement_id = any(announcement_ids) and read_at is null;
$$;
revoke execute on function public.mark_announcements_read(uuid[]) from public, anon;
grant execute on function public.mark_announcements_read(uuid[]) to authenticated;
