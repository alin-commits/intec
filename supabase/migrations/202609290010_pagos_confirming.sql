-- Pagos a proveedores: confirming, cartera pendiente y tesorería.
--
-- Las remesas de pagos se siguen haciendo en Sage. Lo que Sage no sabe hacer es
-- el fichero de confirming en el formato de cada banco (Sabadell, Bankinter y
-- BBVA), y eso es lo que hace el Hub: lee cada remesa y la convierte en fichero.
--
-- Qué llega de Sage (el agente solo lee):
--   - los datos de cada sociedad que paga (NIF y domicilio);
--   - los proveedores de los pagos (NIF, domicilio, correo, teléfono);
--   - las remesas de pagos de los últimos meses, cada una con sus efectos
--     (factura del proveedor, vencimiento, importe e IBAN);
--   - la cartera pendiente de cobros y pagos, para la previsión de tesorería.
-- Qué se pone en el Hub: el contrato de confirming de cada sociedad con cada
-- banco (no está en Sage) y el registro de cada fichero generado.
--
-- Quién lo ve: dirección y administración. Hay IBAN de proveedores: nadie más.

-- ---------- Sociedades: lo que hace falta para el fichero ----------
create table if not exists public.sage_company_details (
  company_code smallint primary key references public.sage_companies(code) on delete cascade,
  nif text,
  address text,
  postal_code text,
  city text,
  province text,
  updated_at timestamptz not null default now()
);

-- ---------- Proveedores ----------
create table if not exists public.sage_suppliers (
  company_code smallint not null references public.sage_companies(code) on delete cascade,
  code text not null,
  name text not null,
  trade_name text,
  nif text,
  address text,
  postal_code text,
  city text,
  province text,
  country text,
  phone text,
  email text,
  updated_at timestamptz not null default now(),
  primary key (company_code, code)
);

-- ---------- Remesas de pagos de Sage ----------
create table if not exists public.sage_payment_remittances (
  company_code smallint not null references public.sage_companies(code) on delete cascade,
  number integer not null,
  remittance_date date,
  value_date date,
  -- El banco de la remesa tal como lo guarda Sage (su código o su cuenta).
  bank_code text not null default '',
  remittance_type text,
  csb_norm text,
  total numeric(14, 2) not null default 0,
  effects integer not null default 0,
  provisional boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (company_code, number)
);
create index if not exists sage_payment_remittances_date_idx on public.sage_payment_remittances (remittance_date desc);

create table if not exists public.sage_payment_remittance_items (
  company_code smallint not null references public.sage_companies(code) on delete cascade,
  remittance_number integer not null,
  -- El identificador del efecto en Sage (MovPosicion).
  movement_id text not null,
  effect_number integer,
  supplier_code text not null,
  invoice_number text,
  invoice_date date,
  due_date date,
  amount numeric(14, 2) not null default 0,
  pending numeric(14, 2) not null default 0,
  iban text,
  primary key (company_code, movement_id)
);
create index if not exists sage_payment_remittance_items_remittance_idx on public.sage_payment_remittance_items (company_code, remittance_number);
create index if not exists sage_payment_remittance_items_supplier_idx on public.sage_payment_remittance_items (company_code, supplier_code);

-- ---------- Cartera pendiente (foto del día) ----------
-- kind: 'cobro' | 'pago'. Se reescribe entera en cada lectura.
create table if not exists public.sage_open_items (
  id bigint generated always as identity primary key,
  company_code smallint not null references public.sage_companies(code) on delete cascade,
  kind text not null check (kind in ('cobro', 'pago')),
  movement_id text,
  counterpart_code text not null,
  invoice_number text,
  invoice_date date,
  due_date date,
  amount numeric(14, 2) not null default 0,
  pending numeric(14, 2) not null default 0,
  remittance_number integer,
  bank_code text,
  effect_type text,
  taken_on date not null default current_date
);
create index if not exists sage_open_items_due_idx on public.sage_open_items (company_code, kind, due_date);

-- ---------- El contrato de confirming de cada sociedad con cada banco ----------
-- No está en Sage: lo pone administración. `sage_bank_code` es el banco de la
-- remesa tal como sale en Sage; así cada remesa sabe qué contrato le toca.
create table if not exists public.payment_bank_settings (
  id uuid primary key default gen_random_uuid(),
  company_code smallint not null references public.sage_companies(code) on delete cascade,
  sage_bank_code text not null,
  bank_name text not null,
  format text not null check (format in ('aef', 'bbva')),
  contract text not null default '',
  suffix text,
  charge_iban text,
  modality text not null default 'pronto_pago' check (modality in ('estandar', 'pronto_pago', 'otros')),
  deferral_days integer check (deferral_days between 0 and 720),
  write_charge_date boolean not null default false,
  fallback_email text,
  active boolean not null default true,
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now(),
  unique (company_code, sage_bank_code)
);

