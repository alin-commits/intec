-- Meta Ads entries and the general "campaigns" tracker often describe the
-- same real-world campaign at two levels of detail (strategic/lead-funnel
-- view vs. granular ad-performance log). Link them optionally so the general
-- Campañas card can roll up ad spend/ROAS without forcing every campaign
-- (Email/Landing/Teléfono ones included) to carry ad-specific columns.

alter table public.meta_ads_entries
  add column campaign_id uuid references public.campaigns(id) on delete set null;

create index meta_ads_entries_campaign_idx on public.meta_ads_entries(campaign_id) where campaign_id is not null;
