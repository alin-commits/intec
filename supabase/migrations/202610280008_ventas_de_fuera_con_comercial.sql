-- El comercial de las ventas que no pasaron por Sage.
--
-- Hasta ahora de estas cifras solo se sabía el mes y la sociedad, así que en
-- cuanto se miraba por comercial no se podían sumar: habrían aparecido en el
-- año de todos los comerciales, regalándole a cada uno una venta que no era
-- suya. Pero sí se sabe de quién son —en el cuadro de dirección cada bloque
-- tiene su agente—, y sin esa columna lo de Jender de 2025 desaparecía justo
-- de la pantalla de quien lo vendió.
--
-- Va por código de ficha y no por nombre porque el mismo número es otra
-- persona en otra sociedad: la pareja (company_code, rep_code) es la que
-- identifica a alguien en Sage, y es la que el panel junta cuando una persona
-- tiene ficha repetida. Nulo cuando la cifra no es de nadie en concreto, y
-- entonces sigue sin sumar en ninguna pantalla por comercial.

alter table public.external_sales
  add column if not exists rep_code smallint;

comment on column public.external_sales.rep_code is
  'La ficha de comercial de Sage dentro de company_code, cuando se sabe de quién es la venta. Nula si no.';

/*
  El tipo de retorno cambia, así que hay que tirarla antes: Postgres no deja
  cambiárselo con create or replace.
*/
drop function if exists public.external_sales_in_range(date, date, smallint[]);

/*
  Lo que hay que sumarle a un tramo, mes a mes.

  Devuelve una fila por mes y origen para que el panel pueda sumarlo al total
  y, a la vez, decir cuánto de ese total no viene de Sage. El tramo se mira
  por meses completos: estas cifras son mensuales y no se pueden partir por
  días sin inventar.

  Ahora lleva también el comercial, para que el panel pueda decidir si la cifra
  entra cuando se mira a una persona. Agrupa por él: dos orígenes del mismo mes
  y el mismo comercial se suman, igual que antes.
*/
create or replace function public.external_sales_in_range(p_from date, p_to date, p_companies smallint[] default null)
returns table(month date, source text, company_code smallint, rep_code smallint, net_amount numeric)
language sql
stable
security invoker
set search_path = public
as $$
  select e.month, e.source, e.company_code, e.rep_code, sum(e.net_amount)
  from external_sales e
  where e.month between date_trunc('month', p_from)::date and date_trunc('month', p_to)::date
    -- Una empresa que aún no está en Sage no tiene sociedad, así que un filtro
    -- por sociedades no puede dejarla fuera sin más: se queda cuando no hay
    -- filtro puesto y desaparece en cuanto alguien mira una sociedad concreta.
    and (p_companies is null or e.company_code = any(p_companies))
  group by e.month, e.source, e.company_code, e.rep_code
  order by e.month, e.source;
$$;

revoke execute on function public.external_sales_in_range(date, date, smallint[]) from public, anon;
grant execute on function public.external_sales_in_range(date, date, smallint[]) to authenticated;

comment on function public.external_sales_in_range(date, date, smallint[]) is
  'Las ventas de fuera de Sage de un tramo, por mes, origen, sociedad y comercial.';

/*
  Y a quién pertenece lo que ya hay cargado.

  Lo de Jender de enero a septiembre de 2025 es de la ficha 136 de la sociedad
  2, que es la que firma su venta en Sage de octubre en adelante y la que lleva
  ese bloque en el cuadro de dirección. Va por código y no por nombre a
  propósito: este repositorio es público.
*/
update public.external_sales
   set rep_code = 136
 where source = 'Jender' and company_code = 2 and rep_code is null;
