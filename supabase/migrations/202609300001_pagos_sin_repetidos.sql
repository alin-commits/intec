-- La recepción de pagos admite filas repetidas en un mismo envío.
--
-- En la primera lectura real (29-30/09/2026) todos los envíos de pagos fallaron
-- con "ON CONFLICT DO UPDATE command cannot affect row a second time": dentro de
-- un mismo envío llegaba dos veces la misma clave. Lo más probable es que en
-- Sage una remesa de cobros y otra de pagos compartan número y, al cruzar las
-- tablas, la cabecera o sus efectos salgan repetidos. Como el envío entra entero
-- o no entra, no se guardaba nada de pagos.
--
-- Ahora cada parte se queda con una fila por clave antes de guardar (la última
-- que llega), y el recuento dice cuántas repetidas se descartaron para poder
-- afinar la lectura con los datos de verdad.

create or replace function public.sage_ingest_payments(p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_counts jsonb := '{}'::jsonb;
  v_n integer;
  v_total integer;
begin
  perform pg_advisory_xact_lock(hashtext('public.sage_ingest'));

  if jsonb_typeof(p->'company_details') = 'array' then
    insert into sage_company_details (company_code, nif, address, postal_code, city, province, updated_at)
    select distinct on (x.company_code) x.company_code, x.nif, x.address, x.postal_code, x.city, x.province, now()
    from rows from (jsonb_to_recordset(p->'company_details') as (company_code smallint, nif text, address text, postal_code text, city text, province text)) with ordinality as x(company_code, nif, address, postal_code, city, province, n)
    where exists (select 1 from sage_companies c where c.code = x.company_code)
    order by x.company_code, x.n desc
    on conflict (company_code) do update set nif = excluded.nif, address = excluded.address, postal_code = excluded.postal_code,
      city = excluded.city, province = excluded.province, updated_at = now();
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('company_details', v_n);
  end if;

  if jsonb_typeof(p->'suppliers') = 'array' then
    v_total := jsonb_array_length(p->'suppliers');
    insert into sage_suppliers (company_code, code, name, trade_name, nif, address, postal_code, city, province, country, phone, email, updated_at)
    select distinct on (x.company_code, x.code) x.company_code, x.code, x.name, x.trade_name, x.nif, x.address, x.postal_code, x.city,
      x.province, x.country, x.phone, x.email, now()
    from rows from (jsonb_to_recordset(p->'suppliers') as (company_code smallint, code text, name text, trade_name text, nif text, address text, postal_code text, city text, province text, country text, phone text, email text)) with ordinality as x(company_code, code, name, trade_name, nif, address, postal_code, city, province, country, phone, email, n)
    where exists (select 1 from sage_companies c where c.code = x.company_code)
    order by x.company_code, x.code, x.n desc
    on conflict (company_code, code) do update set name = excluded.name, trade_name = excluded.trade_name, nif = excluded.nif,
      address = excluded.address, postal_code = excluded.postal_code, city = excluded.city, province = excluded.province,
      country = excluded.country, phone = excluded.phone, email = excluded.email, updated_at = now();
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('suppliers', v_n);
    if v_total > v_n then v_counts := v_counts || jsonb_build_object('suppliers_repeated', v_total - v_n); end if;
  end if;

  if jsonb_typeof(p->'payment_remittances') = 'array' then
    delete from sage_payment_remittance_items i
    using (select distinct x.company_code, x.number
           from jsonb_to_recordset(p->'payment_remittances') as x(company_code smallint, number integer)) x
    where i.company_code = x.company_code and i.remittance_number = x.number;

    v_total := jsonb_array_length(p->'payment_remittances');
    insert into sage_payment_remittances (company_code, number, remittance_date, value_date, bank_code, remittance_type, csb_norm,
      total, effects, provisional, updated_at)
    select distinct on (x.company_code, x.number) x.company_code, x.number, x.remittance_date, x.value_date, coalesce(x.bank_code, ''),
      x.remittance_type, x.csb_norm, coalesce(x.total, 0), coalesce(x.effects, 0), coalesce(x.provisional, false), now()
    from rows from (jsonb_to_recordset(p->'payment_remittances') as (company_code smallint, number integer, remittance_date date, value_date date, bank_code text, remittance_type text, csb_norm text, total numeric, effects integer, provisional boolean)) with ordinality as x(company_code, number, remittance_date, value_date, bank_code, remittance_type, csb_norm, total, effects, provisional, n)
    where exists (select 1 from sage_companies c where c.code = x.company_code)
    order by x.company_code, x.number, x.n desc
    on conflict (company_code, number) do update set remittance_date = excluded.remittance_date, value_date = excluded.value_date,
      bank_code = excluded.bank_code, remittance_type = excluded.remittance_type, csb_norm = excluded.csb_norm,
      total = excluded.total, effects = excluded.effects, provisional = excluded.provisional, updated_at = now();
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('payment_remittances', v_n);
    if v_total > v_n then v_counts := v_counts || jsonb_build_object('payment_remittances_repeated', v_total - v_n); end if;
  end if;

  if jsonb_typeof(p->'payment_items') = 'array' then
    v_total := jsonb_array_length(p->'payment_items');
    insert into sage_payment_remittance_items (company_code, remittance_number, movement_id, effect_number, supplier_code,
      invoice_number, invoice_date, due_date, amount, pending, iban)
    select distinct on (x.company_code, x.movement_id) x.company_code, x.remittance_number, x.movement_id, x.effect_number,
      x.supplier_code, x.invoice_number, x.invoice_date, x.due_date, coalesce(x.amount, 0), coalesce(x.pending, 0), x.iban
    from rows from (jsonb_to_recordset(p->'payment_items') as (company_code smallint, remittance_number integer, movement_id text, effect_number integer, supplier_code text, invoice_number text, invoice_date date, due_date date, amount numeric, pending numeric, iban text)) with ordinality as x(company_code, remittance_number, movement_id, effect_number, supplier_code, invoice_number, invoice_date, due_date, amount, pending, iban, n)
    where exists (select 1 from sage_companies c where c.code = x.company_code)
    order by x.company_code, x.movement_id, x.n desc
    on conflict (company_code, movement_id) do update set remittance_number = excluded.remittance_number,
      effect_number = excluded.effect_number, supplier_code = excluded.supplier_code, invoice_number = excluded.invoice_number,
      invoice_date = excluded.invoice_date, due_date = excluded.due_date, amount = excluded.amount, pending = excluded.pending,
      iban = excluded.iban;
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('payment_items', v_n);
    if v_total > v_n then v_counts := v_counts || jsonb_build_object('payment_items_repeated', v_total - v_n); end if;
  end if;

  if jsonb_typeof(p->'open_items') = 'array' then
    if coalesce((p->>'open_items_replace')::boolean, false) then
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
