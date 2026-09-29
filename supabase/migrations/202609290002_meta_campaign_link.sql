-- Atar cada campaña de Meta a la campaña de la aplicación que le corresponde.
--
-- La columna ya existía sin usar. Sirve para que la pestaña de Campañas deje de
-- leer la tabla de entradas a mano y saque el gasto y los leads de lo que manda
-- Meta, que es lo que de verdad se gastó.
--
-- Se atan solas las que coinciden por nombre Y son de la misma marca. Son 7 de
-- 38: la aplicación tiene 16 campañas elegidas a mano y Meta tiene todas, hasta
-- las publicaciones promocionadas. Las demás se atan desde la propia pestaña de
-- Meta Ads, con un desplegable en cada campaña.
--
-- Solo se toca lo que está sin atar: si alguien ya ató una a mano, manda la suya.

update public.meta_campaigns m
set campaign_id = c.id,
    updated_at = now()
from public.campaigns c
join public.meta_ad_accounts a on a.business_unit_id = c.business_unit_id
where m.campaign_id is null
  and m.account_id = a.account_id
  and lower(btrim(c.name)) = lower(btrim(m.name))
  -- Un nombre repetido en dos campañas de la misma marca sería una apuesta, y
  -- aquí no se apuesta: esas se dejan para que las ate una persona.
  and (
    select count(*) from public.campaigns c2
    where c2.business_unit_id = c.business_unit_id
      and lower(btrim(c2.name)) = lower(btrim(m.name))
  ) = 1;

create index if not exists meta_campaigns_campaign_link_idx
  on public.meta_campaigns (campaign_id)
  where campaign_id is not null;
