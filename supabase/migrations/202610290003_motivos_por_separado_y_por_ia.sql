-- Los motivos de pérdida, una lista para leads y otra para consultas, y quién
-- puso cada uno: una persona o la IA.
--
-- Va después de 202610290002 y la corrige: aquella usaba una sola lista para
-- los dos. Pero un lead y una consulta se pierden por cosas distintas. Un lead
-- llega de un anuncio y muchas veces solo quería saber un precio o deja de
-- contestar; una consulta es alguien que ya ha pedido algo concreto, y se
-- pierde por precio, por plazo o porque no hay stock. Con la misma lista, el
-- desplegable de cada uno llevaba opciones que nunca le tocan, y el reparto de
-- los dos se mezclaba en uno que no decía nada de ninguno.
--
-- Se puede volver a ejecutar sin romper nada, y vale igual si 202610290002 se
-- aplicó hace un rato o justo antes que esta.

-- ---------- Cada uno, su lista ----------

alter table public.leads drop constraint if exists leads_lost_reason_check;
alter table public.leads add constraint leads_lost_reason_check check (
  (lost_reason is null or lost_reason in ('precio', 'plazo', 'competencia', 'no_encaja', 'sin_presupuesto', 'solo_informacion', 'no_contesta', 'otro'))
  and (lost_reason is distinct from 'otro' or nullif(btrim(lost_detail), '') is not null)
  and (lost_detail is null or char_length(lost_detail) <= 300)
);

alter table public.inquiries drop constraint if exists inquiries_lost_reason_check;
alter table public.inquiries add constraint inquiries_lost_reason_check check (
  (lost_reason is null or lost_reason in ('precio', 'plazo', 'competencia', 'sin_stock', 'condiciones', 'sin_presupuesto', 'no_encaja', 'no_contesta', 'otro'))
  and (lost_reason is distinct from 'otro' or nullif(btrim(lost_detail), '') is not null)
  and (lost_detail is null or char_length(lost_detail) <= 300)
);

-- El nombre de cada motivo, con el que solo tienen los leads.
create or replace function public.lost_reason_label(p_reason text)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select case p_reason
    when 'precio' then 'Precio'
    when 'plazo' then 'Plazo de entrega'
    when 'competencia' then 'Se fue con la competencia'
    when 'sin_stock' then 'No lo tenemos o sin stock'
    when 'condiciones' then 'Condiciones de pago'
    when 'sin_presupuesto' then 'Sin presupuesto o lo aplaza'
    when 'no_encaja' then 'No es lo que necesitaba'
    when 'solo_informacion' then 'Solo quería información'
    when 'no_contesta' then 'Dejó de contestar'
    when 'otro' then 'Otro motivo'
    else p_reason
  end;
$$;

-- ---------- Quién lo puso ----------

/*
  «persona» o «ia». La IA no decide sola: propone un motivo a partir de lo que
  el comercial cuenta con sus palabras, y quien lo guarda es él. Pero si lo
  guarda tal cual lo propuso, se apunta que salió de la IA, para que en el
  reparto se sepa cuánto de lo que dice lo eligió una máquina.
*/
alter table public.leads add column if not exists lost_reason_source text;
alter table public.inquiries add column if not exists lost_reason_source text;

alter table public.leads drop constraint if exists leads_lost_reason_source_check;
alter table public.leads add constraint leads_lost_reason_source_check
  check (lost_reason_source is null or lost_reason_source in ('persona', 'ia'));
alter table public.inquiries drop constraint if exists inquiries_lost_reason_source_check;
alter table public.inquiries add constraint inquiries_lost_reason_source_check
  check (lost_reason_source is null or lost_reason_source in ('persona', 'ia'));

comment on column public.leads.lost_reason_source is 'Quién eligió el motivo de pérdida: persona o ia. Nulo sin motivo.';
comment on column public.inquiries.lost_reason_source is 'Quién eligió el motivo de pérdida: persona o ia. Nulo sin motivo.';

-- Fuera de «perdido», sin motivo ni autor del motivo. Y un motivo sin autor
-- dicho es de una persona: es lo que pasa con cualquier pantalla que no lo diga.
create or replace function public.limpiar_motivo_de_perdida()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if coalesce(new.status::text, '') not in ('lost', 'perdido') then
    new.lost_reason := null;
    new.lost_detail := null;
    new.lost_reason_source := null;
  else
    new.lost_detail := nullif(btrim(new.lost_detail), '');
    if new.lost_reason is null then
      new.lost_reason_source := null;
    elsif new.lost_reason_source is null then
      new.lost_reason_source := 'persona';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.limpiar_motivo_de_perdida() from public, anon, authenticated;
