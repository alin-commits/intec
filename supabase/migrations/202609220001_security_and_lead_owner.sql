-- 1. Read access by role instead of "any signed-in user".
-- Until now every authenticated account (e.g. an IT-only user) could read
-- customer leads and the whole team's emails straight from the API, even if
-- the UI hid those pages. Role lists mirror the ones the app already uses.

-- Profiles: everyone can read their own row (needed to know their roles and
-- whether they are active); only roles that manage people or show names
-- (users, card assignment, ticket notes) can read everyone else's.
drop policy profiles_read_authenticated on public.profiles;
create policy profiles_read_own_or_staff on public.profiles
for select to authenticated
  using (id = (select auth.uid()) or public.current_user_has_any_role(ARRAY['admin','marketing','it','direction']::app_role[]));

-- Customer data: every role except IT-only accounts.
drop policy leads_read_authenticated on public.leads;
create policy leads_read_by_role on public.leads
for select to authenticated
  using (public.current_user_has_any_role(ARRAY['admin','commercial','marketing','viewer','direction']::app_role[]));

drop policy lead_status_history_read_authenticated on public.lead_status_history;
create policy lead_status_history_read_by_role on public.lead_status_history
for select to authenticated
  using (public.current_user_has_any_role(ARRAY['admin','commercial','marketing','viewer','direction']::app_role[]));

drop policy campaigns_read_authenticated on public.campaigns;
create policy campaigns_read_by_role on public.campaigns
for select to authenticated
  using (public.current_user_has_any_role(ARRAY['admin','commercial','marketing','viewer','direction']::app_role[]));

-- Marketing metrics are also shown on the commercial dashboard and campaign cards.
drop policy social_media_stats_read_authenticated on public.social_media_stats;
create policy social_media_stats_read_by_role on public.social_media_stats
for select to authenticated
  using (public.current_user_has_any_role(ARRAY['admin','commercial','marketing','viewer','direction']::app_role[]));

drop policy meta_ads_entries_read_authenticated on public.meta_ads_entries;
create policy meta_ads_entries_read_by_role on public.meta_ads_entries
for select to authenticated
  using (public.current_user_has_any_role(ARRAY['admin','commercial','marketing','viewer','direction']::app_role[]));

drop policy mailing_campaigns_read_authenticated on public.mailing_campaigns;
create policy mailing_campaigns_read_by_role on public.mailing_campaigns
for select to authenticated
  using (public.current_user_has_any_role(ARRAY['admin','commercial','marketing','viewer','direction']::app_role[]));

-- 2. Team names for pickers (lead owner) without exposing emails. Any active
-- user may call it; inactive users get nothing.
create or replace function public.list_team_members()
returns table (id uuid, full_name text, roles app_role[])
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.full_name, p.roles
  from public.profiles p
  where p.is_active and public.current_user_roles() is not null
  order by p.full_name;
$$;
revoke execute on function public.list_team_members() from public, anon;
grant execute on function public.list_team_members() to authenticated;

-- 3. Each lead can have a responsible commercial.
alter table public.leads add column assigned_to uuid references public.profiles(id) on delete set null;
create index leads_assigned_to_idx on public.leads (assigned_to);

-- 4. Rate limiting for "forgot password" (checked/inserted only by the server
-- with service_role; no client role can read or write it).
create table public.password_reset_log (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  ip text not null,
  created_at timestamptz not null default now()
);
create index password_reset_log_email_idx on public.password_reset_log (email, created_at);
create index password_reset_log_ip_idx on public.password_reset_log (ip, created_at);
alter table public.password_reset_log enable row level security;
