-- Compras: leer lo que contestan los proveedores.
--
-- Hasta ahora, que un proveedor hubiera contestado lo marcaba una persona
-- pulsando un botón. Esto lo detecta solo.
--
-- La idea que lo hace fiable: como la reclamación sale sobre el hilo del
-- correo con el que Sage mandó el pedido, la respuesta vuelve a esa misma
-- conversación. Microsoft le pone un identificador a cada hilo, así que saber
-- DE QUÉ PEDIDO habla una respuesta es exacto y no hace falta adivinarlo. La
-- IA solo se usa para lo que un identificador no puede decir: si contesta una
-- persona o un contestador automático, qué han dicho, y si dan fecha.
--
-- Y la frontera, que es lo importante: la fecha que saca la IA entra como
-- PROPUESTA. Un correo dice "sobre el 15, si nos llega el material de Italia"
-- y de ahí no sale una fecha fiable. Alguien la acepta de un clic; hasta
-- entonces no es la fecha del pedido.
--
-- Se puede volver a ejecutar sin romper nada.

-- ---------- El hilo de cada reclamación ----------

alter table public.purchase_order_chases add column if not exists conversation_id text;
create index if not exists purchase_order_chases_hilo_idx
  on public.purchase_order_chases (conversation_id) where conversation_id is not null;

comment on column public.purchase_order_chases.conversation_id is
  'El hilo de Outlook en el que salió. Es por donde se reconoce la respuesta del proveedor.';

-- ---------- Cada respuesta que llega ----------
-- Una fila por correo leído. La clave es el id del mensaje en Microsoft: es lo
-- que impide procesar dos veces el mismo correo si el cron se repite.

create table if not exists public.purchase_order_replies (
  message_id text primary key,
  conversation_id text,
  company_code smallint,
  supplier_code text,
  from_email text,
  subject text,
  received_at timestamptz not null,
  /** Si lo mandó una persona del proveedor y no un contestador automático. */
  from_person boolean not null default true,
  /** Lo que ha entendido la IA, en una línea. Vacío si la IA no estaba disponible. */
  summary text,
  /** La fecha que propone, si la hay. No es la fecha del pedido hasta que alguien la acepta. */
  proposed_on date,
  /** Si esa fecha está dicha sin condiciones. Una fecha insegura no se propone sola. */
  proposed_sure boolean not null default false,
  /** Los pedidos a los que afecta, como se vio al procesarla. */
  orders jsonb not null default '[]'::jsonb,
  processed_at timestamptz not null default now()
);
create index if not exists purchase_order_replies_recientes_idx
  on public.purchase_order_replies (received_at desc);

comment on table public.purchase_order_replies is
  'Los correos de proveedor que ha leído el bot, uno por fila. La clave es el id del mensaje: es lo que impide leer dos veces el mismo.';

-- ---------- La propuesta, en el seguimiento del pedido ----------

alter table public.purchase_order_tracking add column if not exists proposed_on date;
alter table public.purchase_order_tracking add column if not exists proposed_sure boolean not null default false;
alter table public.purchase_order_tracking add column if not exists reply_summary text;

comment on column public.purchase_order_tracking.proposed_on is
  'La fecha que ha entendido la IA. Pasa a confirmed_on cuando una persona la acepta, no antes.';
comment on column public.purchase_order_tracking.reply_summary is
  'Qué contestó el proveedor, en una línea. Lo escribe el bot; las notas a mano van en notes.';

-- La fecha también puede venir de la IA una vez aceptada, así que el origen lo admite.
alter table public.purchase_order_tracking drop constraint if exists purchase_order_tracking_confirmed_source_check;
alter table public.purchase_order_tracking add constraint purchase_order_tracking_confirmed_source_check
  check (confirmed_source is null or confirmed_source in ('sage', 'enlace', 'a_mano', 'ia'));

-- ---------- Quién puede verlo ----------
-- Lo mismo que el resto de compras. Lo escribe el servidor con la clave de
-- servicio; la pantalla solo lee.

alter table public.purchase_order_replies enable row level security;
drop policy if exists purchase_order_replies_read on public.purchase_order_replies;
create policy purchase_order_replies_read on public.purchase_order_replies
  for select to authenticated
  using ((select public.current_user_has_any_role(array['admin', 'direction']::app_role[])));
