-- 1. Recipients can clear notices from their bell. The row is kept (marked as
-- dismissed) so the sender's history still shows who received and read it.
alter table public.announcement_recipients add column if not exists dismissed_at timestamptz;

create or replace function public.dismiss_announcements(announcement_ids uuid[])
returns void
language sql
security definer
set search_path = public
as $$
  update public.announcement_recipients
  set dismissed_at = now(), read_at = coalesce(read_at, now())
  where recipient_id = auth.uid() and announcement_id = any(announcement_ids) and dismissed_at is null;
$$;
revoke execute on function public.dismiss_announcements(uuid[]) from public, anon;
grant execute on function public.dismiss_announcements(uuid[]) to authenticated;

-- 2. "Enviados": the caller's own notices with each recipient's read status.
create or replace function public.list_sent_announcements()
returns table (id uuid, title text, body text, created_at timestamptz, recipients jsonb)
language sql
stable
security definer
set search_path = public
as $$
  select
    a.id,
    a.title,
    a.body,
    a.created_at,
    coalesce(
      jsonb_agg(jsonb_build_object('name', coalesce(p.full_name, 'Usuario'), 'readAt', r.read_at) order by p.full_name)
        filter (where r.recipient_id is not null),
      '[]'::jsonb
    )
  from public.announcements a
  left join public.announcement_recipients r on r.announcement_id = a.id
  left join public.profiles p on p.id = r.recipient_id
  where a.sender_id = auth.uid()
  group by a.id
  order by a.created_at desc
  limit 50;
$$;
revoke execute on function public.list_sent_announcements() from public, anon;
grant execute on function public.list_sent_announcements() to authenticated;
