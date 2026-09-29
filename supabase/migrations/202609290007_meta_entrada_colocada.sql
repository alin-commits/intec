-- Dejar constancia de qué entrada antigua se ha colocado ya, y dónde.
--
-- El botón "Colocar" de la pestaña de Meta Ads guardaba los ingresos en
-- meta_campaign_extras pero no apuntaba en ningún sitio que esa entrada ya
-- estaba colocada. La lista de pendientes lo deducía comparando el NOMBRE de la
-- entrada con el de las campañas de Meta que ya tenían extras — y esas ocho
-- entradas están en la lista precisamente porque su nombre no coincide con
-- ninguna campaña. O sea: no desaparecían nunca por mucho que se colocaran, y
-- cada clic volvía a sumar los mismos ingresos encima de los anteriores.
--
-- Con esto la pregunta "¿está colocada?" se responde mirando un dato, no
-- adivinando por el nombre.
--
-- Se puede volver a ejecutar entera sin romper nada.

alter table public.meta_ads_entries
  add column if not exists placed_into text references public.meta_campaigns(meta_id) on delete set null,
  add column if not exists placed_at timestamptz,
  add column if not exists placed_by uuid references public.profiles(id) on delete set null;

comment on column public.meta_ads_entries.placed_into is
  'Campaña de Meta a la que se sumó esta entrada escrita a mano. Si tiene valor, ya está colocada y no vuelve a salir en la lista de pendientes.';

create index if not exists meta_ads_entries_pendientes_idx
  on public.meta_ads_entries (id)
  where placed_into is null;

-- Las que ya se colocaron solas en la migración 202609290001 (las que sí
-- cuadraban por nombre) se marcan ahora, para que la lista de pendientes pueda
-- mirar solo esta columna y olvidarse de comparar nombres.
update public.meta_ads_entries e
set placed_into = c.meta_id,
    placed_at = coalesce(e.placed_at, now())
from public.meta_campaigns c
join public.meta_campaign_extras x on x.meta_campaign_id = c.meta_id
where e.placed_into is null
  and lower(btrim(c.name)) = lower(btrim(e.campaign_name));
