-- Compras: los pedidos a proveedor y el control de sus fechas de entrega.
--
-- El problema: se manda el pedido, el proveedor confirma por correo una fecha
-- estimada, alguien la teclea en Sage y, cuando el proveedor no contesta, no
-- hay quien lleve la cuenta de a quién hay que reclamar ni cuántas veces.
--
-- Tres tablas, y la frontera entre ellas importa:
--
--   · sage_purchase_orders y sage_purchase_order_lines son espejo de Sage: las
--     escribe el agente y nadie más. Si algo no cuadra, se arregla en Sage.
--   · purchase_order_tracking es nuestra: el estado de la reclamación, la fecha
--     que confirmó el proveedor y por dónde la dijo. Esto no existe en Sage y
--     no se le pide que exista.
--
-- Por qué la fecha confirmada vive aquí y no se escribe en Sage: se graba allí
-- "para tener control y no perder el control", no porque ningún programa la
-- consuma. Ese control lo lleva mejor esta pantalla —con reclamaciones,
-- historial y avisos de vencido— que una casilla. Y el agente de Sage entra con
-- un usuario de solo lectura a propósito: esa frontera no se cruza por una
-- comodidad.
--
-- Se puede volver a ejecutar sin romper nada.

-- ---------- Espejo de Sage: lo que el agente manda ----------

create table if not exists public.sage_purchase_orders (
  company_code smallint not null references public.sage_companies(code) on delete cascade,
  year smallint not null,
  series text not null default '',
  number integer not null,
  order_date date not null,
  supplier_code text,
  /** La fecha de recepción de la cabecera, tal como está en Sage. */
  expected_on date,
  status smallint,
  net_amount numeric(14, 2) not null default 0,
  pending_amount numeric(14, 2) not null default 0,
  lines integer not null default 0,
  /** Unidades pendientes de recibir sumando sus líneas: si es 0, el pedido llegó. */
  pending_units numeric(14, 4) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (company_code, year, series, number)
);
create index if not exists sage_purchase_orders_pending_idx
  on public.sage_purchase_orders (company_code, supplier_code) where pending_units > 0;
create index if not exists sage_purchase_orders_expected_idx on public.sage_purchase_orders (expected_on);

comment on table public.sage_purchase_orders is
  'Pedidos a proveedor, espejo de Sage. Lo escribe el agente; nadie edita esto a mano.';

create table if not exists public.sage_purchase_order_lines (
  company_code smallint not null references public.sage_companies(code) on delete cascade,
  year smallint not null,
  series text not null default '',
  number integer not null,
  line_number integer not null,
  article_code text,
  description text not null default '',
  quantity numeric(14, 4) not null default 0,
  /** Lo que falta por recibir de esta línea. */
  pending_units numeric(14, 4) not null default 0,
  /** La fecha de recepción de la línea. Es la que manda: el proveedor confirma por línea. */
  expected_on date,
  net_amount numeric(14, 2) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (company_code, year, series, number, line_number)
);
create index if not exists sage_purchase_order_lines_pedido_idx
  on public.sage_purchase_order_lines (company_code, year, series, number);

comment on column public.sage_purchase_order_lines.expected_on is
  'Fecha de recepción de la línea en Sage. Una línea con fecha se da por confirmada y no se reclama.';

-- ---------- Lo nuestro: el control de la reclamación ----------

create table if not exists public.purchase_order_tracking (
  id uuid primary key default gen_random_uuid(),
  company_code smallint not null,
  year smallint not null,
  series text not null default '',
  number integer not null,
  /*
   * En qué anda este pedido:
   *   · sin_confirmar: falta fecha y toca reclamar.
   *   · reclamado: se le ha escrito y se espera respuesta.
   *   · confirmado: hay fecha, venga de Sage o del enlace.
   *   · pausado: el proveedor dijo "ya contesté" o alguien lo paró a mano.
   *   · sin_reclamar: a este proveedor no se le reclama por correo (solo teléfono).
   */
  state text not null default 'sin_confirmar'
    check (state in ('sin_confirmar', 'reclamado', 'confirmado', 'pausado', 'sin_reclamar')),
  /** Por qué escalón va: 0 ninguna, 1 primera, 2 segunda, 3 tercera y aviso interno. */
  level smallint not null default 0 check (level between 0 and 3),
  last_chased_at timestamptz,
  /** Hasta cuándo no se le vuelve a escribir. Lo pone la pausa o la ventana de silencio. */
  quiet_until timestamptz,
  /** La fecha que confirmó el proveedor, si no está en Sage. */
  confirmed_on date,
  confirmed_source text check (confirmed_source in ('sage', 'enlace', 'a_mano')),
  confirmed_at timestamptz,
  notes text,
  updated_at timestamptz not null default now(),
  unique (company_code, year, series, number)
);
create index if not exists purchase_order_tracking_estado_idx on public.purchase_order_tracking (state, level);

comment on table public.purchase_order_tracking is
  'El seguimiento de cada pedido a proveedor: a quién se ha reclamado, cuántas veces y qué fecha confirmó. Esto no está en Sage.';

