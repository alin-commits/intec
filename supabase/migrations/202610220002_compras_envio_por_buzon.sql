-- Por dónde salió cada reclamación.
--
-- Hay dos caminos y conviene saber cuál usó cada correo:
--
--  · graph: lo manda el propio buzón de compras. Queda en su carpeta de
--    Enviados y, cuando se encuentra el correo con el que Sage mandó el
--    pedido, se responde sobre ese hilo, así que el proveedor ve el pedido
--    debajo y su respuesta vuelve al mismo sitio.
--  · resend: lo manda nuestro servidor en nombre de compras@. Llega igual,
--    pero no pasa por el buzón: no aparece en Enviados y va suelto.
--
-- `in_thread` es lo que dice si el hilo se encontró. Si empieza a salir en
-- falso para todo, el patrón del asunto de Sage no está acertando y lo que
-- hay que tocar es la configuración, no el código.
--
-- Se puede volver a ejecutar sin romper nada.

alter table public.purchase_order_chases add column if not exists via text
  check (via is null or via in ('graph', 'resend'));
alter table public.purchase_order_chases add column if not exists in_thread boolean not null default false;

comment on column public.purchase_order_chases.via is
  'graph = lo mandó el buzón de compras; resend = lo mandó el servidor en su nombre.';
comment on column public.purchase_order_chases.in_thread is
  'Si se respondió sobre el hilo del correo con el que Sage mandó el pedido.';
