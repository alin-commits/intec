-- El presupuesto de la campaña, tal y como está puesto en Meta.
--
-- En la ficha de una campaña el gasto se actualiza solo —lo manda Meta cada
-- hora— pero el presupuesto era un número escrito a mano al crearla. Así que la
-- tarjeta decía "Presupuesto 200 €" al lado de "gasto 316,75 €" sin que saltara
-- nada: el presupuesto de verdad se había subido en Meta y aquí no se enteraba
-- nadie.
--
-- Ahora se guarda lo que Meta dice. Dos campos, porque Meta tiene dos formas de
-- presupuestar y no significan lo mismo:
--
--   · diario: lo que se gasta cada día mientras la campaña esté viva.
--   · total: lo que se gasta en toda la vida de la campaña.
--
-- Una campaña tiene uno u otro, nunca los dos. Y si el presupuesto está puesto
-- en los conjuntos de anuncios en vez de en la campaña, lo que se guarda es la
-- suma de los conjuntos, que es el gasto máximo real.
--
-- Lo escrito a mano se queda donde estaba: es el que vale para las campañas que
-- no son de Meta (una feria, un buzoneo) y el que se usa mientras Meta no haya
-- mandado el suyo.
--
-- Se puede volver a ejecutar sin romper nada.

alter table public.meta_campaigns add column if not exists daily_budget numeric(12, 2);
alter table public.meta_campaigns add column if not exists lifetime_budget numeric(12, 2);

comment on column public.meta_campaigns.daily_budget is
  'Presupuesto diario que tiene puesto en Meta, en euros. Si la campaña presupuesta por conjuntos de anuncios, es la suma de los suyos.';
comment on column public.meta_campaigns.lifetime_budget is
  'Presupuesto total para toda la vida de la campaña, en euros. Excluyente con el diario.';
