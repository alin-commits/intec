-- Lo que Meta no sabe de sus propias campañas.
--
-- La API devuelve gasto, impresiones, clics y leads. No devuelve los ingresos,
-- porque aquí se vende por WhatsApp y por teléfono y Meta no ve esas ventas: la
-- API dice 0 € donde a mano hay 2.604 €. Tampoco sabe cuántos de esos leads
-- eran buenos, ni cuántos seguidores ganó la marca con el anuncio.
--
-- Eso se sigue escribiendo a mano, pero ya no en una tabla paralela con el
-- gasto duplicado: solo lo que falta, colgado de la campaña de Meta por su
-- identificador. Así el gasto viene de un sitio y nadie suma dos veces.

create table if not exists public.meta_campaign_extras (
  meta_campaign_id text primary key references public.meta_campaigns(meta_id) on delete cascade,
  revenue numeric(12, 2) not null default 0 check (revenue >= 0),
  qualified_leads integer not null default 0 check (qualified_leads >= 0),
  followers_gained integer not null default 0 check (followers_gained >= 0),
  notes text,
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now()
);

alter table public.meta_campaign_extras enable row level security;

-- Ver, quien ve marketing. Escribir, solo quien además puede editar.
create policy meta_campaign_extras_select on public.meta_campaign_extras
  for select
  using ((select public.current_user_has_any_role(ARRAY['admin','direction','marketing']::app_role[])));

create policy meta_campaign_extras_write on public.meta_campaign_extras
  for all
  using ((select public.current_user_has_any_role(ARRAY['admin','marketing']::app_role[])))
  with check ((select public.current_user_has_any_role(ARRAY['admin','marketing']::app_role[])));

-- ---------- Lo que ya estaba escrito a mano ----------
-- Se rescata de meta_ads_entries lo que la API no da, emparejando por nombre de
-- campaña. Solo cuadran unas pocas; el resto se asigna desde la aplicación, que
-- para eso enseña las que quedan sueltas. La tabla vieja NO se borra aquí: se
-- deja como está hasta que se confirme que no falta nada.
insert into public.meta_campaign_extras (meta_campaign_id, revenue, qualified_leads, followers_gained, notes)
select
  c.meta_id,
  sum(coalesce(e.revenue, 0)),
  sum(coalesce(e.qualified_leads, 0)),
  sum(coalesce(e.followers_gained, 0)),
  -- Varias entradas a mano pueden apuntar a la misma campaña de Meta.
  nullif(string_agg(nullif(btrim(coalesce(e.notes, '')), ''), E'\n'), '')
from public.meta_ads_entries e
join public.meta_campaigns c
  on lower(btrim(c.name)) = lower(btrim(e.campaign_name))
group by c.meta_id
having sum(coalesce(e.revenue, 0)) > 0
    or sum(coalesce(e.qualified_leads, 0)) > 0
    or sum(coalesce(e.followers_gained, 0)) > 0
    or nullif(string_agg(nullif(btrim(coalesce(e.notes, '')), ''), E'\n'), '') is not null
on conflict (meta_campaign_id) do nothing;