drop trigger if exists payment_bank_settings_set_updated_at on public.payment_bank_settings;
create trigger payment_bank_settings_set_updated_at before update on public.payment_bank_settings
for each row execute function public.set_updated_at();

-- ---------- Cada fichero generado ----------
-- Se guarda el contenido para poder volver a descargarlo tal cual y saber qué
-- se mandó, a qué cuentas, quién y cuándo.
create table if not exists public.payment_files (
  id uuid primary key default gen_random_uuid(),
  company_code smallint not null references public.sage_companies(code) on delete cascade,
  remittance_number integer not null,
  bank_setting_id uuid references public.payment_bank_settings(id) on delete set null,
  bank_name text not null,
  format text not null,
  file_name text not null,
  content text not null,
  suppliers integer not null default 0,
  payments integer not null default 0,
  total numeric(14, 2) not null default 0,
  warnings text[] not null default '{}',
  generated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  generated_at timestamptz not null default now()
);
create index if not exists payment_files_remittance_idx on public.payment_files (company_code, remittance_number, generated_at desc);

-- ---------- Quién puede ver y tocar esto ----------
alter table public.sage_company_details enable row level security;
alter table public.sage_suppliers enable row level security;
alter table public.sage_payment_remittances enable row level security;
alter table public.sage_payment_remittance_items enable row level security;
alter table public.sage_open_items enable row level security;
alter table public.payment_bank_settings enable row level security;
alter table public.payment_files enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['sage_company_details', 'sage_suppliers', 'sage_payment_remittances',
                           'sage_payment_remittance_items', 'sage_open_items', 'payment_bank_settings', 'payment_files']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select public.current_user_has_any_role(ARRAY[''admin'',''direction'']::app_role[])))',
      t || '_read', t);
  end loop;
end $$;

-- La configuración de los bancos la ponen dirección o administración.
drop policy if exists payment_bank_settings_write on public.payment_bank_settings;
create policy payment_bank_settings_write on public.payment_bank_settings
for all to authenticated
  using ((select public.current_user_has_any_role(ARRAY['admin','direction']::app_role[])))
  with check ((select public.current_user_has_any_role(ARRAY['admin','direction']::app_role[])));

-- Los ficheros solo se apuntan (nunca se cambian ni se borran): son el registro.
drop policy if exists payment_files_insert on public.payment_files;
create policy payment_files_insert on public.payment_files
for insert to authenticated
  with check ((select public.current_user_has_any_role(ARRAY['admin','direction']::app_role[])) and generated_by = auth.uid());

