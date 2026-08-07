-- Marketing metrics: social media stats per brand/network/month, Meta Ads
-- campaign performance, and email/mailing campaign performance. All three
-- are manually logged by marketing staff (no ad-platform API integration
-- exists in this app), mirroring the sales_entries pattern: admin/marketing
-- write, everyone with RRSS access reads, admin-or-10-minute-self-undo delete.

create table public.social_media_stats (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references public.business_units(id) on delete restrict,
  network text not null check (network in ('facebook', 'instagram', 'linkedin')),
  period_month date not null check (period_month = date_trunc('month', period_month)::date),
  followers_end integer not null default 0 check (followers_end >= 0),
  new_followers integer not null default 0,
  posts integer not null default 0 check (posts >= 0),
  interactions integer not null default 0 check (interactions >= 0),
  reach integer not null default 0 check (reach >= 0),
  active_campaigns integer not null default 0 check (active_campaigns >= 0),
  link_clicks integer not null default 0 check (link_clicks >= 0),
  leads integer not null default 0 check (leads >= 0),
  notes text,
  created_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint social_media_stats_unique_period unique (business_unit_id, network, period_month)
);

create table public.meta_ads_entries (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references public.business_units(id) on delete restrict,
  campaign_name text not null,
  ad_set text,
  ad_name text,
  objective text,
  status text not null default 'active' check (status in ('active', 'paused', 'finished')),
  start_date date,
  end_date date,
  amount_spent numeric(12, 2) not null default 0 check (amount_spent >= 0),
  impressions integer not null default 0 check (impressions >= 0),
  link_clicks integer not null default 0 check (link_clicks >= 0),
  leads integer not null default 0 check (leads >= 0),
  qualified_leads integer not null default 0 check (qualified_leads >= 0),
  purchases integer not null default 0 check (purchases >= 0),
  revenue numeric(12, 2) not null default 0 check (revenue >= 0),
  notes text,
  created_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meta_ads_entries_date_order check (end_date is null or start_date is null or end_date >= start_date)
);

create table public.mailing_campaigns (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references public.business_units(id) on delete restrict,
  campaign_name text not null,
  campaign_type text not null check (campaign_type in ('promocion', 'captacion', 'aviso', 'fidelizacion', 'remarketing', 'newsletter')),
  sent_date date not null,
  sent_count integer not null default 0 check (sent_count >= 0),
  delivered_count integer not null default 0 check (delivered_count >= 0),
  opens integer not null default 0 check (opens >= 0),
  clicks integer not null default 0 check (clicks >= 0),
  leads integer not null default 0 check (leads >= 0),
  sales_count integer not null default 0 check (sales_count >= 0),
  revenue numeric(12, 2) not null default 0 check (revenue >= 0),
  unsubscribes integer not null default 0 check (unsubscribes >= 0),
  notes text,
  created_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index social_media_stats_unit_period_idx on public.social_media_stats(business_unit_id, period_month);
create index meta_ads_entries_unit_status_idx on public.meta_ads_entries(business_unit_id, status);
create index mailing_campaigns_unit_sent_idx on public.mailing_campaigns(business_unit_id, sent_date);

create trigger social_media_stats_set_updated_at before update on public.social_media_stats
for each row execute function public.set_updated_at();

create trigger meta_ads_entries_set_updated_at before update on public.meta_ads_entries
for each row execute function public.set_updated_at();

create trigger mailing_campaigns_set_updated_at before update on public.mailing_campaigns
for each row execute function public.set_updated_at();

alter table public.social_media_stats enable row level security;
alter table public.meta_ads_entries enable row level security;
alter table public.mailing_campaigns enable row level security;

create policy social_media_stats_read_authenticated on public.social_media_stats
for select to authenticated using (true);

create policy social_media_stats_staff_insert on public.social_media_stats
for insert to authenticated with check (
  public.current_user_has_any_role(ARRAY['admin', 'marketing']::app_role[])
  and created_by = (select auth.uid())
);

create policy social_media_stats_staff_update on public.social_media_stats
for update to authenticated
  using (public.current_user_has_any_role(ARRAY['admin', 'marketing']::app_role[]))
  with check (public.current_user_has_any_role(ARRAY['admin', 'marketing']::app_role[]));

create policy social_media_stats_recent_undo_or_admin on public.social_media_stats
for delete to authenticated using (
  public.current_user_has_any_role(ARRAY['admin']::app_role[])
  or (created_by = (select auth.uid()) and created_at >= now() - interval '10 minutes')
);

create policy meta_ads_entries_read_authenticated on public.meta_ads_entries
for select to authenticated using (true);

create policy meta_ads_entries_staff_insert on public.meta_ads_entries
for insert to authenticated with check (
  public.current_user_has_any_role(ARRAY['admin', 'marketing']::app_role[])
  and created_by = (select auth.uid())
);

create policy meta_ads_entries_staff_update on public.meta_ads_entries
for update to authenticated
  using (public.current_user_has_any_role(ARRAY['admin', 'marketing']::app_role[]))
  with check (public.current_user_has_any_role(ARRAY['admin', 'marketing']::app_role[]));

create policy meta_ads_entries_recent_undo_or_admin on public.meta_ads_entries
for delete to authenticated using (
  public.current_user_has_any_role(ARRAY['admin']::app_role[])
  or (created_by = (select auth.uid()) and created_at >= now() - interval '10 minutes')
);

create policy mailing_campaigns_read_authenticated on public.mailing_campaigns
for select to authenticated using (true);

create policy mailing_campaigns_staff_insert on public.mailing_campaigns
for insert to authenticated with check (
  public.current_user_has_any_role(ARRAY['admin', 'marketing']::app_role[])
  and created_by = (select auth.uid())
);

create policy mailing_campaigns_staff_update on public.mailing_campaigns
for update to authenticated
  using (public.current_user_has_any_role(ARRAY['admin', 'marketing']::app_role[]))
  with check (public.current_user_has_any_role(ARRAY['admin', 'marketing']::app_role[]));

create policy mailing_campaigns_recent_undo_or_admin on public.mailing_campaigns
for delete to authenticated using (
  public.current_user_has_any_role(ARRAY['admin']::app_role[])
  or (created_by = (select auth.uid()) and created_at >= now() - interval '10 minutes')
);
