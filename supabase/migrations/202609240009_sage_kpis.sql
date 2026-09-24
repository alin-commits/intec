-- Donde aterrizan las cifras que llegan de Sage 200.
--
-- El agente que corre en el servidor de Sage no manda documentos ni clientes:
-- manda totales ya calculados, un día por fila. Aquí solo se guardan y se leen.
--
-- Quién lo ve: dirección y administración. Escribir, solo el servidor con el
-- rol de servicio, que es quien recibe el envío del agente.

-- ---------- Las sociedades ----------
-- Las cuatro empresas viven en la misma base de datos de Sage, separadas por un
-- código. Aquí se guardan con su nombre para no enseñar "empresa 1".
create table if not exists public.sage_companies (
  code smallint primary key,
  name text not null,
  -- Las de demostración y pruebas de Sage se marcan y no se enseñan.
  is_active boolean not null default true,
  updated_at timestamptz not null default now()
);

-- ---------- Los comerciales ----------
-- La misma persona tiene un código distinto en cada sociedad, así que la clave
-- es la pareja. `person` es el nombre unificado, para poder sumar a alguien que
-- vende en varias sociedades; se rellena a mano una vez.
create table if not exists public.sage_reps (
  company_code smallint not null references public.sage_companies(code) on delete cascade,
  code integer not null,
  name text not null,
  person text,
  /* Los códigos "GENERAL" y "Alta Automática" no son personas: las ventas que
     cuelgan de ellos se enseñan como "sin asignar", ni repartidas ni ocultas. */
  is_person boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (company_code, code)
);

-- ---------- Las ventas, un día por fila ----------
-- `basis` distingue las dos maneras de fechar una venta, porque en Sage las dos
-- viven en el mismo albarán: 'albaran' es cuándo se sirvió y 'factura' cuándo se
-- facturó. Se guardan las dos y el panel enseña la que Dirección prefiera, sin
-- tener que volver a leer Sage.
create table if not exists public.sage_sales_daily (
  company_code smallint not null references public.sage_companies(code) on delete cascade,
  basis text not null check (basis in ('albaran', 'factura')),
  day date not null,
  -- La serie es el canal: TK tienda, B2C web, B2B, SAT servicio técnico, CRE crédito.
  series text not null default '',
  rep_code integer,
  documents integer not null default 0,
  -- Las devoluciones vienen en negativo y restan, que es lo correcto.
  net_amount numeric(14, 2) not null default 0,
  cost_amount numeric(14, 2) not null default 0,
  vat_amount numeric(14, 2) not null default 0,
  primary key (company_code, basis, day, series, rep_code)
);
create index if not exists sage_sales_daily_day_idx on public.sage_sales_daily (day);
create index if not exists sage_sales_daily_company_idx on public.sage_sales_daily (company_code, basis, day);

-- Postgres no considera iguales dos filas con rep_code nulo, así que la clave
-- primaria no impediría duplicados de las ventas sin comercial asignado.
create unique index if not exists sage_sales_daily_sin_comercial_idx
  on public.sage_sales_daily (company_code, basis, day, series)
  where rep_code is null;

-- ---------- El registro de cada envío ----------
-- Para saber de cuándo son las cifras que se están mirando, y para que se note
-- si el agente deja de enviar.
create table if not exists public.sage_sync_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  -- Hasta dónde se ha leído: el agente manda siempre una ventana de días.
  covered_from date,
  covered_to date,
  rows_written integer not null default 0,
  ok boolean not null default false,
  message text
);
create index if not exists sage_sync_runs_started_idx on public.sage_sync_runs (started_at desc);

-- ---------- Quién puede ver esto ----------
alter table public.sage_companies enable row level security;
alter table public.sage_reps enable row level security;
alter table public.sage_sales_daily enable row level security;
alter table public.sage_sync_runs enable row level security;

-- Solo lectura, y solo para dirección y administración. No hay política de
-- escritura a propósito: escribe el servidor con el rol de servicio, que es el
-- único que recibe el envío del agente y comprueba su clave.
drop policy if exists sage_companies_read on public.sage_companies;
create policy sage_companies_read on public.sage_companies
for select to authenticated
  using ((select public.current_user_has_any_role(ARRAY['admin','direction']::app_role[])));

drop policy if exists sage_reps_read on public.sage_reps;
create policy sage_reps_read on public.sage_reps
for select to authenticated
  using ((select public.current_user_has_any_role(ARRAY['admin','direction']::app_role[])));

drop policy if exists sage_sales_daily_read on public.sage_sales_daily;
create policy sage_sales_daily_read on public.sage_sales_daily
for select to authenticated
  using ((select public.current_user_has_any_role(ARRAY['admin','direction']::app_role[])));

drop policy if exists sage_sync_runs_read on public.sage_sync_runs;
create policy sage_sync_runs_read on public.sage_sync_runs
for select to authenticated
  using ((select public.current_user_has_any_role(ARRAY['admin','direction']::app_role[])));
