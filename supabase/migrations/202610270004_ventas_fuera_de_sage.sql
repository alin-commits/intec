-- Las ventas que no pasaron por Sage.
--
-- Hay empresas del grupo que se llevaron fuera de Sage hasta que entraron en
-- él: Jender hasta octubre de 2025, Blizcool todavía hoy. Su venta existió,
-- está en los cuadros de dirección, y al panel le faltaba — así que 2025
-- salía corto y nadie sabía cuánto.
--
-- Esto es una tabla aparte y no una fila más en las de Sage, por dos razones.
-- El agente reescribe lo suyo en cada lectura y se las llevaría por delante.
-- Y sobre todo: cuando un número no cuadra, en esta casa manda Sage, y eso
-- solo se puede sostener si se sabe en todo momento qué parte no viene de él.
-- Por eso cada fila dice de dónde sale y queda marcada para siempre.
--
-- Granularidad: sociedad y mes. No hay más en el origen —son cuadros de
-- dirección, no albaranes—, así que estas ventas pueden sumar en los totales
-- y en el reparto por mes, pero no en el de familias, clientes ni artículos.
-- Las pantallas que no pueden repartirlas lo dicen en vez de callárselo.
--
-- Se puede volver a ejecutar sin romper nada.

create table if not exists public.external_sales (
  id bigint generated always as identity primary key,
  -- Cómo se llama lo que se vendió fuera: «Jender», «Blizcool».
  source text not null,
  -- La sociedad de Sage a la que corresponde, si la hay. Nula mientras una
  -- empresa no esté dada de alta en Sage, que es el caso de Blizcool.
  company_code smallint references public.sage_companies(code) on delete set null,
  month date not null check (extract(day from month) = 1),
  net_amount numeric(14, 2) not null,
  -- De dónde salió la cifra, para poder volver sobre ella dentro de dos años.
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Una fila por origen y mes: cargar dos veces el mismo Excel no puede duplicar
-- la venta de un año entero.
create unique index if not exists external_sales_origen_mes on public.external_sales (source, month);
create index if not exists external_sales_mes on public.external_sales (month);

comment on table public.external_sales is
  'Ventas de empresas del grupo que no pasaron por Sage. Suman en los totales del panel y van marcadas por origen.';

alter table public.external_sales enable row level security;

-- Las lee quien lee el panel de ventas; las escribe solo administración, y a
-- mano: no hay ningún agente detrás de esto.
drop policy if exists external_sales_read on public.external_sales;
create policy external_sales_read on public.external_sales
for select to authenticated
  using ((select public.current_user_has_any_role(ARRAY['admin','direction','owner']::app_role[])));

drop policy if exists external_sales_write on public.external_sales;
create policy external_sales_write on public.external_sales
for all to authenticated
  using ((select public.current_user_has_any_role(ARRAY['admin','owner']::app_role[])))
  with check ((select public.current_user_has_any_role(ARRAY['admin','owner']::app_role[])));

/*
  Lo que hay que sumarle a un tramo, mes a mes.

  Devuelve una fila por mes y origen para que el panel pueda sumarlo al total
  y, a la vez, decir cuánto de ese total no viene de Sage. El tramo se mira
  por meses completos: estas cifras son mensuales y no se pueden partir por
  días sin inventar.
*/
create or replace function public.external_sales_in_range(p_from date, p_to date, p_companies smallint[] default null)
returns table(month date, source text, company_code smallint, net_amount numeric)
language sql
stable
security invoker
set search_path = public
as $$
  select e.month, e.source, e.company_code, sum(e.net_amount)
  from external_sales e
  where e.month between date_trunc('month', p_from)::date and date_trunc('month', p_to)::date
    -- Una empresa que aún no está en Sage no tiene sociedad, así que un filtro
    -- por sociedades no puede dejarla fuera sin más: se queda cuando no hay
    -- filtro puesto y desaparece en cuanto alguien mira una sociedad concreta.
    and (p_companies is null or e.company_code = any(p_companies))
  group by e.month, e.source, e.company_code
  order by e.month;
$$;

revoke all on function public.external_sales_in_range(date, date, smallint[]) from public, anon;
grant execute on function public.external_sales_in_range(date, date, smallint[]) to authenticated, service_role;
