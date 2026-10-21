-- Compras: reclamar la fecha a los proveedores, a mano y sola.
--
-- Lo que faltaba de la primera entrega: poder escribirle al proveedor desde la
-- pantalla, que se le escriba solo a los 2 y a los 5 días del pedido, y poder
-- apuntar que ya ha contestado para repasarlo luego.
--
-- Dos decisiones que están aquí y no en el código, para que se vean:
--
--  · Lo automático solo entra con pedidos nuevos. Los 275 que ya estaban
--    atascados —mediana de 271 días— se reclaman a mano con el botón: encender
--    el automático sobre ellos habría mandado 112 correos de golpe, varios por
--    pedidos de hace más de un año.
--  · "Contestado" es un estado aparte de "confirmado". El proveedor contesta
--    por correo y alguien lo lee: hasta que esa fecha no está en Sage, el
--    pedido está contestado pero no confirmado, y conviene verlo para pasarlo.
--
-- Se puede volver a ejecutar sin romper nada.

-- ---------- Un estado más: contestado ----------

alter table public.purchase_order_tracking drop constraint if exists purchase_order_tracking_state_check;
alter table public.purchase_order_tracking add constraint purchase_order_tracking_state_check
  check (state in ('sin_confirmar', 'reclamado', 'contestado', 'confirmado', 'pausado', 'sin_reclamar'));

-- Cuándo contestó y qué dijo. La fecha, si la dio, va en confirmed_on; aquí
-- queda el "ha contestado" aunque no haya dado ninguna.
alter table public.purchase_order_tracking add column if not exists replied_at timestamptz;
alter table public.purchase_order_tracking add column if not exists replied_by uuid references public.profiles(id) on delete set null;

comment on column public.purchase_order_tracking.replied_at is
  'Cuándo se marcó que el proveedor había contestado. Lo pulsa alguien al leer el correo; el buzón no se lee solo.';

-- Lo contestado que todavía no está en Sage es lo que hay que repasar, así que
-- se busca mucho por ahí.
create index if not exists purchase_order_tracking_contestados_idx
  on public.purchase_order_tracking (replied_at desc) where state = 'contestado';

-- ---------- De dónde salió cada correo ----------

alter table public.purchase_order_chases add column if not exists kind text not null default 'auto'
  check (kind in ('auto', 'manual'));
alter table public.purchase_order_chases add column if not exists sent_by uuid references public.profiles(id) on delete set null;

comment on column public.purchase_order_chases.kind is
  'auto = lo mandó el cron a los 2 o 5 días; manual = alguien le dio al botón.';

-- El día del envío, en una columna propia.
--
-- Hacía falta para el índice de aquí abajo y no vale sacarlo de sent_at al
-- vuelo: pasar una marca de tiempo a fecha depende de la zona horaria de la
-- sesión, así que Postgres no lo admite en un índice ("functions in index
-- expression must be marked IMMUTABLE"). Se guarda el día ya resuelto en
-- Madrid, que es donde se trabaja.
alter table public.purchase_order_chases add column if not exists sent_on date;
update public.purchase_order_chases set sent_on = (sent_at at time zone 'Europe/Madrid')::date where sent_on is null;
alter table public.purchase_order_chases alter column sent_on set default (now() at time zone 'Europe/Madrid')::date;
alter table public.purchase_order_chases alter column sent_on set not null;

-- Lo que impide mandar dos veces el mismo escalón al mismo proveedor el mismo
-- día: si el cron se repite —o alguien le da al botón justo después—, el envío
-- ya está escrito y no se vuelve a hacer. Solo cuenta para los automáticos:
-- al botón se le da a propósito, y si alguien quiere insistir, puede.
create unique index if not exists purchase_order_chases_sin_repetir_idx
  on public.purchase_order_chases (company_code, supplier_code, level, sent_on)
  where kind = 'auto';

-- ---------- Quién puede escribir aquí ----------
-- Las reclamaciones las escribe el servidor con la clave de servicio (el cron
-- no tiene sesión), pero la pantalla necesita leerlas para enseñar el historial.
-- El select ya está de la migración anterior; aquí solo se deja constancia.

comment on table public.purchase_order_chases is
  'Cada correo de reclamación que ha salido, con los pedidos que llevaba. Es el registro que impide repetir envíos.';
