-- Registro de los envíos de facturas a contabilidad.
--
-- Una factura se puede mandar más de una vez (se perdió, se pidió de nuevo),
-- pero mandarla por descuido dos veces a contabilidad da trabajo a alguien. Con
-- esto, antes de enviar se avisa de cuántas veces ha salido ya, cuándo y quién.
--
-- Solo se guarda que salió, no el correo: el PDF y el resumen se rehacen cada
-- vez a partir de la factura.

create table if not exists public.marketing_invoice_sends (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.marketing_invoices(id) on delete cascade,
  sent_to text not null,
  sent_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists marketing_invoice_sends_invoice_idx
  on public.marketing_invoice_sends (invoice_id, created_at desc);

alter table public.marketing_invoice_sends enable row level security;

-- Lo puede consultar quien puede ver las facturas. Escribirlo solo el servidor,
-- al enviar de verdad: por eso no hay política de insert.
drop policy if exists marketing_invoice_sends_read on public.marketing_invoice_sends;
create policy marketing_invoice_sends_read on public.marketing_invoice_sends
for select to authenticated
  using (public.current_user_has_any_role(ARRAY['admin','marketing','direction']::app_role[]));
