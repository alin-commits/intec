-- Agencia: lo que se gasta con la agencia por marca, frente a lo que venden
-- las consultas de esa marca.
--
-- Todo el gasto de la agencia de una marca —SEO, SEM, lo que sea— es una sola
-- inversión, y todas las consultas de la marca cuentan contra ella, menos las
-- de Portales/RRSS (que no son cosa de la agencia) y los leads (que van por
-- campañas y tienen su propio panel). El reparto por concepto es solo para
-- ver en qué se va el dinero: las consultas no se reparten entre SEO y SEM.
--
-- Se puede volver a ejecutar sin romper nada.

-- ---------- El presupuesto ----------

/*
  Una partida: tanto al mes, desde un mes y hasta otro (o sin final). Un gasto
  de una sola vez es una partida que empieza y acaba el mismo mes.

  Sin marca, es de todas sin repartir —una cuota que la agencia cobra por el
  conjunto—: cuenta en el total, pero no en el retorno de ninguna marca.
*/
create table if not exists public.agency_budget_lines (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid references public.business_units(id) on delete cascade,
  concept text not null check (char_length(btrim(concept)) between 1 and 80),
  monthly_amount numeric(12, 2) not null check (monthly_amount >= 0),
  -- Siempre el día 1: el gasto va por meses.
  start_month date not null check (extract(day from start_month) = 1),
  end_month date check (end_month is null or (extract(day from end_month) = 1 and end_month >= start_month)),
  notes text check (notes is null or char_length(notes) <= 500),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists agency_budget_lines_unit on public.agency_budget_lines (business_unit_id);

drop trigger if exists agency_budget_lines_set_updated_at on public.agency_budget_lines;
create trigger agency_budget_lines_set_updated_at before update on public.agency_budget_lines
for each row execute function public.set_updated_at();

-- Lo ven administración, marketing y dirección; lo apuntan administración y
-- marketing, como los gastos de marketing.
alter table public.agency_budget_lines enable row level security;
drop policy if exists agency_budget_lines_read on public.agency_budget_lines;
create policy agency_budget_lines_read on public.agency_budget_lines for select to authenticated
  using ((select public.current_user_has_any_role(ARRAY['admin','marketing','direction']::app_role[])));
drop policy if exists agency_budget_lines_write on public.agency_budget_lines;
create policy agency_budget_lines_write on public.agency_budget_lines for all to authenticated
  using ((select public.current_user_has_any_role(ARRAY['admin','marketing']::app_role[])))
  with check ((select public.current_user_has_any_role(ARRAY['admin','marketing']::app_role[])));

-- ---------- Lo que dan las consultas ----------

/*
  Consultas y lo que venden, por mes y marca, sin las de Portales/RRSS.

  Solo totales: ni nombres, ni teléfonos, ni la consulta en sí. Por eso va
  como definer: marketing no lee las consultas (son de comercial), pero sí
  tiene que poder ver cuántas hay y cuánto venden. Quien no es de
  administración, marketing o dirección no recibe nada.

  - Las consultas cuentan el mes en que se apuntan; las semanales, el de su
    semana, con lo que diga su recuento.
  - Las ventas cuentan el mes en que la consulta pasó a ganada (la fecha del
    apunte de venta, que el disparador mueve al cambiar de etapa).
  - Lo ofertado es lo que sigue en oferta o en seguimiento: puede acabar en
    venta, todavía no lo es.
  - Las ventas semanales que se apuntan a mano no llevan canal, así que no se
    puede saber si vienen de RRSS: no entran.
*/
create or replace function public.agency_inquiry_summary(p_from date, p_to date)
returns table(month text, business_unit_id uuid, inquiries bigint, won bigint, won_amount numeric, offered bigint, offered_amount numeric)
language sql
stable
security definer
set search_path = public
as $$
  with permiso as (
    select public.current_user_has_any_role(ARRAY['admin','marketing','direction']::app_role[]) as ok
  ),
  consultas as (
    select to_char(coalesce(i.week_start, (i.created_at at time zone 'Europe/Madrid')::date), 'YYYY-MM') as mes,
           i.business_unit_id as marca,
           sum(greatest(coalesce(i.count, 1), 0))::bigint as n
    from inquiries i
    where i.inquiry_type <> 'portal_rrss'
      and coalesce(i.week_start, (i.created_at at time zone 'Europe/Madrid')::date) between p_from and p_to
    group by 1, 2
  ),
  ventas as (
    select to_char(s.occurred_on, 'YYYY-MM') as mes,
           s.business_unit_id as marca,
           count(*) filter (where s.sale_type = 'pedido') as ganadas,
           coalesce(sum(s.value) filter (where s.sale_type = 'pedido'), 0) as vendido,
           count(*) filter (where s.sale_type in ('oferta', 'seguimiento')) as ofertas,
           coalesce(sum(s.value) filter (where s.sale_type in ('oferta', 'seguimiento')), 0) as ofertado
    from sales_entries s
    join inquiries i on i.id = s.inquiry_id
    where s.entry_mode = 'inquiry'
      and i.inquiry_type <> 'portal_rrss'
      and s.occurred_on between p_from and p_to
    group by 1, 2
  )
  select coalesce(c.mes, v.mes), coalesce(c.marca, v.marca),
         coalesce(c.n, 0)::bigint, coalesce(v.ganadas, 0)::bigint, coalesce(v.vendido, 0)::numeric,
         coalesce(v.ofertas, 0)::bigint, coalesce(v.ofertado, 0)::numeric
  from consultas c
  full join ventas v on v.mes = c.mes and v.marca = c.marca
  where (select ok from permiso);
$$;
revoke execute on function public.agency_inquiry_summary(date, date) from public, anon;
grant execute on function public.agency_inquiry_summary(date, date) to authenticated;
