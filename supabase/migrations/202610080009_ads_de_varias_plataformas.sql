-- La publicidad deja de llamarse "Meta".
--
-- Hoy todo lo de anuncios se llama meta_* porque Meta era lo único que había.
-- Cuando entre LinkedIn Ads no queremos duplicar panel, dashboards, campañas y
-- exportaciones: queremos que todo eso hable de "plataforma" y que lo único
-- propio de cada una sea lo que se sincroniza de su API.
--
-- Hay tres capas y solo una se multiplica por plataforma:
--
--   1. El libro de anuncios —lo que se mira y se apunta a mano— no es de Meta,
--      es de publicidad: una columna de plataforma y listo. Es esta tabla.
--   2. El espejo de cada plataforma (campañas, métricas diarias, cuentas) sí es
--      suyo: sus identificadores y sus métricas. LinkedIn tendrá el suyo y no se
--      fuerza una tabla común que perdería campos de las dos.
--   3. El registro de sincronizaciones sí se unifica, porque el aviso de "datos
--      frescos" tiene que avisar si falla cualquiera de ellas, no solo Meta.
--
-- Las vistas del final son un puente para el rato que pasa entre ejecutar esto
-- y desplegar el código nuevo: con ellas, lo que hay publicado sigue
-- funcionando contra los nombres viejos. Se borran en cuanto el despliegue
-- esté hecho (migración aparte).
--
-- Se puede volver a ejecutar sin romper nada.

-- 1. El libro de anuncios.
-- El renombrado mira si ya está hecho, porque después de la primera pasada
-- "meta_ads_entries" vuelve a existir —como vista puente, ahí abajo— y un
-- "alter table if exists" intentaría renombrar la vista.
do $$
begin
  if to_regclass('public.ads_entries') is null then
    alter table public.meta_ads_entries rename to ads_entries;
  end if;
end
$$;

alter table public.ads_entries add column if not exists platform text not null default 'meta';
alter table public.ads_entries drop constraint if exists ads_entries_platform_check;
alter table public.ads_entries add constraint ads_entries_platform_check check (platform in ('meta', 'linkedin'));

comment on table public.ads_entries is
  'Lo que se apunta a mano de cada campaña de publicidad, sea de la plataforma que sea. Lo que llega solo por API vive en el espejo de cada plataforma.';
comment on column public.ads_entries.platform is
  'De qué plataforma es la campaña: meta o linkedin. Lo que ya había es de Meta, que era lo único que existía.';

create index if not exists ads_entries_platform_idx on public.ads_entries (platform, business_unit_id);

-- 3. El registro de sincronizaciones, común a todas las plataformas.
do $$
begin
  if to_regclass('public.ads_sync_runs') is null then
    alter table public.meta_sync_runs rename to ads_sync_runs;
  end if;
end
$$;

alter table public.ads_sync_runs add column if not exists platform text not null default 'meta';
alter table public.ads_sync_runs drop constraint if exists ads_sync_runs_platform_check;
alter table public.ads_sync_runs add constraint ads_sync_runs_platform_check check (platform in ('meta', 'linkedin'));

comment on table public.ads_sync_runs is
  'Cada pasada de sincronización con una plataforma de anuncios: cuándo, qué periodo cubrió, cuántas filas escribió y si salió bien.';

create index if not exists ads_sync_runs_platform_started_idx on public.ads_sync_runs (platform, started_at desc);

-- Puente temporal: lo desplegado todavía pide los nombres viejos.
-- security_invoker hace que manden las políticas de la tabla de abajo, no las
-- del dueño de la vista: nadie gana permisos por pasar por aquí.
create or replace view public.meta_ads_entries with (security_invoker = true) as
  select id, business_unit_id, campaign_name, ad_set, ad_name, objective, status, start_date, end_date,
         amount_spent, impressions, link_clicks, leads, qualified_leads, purchases, revenue, notes,
         created_by, created_at, updated_at, campaign_id, followers_gained, placed_into, placed_at, placed_by
  from public.ads_entries
  where platform = 'meta';

create or replace view public.meta_sync_runs with (security_invoker = true) as
  select id, started_at, finished_at, account_id, covered_from, covered_to, rows_written, ok, message
  from public.ads_sync_runs
  where platform = 'meta';

comment on view public.meta_ads_entries is 'Puente temporal mientras se despliega el código nuevo. Borrar después.';
comment on view public.meta_sync_runs is 'Puente temporal mientras se despliega el código nuevo. Borrar después.';
