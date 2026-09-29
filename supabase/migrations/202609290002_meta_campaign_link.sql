-- Atar cada campaña de Meta a la campaña de la aplicación que le corresponde.
--
-- La columna ya existía sin usar. Sirve para que la pestaña de Campañas deje de
-- leer la tabla de entradas a mano y saque el gasto y los leads de lo que manda
-- Meta, que es lo que de verdad se gastó.
--
-- Se atan solas las que coinciden por nombre. No se exige que la marca cuadre a
-- propósito: "Leads | Filtros Línea Jender" se lanzó desde la cuenta de Intec y
-- es de Jender, y es justo ese desajuste el que interesa recoger. Lo que sí se
-- exige es que el nombre sea único en la aplicación; hoy no hay ninguno
-- repetido entre marcas, y si mañana lo hay, esa se deja para que la ate una
-- persona en vez de apostar.
--
-- Una vez atada, la marca de la campaña de la aplicación manda sobre la de la
-- cuenta publicitaria: es la que alguien ha decidido a mano.
--
-- Solo se toca lo que está sin atar: si alguien ya ató una, manda la suya. Se
-- puede volver a ejecutar sin romper nada.

update public.meta_campaigns m
set campaign_id = c.id,
    updated_at = now()
from public.campaigns c
where m.campaign_id is null
  and lower(btrim(c.name)) = lower(btrim(m.name))
  and (
    select count(*) from public.campaigns c2
    where lower(btrim(c2.name)) = lower(btrim(m.name))
  ) = 1;

create index if not exists meta_campaigns_campaign_link_idx
  on public.meta_campaigns (campaign_id)
  where campaign_id is not null;