-- ---------- La recepción de lo que manda el agente ----------
-- Aparte de sage_ingest, que ya es grande y funciona: esta solo toca lo de
-- pagos. Cada parte solo se toca si viene en `p`.
--   company_details, suppliers     se añaden o actualizan;
--   payment_remittances            cada remesa que viene se reescribe entera
--                                  (cabecera y efectos);
--   open_items                     la cartera pendiente; con open_items_replace
--                                  se borra la foto anterior antes (el agente
--                                  la manda por trozos y solo el primero lo lleva).
create or replace function public.sage_ingest_payments(p jsonb)
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

  if jsonb_typeof(p->'company_details') = 'array' then
    insert into sage_company_details (company_code, nif, address, postal_code, city, province, updated_at)
    select x.company_code, x.nif, x.address, x.postal_code, x.city, x.province, now()
    from jsonb_to_recordset(p->'company_details') as x(company_code smallint, nif text, address text, postal_code text, city text, province text)
    where exists (select 1 from sage_companies c where c.code = x.company_code)
    on conflict (company_code) do update set nif = excluded.nif, address = excluded.address, postal_code = excluded.postal_code,
      city = excluded.city, province = excluded.province, updated_at = now();
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('company_details', v_n);
  end if;

  if jsonb_typeof(p->'suppliers') = 'array' then
    insert into sage_suppliers (company_code, code, name, trade_name, nif, address, postal_code, city, province, country, phone, email, updated_at)
    select x.company_code, x.code, x.name, x.trade_name, x.nif, x.address, x.postal_code, x.city, x.province, x.country, x.phone, x.email, now()
    from jsonb_to_recordset(p->'suppliers') as x(company_code smallint, code text, name text, trade_name text, nif text, address text,
      postal_code text, city text, province text, country text, phone text, email text)
    where exists (select 1 from sage_companies c where c.code = x.company_code)
    on conflict (company_code, code) do update set name = excluded.name, trade_name = excluded.trade_name, nif = excluded.nif,
      address = excluded.address, postal_code = excluded.postal_code, city = excluded.city, province = excluded.province,
      country = excluded.country, phone = excluded.phone, email = excluded.email, updated_at = now();
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('suppliers', v_n);
  end if;

  if jsonb_typeof(p->'payment_remittances') = 'array' then
    delete from sage_payment_remittance_items i
    using jsonb_to_recordset(p->'payment_remittances') as x(company_code smallint, number integer)
    where i.company_code = x.company_code and i.remittance_number = x.number;

    insert into sage_payment_remittances (company_code, number, remittance_date, value_date, bank_code, remittance_type, csb_norm,
      total, effects, provisional, updated_at)
    select x.company_code, x.number, x.remittance_date, x.value_date, coalesce(x.bank_code, ''), x.remittance_type, x.csb_norm,
      coalesce(x.total, 0), coalesce(x.effects, 0), coalesce(x.provisional, false), now()
    from jsonb_to_recordset(p->'payment_remittances') as x(company_code smallint, number integer, remittance_date date, value_date date,
      bank_code text, remittance_type text, csb_norm text, total numeric, effects integer, provisional boolean)
    where exists (select 1 from sage_companies c where c.code = x.company_code)
    on conflict (company_code, number) do update set remittance_date = excluded.remittance_date, value_date = excluded.value_date,
      bank_code = excluded.bank_code, remittance_type = excluded.remittance_type, csb_norm = excluded.csb_norm,
      total = excluded.total, effects = excluded.effects, provisional = excluded.provisional, updated_at = now();
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('payment_remittances', v_n);
  end if;

  if jsonb_typeof(p->'payment_items') = 'array' then
    insert into sage_payment_remittance_items (company_code, remittance_number, movement_id, effect_number, supplier_code,
      invoice_number, invoice_date, due_date, amount, pending, iban)
    select x.company_code, x.remittance_number, x.movement_id, x.effect_number, x.supplier_code, x.invoice_number,
      x.invoice_date, x.due_date, coalesce(x.amount, 0), coalesce(x.pending, 0), x.iban
    from jsonb_to_recordset(p->'payment_items') as x(company_code smallint, remittance_number integer, movement_id text,
      effect_number integer, supplier_code text, invoice_number text, invoice_date date, due_date date, amount numeric,
      pending numeric, iban text)
    where exists (select 1 from sage_companies c where c.code = x.company_code)
    on conflict (company_code, movement_id) do update set remittance_number = excluded.remittance_number,
      effect_number = excluded.effect_number, supplier_code = excluded.supplier_code, invoice_number = excluded.invoice_number,
      invoice_date = excluded.invoice_date, due_date = excluded.due_date, amount = excluded.amount, pending = excluded.pending,
      iban = excluded.iban;
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('payment_items', v_n);
  end if;

  if jsonb_typeof(p->'open_items') = 'array' then
    if coalesce((p->>'open_items_replace')::boolean, false) then
      -- Con condición explícita: Supabase puede rechazar un delete sin where.
      delete from sage_open_items where id is not null;
    end if;
    insert into sage_open_items (company_code, kind, movement_id, counterpart_code, invoice_number, invoice_date, due_date,
      amount, pending, remittance_number, bank_code, effect_type, taken_on)
    select x.company_code, x.kind, x.movement_id, x.counterpart_code, x.invoice_number, x.invoice_date, x.due_date,
      coalesce(x.amount, 0), coalesce(x.pending, 0), x.remittance_number, x.bank_code, x.effect_type, coalesce(x.taken_on, current_date)
    from jsonb_to_recordset(p->'open_items') as x(company_code smallint, kind text, movement_id text, counterpart_code text,
      invoice_number text, invoice_date date, due_date date, amount numeric, pending numeric, remittance_number integer,
      bank_code text, effect_type text, taken_on date)
    where exists (select 1 from sage_companies c where c.code = x.company_code) and x.kind in ('cobro', 'pago');
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('open_items', v_n);
  end if;

  return v_counts;
end;
$$;

revoke execute on function public.sage_ingest_payments(jsonb) from public, anon, authenticated;
grant execute on function public.sage_ingest_payments(jsonb) to service_role;