-- Cada correo que sale, apuntado. Es lo que impide mandar dos veces lo mismo:
-- si el cron falla a medias y se repite, el envío ya está escrito y no se
-- vuelve a hacer.
create table if not exists public.purchase_order_chases (
  id uuid primary key default gen_random_uuid(),
  company_code smallint not null,
  supplier_code text not null,
  level smallint not null check (level between 1 and 3),
  sent_at timestamptz not null default now(),
  /** Los pedidos que iban en ese correo, para poder mirar atrás. */
  orders jsonb not null default '[]'::jsonb,
  to_email text,
  ok boolean not null default true,
  message text
);
create index if not exists purchase_order_chases_proveedor_idx
  on public.purchase_order_chases (company_code, supplier_code, sent_at desc);

-- ---------- Quién puede ver esto ----------
-- De momento, quien ya ve el resto de Sage. Si compras acaba siendo su propio
-- rol, se añade aquí y en el menú, no en veinte sitios.

alter table public.sage_purchase_orders enable row level security;
alter table public.sage_purchase_order_lines enable row level security;
alter table public.purchase_order_tracking enable row level security;
alter table public.purchase_order_chases enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['sage_purchase_orders', 'sage_purchase_order_lines',
                           'purchase_order_tracking', 'purchase_order_chases']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select public.current_user_has_any_role(ARRAY[''admin'',''direction'']::app_role[])))',
      t || '_read', t);
  end loop;
end $$;

-- El seguimiento sí se toca desde la pantalla: pausar, marcar confirmado a mano
-- o dejar de reclamar a un proveedor.
drop policy if exists purchase_order_tracking_write on public.purchase_order_tracking;
create policy purchase_order_tracking_write on public.purchase_order_tracking
  for all to authenticated
  using ((select public.current_user_has_any_role(array['admin', 'direction']::app_role[])))
  with check ((select public.current_user_has_any_role(array['admin', 'direction']::app_role[])));

-- ---------- Cómo entran los datos del agente ----------
-- Su propia función, como la de pagos: así se añade un bloque sin tocar las
-- cuatrocientas líneas de sage_ingest, donde está todo lo demás.
--
-- Al revés que las ventas, aquí no se borra por fechas antes de escribir: un
-- pedido a proveedor vive abierto meses y el agente manda los pendientes, no
-- una ventana de días. Se actualiza lo que llega y lo demás se queda.

create or replace function public.sage_ingest_purchases(p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_counts jsonb := '{}'::jsonb;
  v_n integer;
begin
  perform pg_advisory_xact_lock(hashtext('public.sage_ingest'));

  if jsonb_typeof(p->'purchase_orders') = 'array' then
    insert into sage_purchase_orders (company_code, year, series, number, order_date, supplier_code, expected_on,
                                      status, net_amount, pending_amount, lines, pending_units, updated_at)
    select x.company_code, x.year, coalesce(x.series, ''), x.number, x.order_date, x.supplier_code, x.expected_on,
           x.status, x.net_amount, coalesce(x.pending_amount, 0), coalesce(x.lines, 0), coalesce(x.pending_units, 0), now()
    from jsonb_to_recordset(p->'purchase_orders') as x(company_code smallint, year smallint, series text, number integer,
         order_date date, supplier_code text, expected_on date, status smallint, net_amount numeric,
         pending_amount numeric, lines integer, pending_units numeric)
    on conflict (company_code, year, series, number) do update set
      order_date = excluded.order_date, supplier_code = excluded.supplier_code, expected_on = excluded.expected_on,
      status = excluded.status, net_amount = excluded.net_amount, pending_amount = excluded.pending_amount,
      lines = excluded.lines, pending_units = excluded.pending_units, updated_at = now();
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('purchase_orders', v_n);
  end if;

  if jsonb_typeof(p->'purchase_order_lines') = 'array' then
    insert into sage_purchase_order_lines (company_code, year, series, number, line_number, article_code, description,
                                           quantity, pending_units, expected_on, net_amount, updated_at)
    select x.company_code, x.year, coalesce(x.series, ''), x.number, x.line_number, x.article_code,
           coalesce(x.description, ''), coalesce(x.quantity, 0), coalesce(x.pending_units, 0), x.expected_on,
           coalesce(x.net_amount, 0), now()
    from jsonb_to_recordset(p->'purchase_order_lines') as x(company_code smallint, year smallint, series text,
         number integer, line_number integer, article_code text, description text, quantity numeric,
         pending_units numeric, expected_on date, net_amount numeric)
    on conflict (company_code, year, series, number, line_number) do update set
      article_code = excluded.article_code, description = excluded.description, quantity = excluded.quantity,
      pending_units = excluded.pending_units, expected_on = excluded.expected_on,
      net_amount = excluded.net_amount, updated_at = now();
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('purchase_order_lines', v_n);
  end if;

  return v_counts;
end;
$$;

revoke execute on function public.sage_ingest_purchases(jsonb) from public, anon, authenticated;
grant execute on function public.sage_ingest_purchases(jsonb) to service_role;
