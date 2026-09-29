-- Meta Ads de verdad, no a mano.
--
-- Hasta ahora los datos de Meta se metían a mano en `meta_ads_entries`: una
-- fila por campaña con el total del periodo. Eso no deja filtrar por un rango
-- cualquiera, porque el dato ya viene sumado.
--
-- Aquí se guarda lo que devuelve la API de Meta: una fila por campaña y día.
-- Sumar un mes, una semana o del 3 al 17 pasa a ser una consulta, no volver a
-- pedirle nada a Meta.
--
-- Las cuentas publicitarias están repartidas en cuatro portfolios distintos, y
-- en Meta un token pertenece a un portfolio, así que hace falta uno por cada
-- uno. Por eso cada cuenta guarda en `token_key` de qué variable de entorno
-- sale su token: META_ADS_TOKEN_<token_key>. Añadir un portfolio nuevo mañana
-- es insertar una fila, no tocar el código.

-- ---------- Las cuentas publicitarias ----------
create table if not exists public.meta_ad_accounts (
  id uuid primary key default gen_random_uuid(),
  -- El número que enseña Meta, sin el prefijo "act_".
  account_id text not null unique,
  name text not null,
  -- El portfolio empresarial al que pertenece, solo para saber de dónde viene.
  portfolio text not null,
  -- La variable de entorno con su token: META_ADS_TOKEN_<token_key>.
  token_key text not null,
  -- Una cuenta es de una marca: por eso la marca no hay que adivinarla.
  business_unit_id uuid references public.business_units(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meta_ad_accounts_account_id_digits check (account_id ~ '^[0-9]+$'),
  constraint meta_ad_accounts_token_key_format check (token_key ~ '^[A-Z0-9_]+$')
);

-- ---------- Las campañas, tal y como están en Meta ----------
create table if not exists public.meta_campaigns (
  id uuid primary key default gen_random_uuid(),
  account_id text not null references public.meta_ad_accounts(account_id) on delete cascade,
  -- El identificador de la campaña en Meta. Es la clave de verdad: si alguien
  -- renombra la campaña allí, aquí no se rompe nada.
  meta_id text not null unique,
  name text not null,
  objective text,
  status text,
  started_at timestamptz,
  stopped_at timestamptz,
  -- Enlace opcional con nuestra campaña, para cruzar con leads y presupuesto.
  campaign_id uuid references public.campaigns(id) on delete set null,
  first_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists meta_campaigns_account_idx on public.meta_campaigns (account_id);
create index if not exists meta_campaigns_campaign_idx on public.meta_campaigns (campaign_id);

-- ---------- Lo que gastó y produjo cada campaña cada día ----------
create table if not exists public.meta_insights_daily (
  id bigint generated always as identity primary key,
  meta_campaign_id text not null references public.meta_campaigns(meta_id) on delete cascade,
  day date not null,
  spend numeric(12, 2) not null default 0,
  impressions bigint not null default 0,
  reach bigint not null default 0,
  clicks bigint not null default 0,
  leads bigint not null default 0,
  purchases bigint not null default 0,
  revenue numeric(12, 2) not null default 0,
  synced_at timestamptz not null default now(),
  -- Un día de una campaña es una fila y solo una: la sincronización vuelve a
  -- pasar por los últimos días porque Meta corrige sus cifras después, y tiene
  -- que poder pisar lo que ya había en vez de duplicarlo.
  constraint meta_insights_daily_unique unique (meta_campaign_id, day)
);
create index if not exists meta_insights_daily_day_idx on public.meta_insights_daily (day);

-- ---------- Registro de cada sincronización ----------
create table if not exists public.meta_sync_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  account_id text,
  covered_from date,
  covered_to date,
  rows_written integer not null default 0,
  ok boolean not null default false,
  message text
);
create index if not exists meta_sync_runs_started_idx on public.meta_sync_runs (started_at desc);

-- ---------- Quién puede ver esto ----------
alter table public.meta_ad_accounts enable row level security;
alter table public.meta_campaigns enable row level security;
alter table public.meta_insights_daily enable row level security;
alter table public.meta_sync_runs enable row level security;

-- Solo lectura, y solo para quien ya ve los datos de marketing. No hay política
-- de escritura a propósito: escribe únicamente el proceso de sincronización,
-- que va con la clave de servicio y se salta RLS.
--
-- La llamada va envuelta en un select para que Postgres la resuelva una vez por
-- consulta y no una vez por fila, como el resto de políticas del proyecto.
drop policy if exists meta_ad_accounts_select on public.meta_ad_accounts;
create policy meta_ad_accounts_select on public.meta_ad_accounts
  for select
  using ((select public.current_user_has_any_role(ARRAY['admin','direction','marketing']::app_role[])));

drop policy if exists meta_campaigns_select on public.meta_campaigns;
create policy meta_campaigns_select on public.meta_campaigns
  for select
  using ((select public.current_user_has_any_role(ARRAY['admin','direction','marketing']::app_role[])));

drop policy if exists meta_insights_daily_select on public.meta_insights_daily;
create policy meta_insights_daily_select on public.meta_insights_daily
  for select
  using ((select public.current_user_has_any_role(ARRAY['admin','direction','marketing']::app_role[])));

drop policy if exists meta_sync_runs_select on public.meta_sync_runs;
create policy meta_sync_runs_select on public.meta_sync_runs
  for select
  using ((select public.current_user_has_any_role(ARRAY['admin','direction','marketing']::app_role[])));

-- ---------- Las cinco cuentas que hay hoy ----------
-- Una por marca. Sumifluid no tiene cuenta publicitaria; el día que la tenga,
-- se añade aquí y aparece sola en la aplicación.
--
-- Los cuatro primeros identificadores están comprobados contra la API: Meta
-- devuelve la cuenta, su moneda y su gasto. El de Jender no, porque su token
-- todavía no existe, y el primer número que se dio para CST resultó no ser una
-- cuenta publicitaria sino otro activo. Por eso Jender entra desactivada: así
-- no se intenta sincronizar algo que puede estar mal, y se activa en cuanto se
-- confirme con su token.
insert into public.meta_ad_accounts (account_id, name, portfolio, token_key, business_unit_id, is_active)
values
  ('911349541712627',  'BlizzCool',         'Tools Place',           'TOOLS_PLACE', (select id from public.business_units where name = 'BlizzCool'),         true),
  ('999570263051123',  'Blizztherm',        'Tools Place',           'TOOLS_PLACE', (select id from public.business_units where name = 'Blizztherm'),        true),
  ('1525607822046950', 'Suministros Intec', 'CP Suministros INTEC',  'INTEC',       (select id from public.business_units where name = 'Suministros Intec'), true),
  ('1341286147546643', 'CST Ibérica',       'CST Iberica',           'CST',         (select id from public.business_units where name = 'CST IBERICA'),       true),
  ('1517746023265320', 'Jender Ibérica',    'Jender',                'JENDER',      (select id from public.business_units where name = 'Jender'),            false)
on conflict (account_id) do update
  set name = excluded.name,
      portfolio = excluded.portfolio,
      token_key = excluded.token_key,
      business_unit_id = excluded.business_unit_id,
      is_active = excluded.is_active,
      updated_at = now();
