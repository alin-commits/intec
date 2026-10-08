-- Quién resolvió cada ticket.
--
-- Hasta ahora se sabía cuándo se resolvió, pero no quién: el historial guarda
-- quién cambió el estado, que no es lo mismo —uno puede arreglar la impresora y
-- otro marcarlo en la aplicación— y además no se ve en ningún listado. Con esto
-- se puede mirar al final del mes quién lleva qué.
--
-- Es una referencia a la ficha de la persona, no un nombre escrito: así sale
-- bien aunque alguien cambie de nombre, y el repositorio no guarda nombres.
--
-- `on delete set null`: si algún día se borra una ficha, el ticket se queda sin
-- firmar pero no se pierde. Y no hay que tocar las políticas: quien ya podía
-- cambiar un ticket (admin e informática) puede cambiar también este campo.
--
-- Se puede volver a ejecutar sin romper nada.

alter table public.tickets add column if not exists resolved_by uuid references public.profiles(id) on delete set null;

create index if not exists tickets_resolved_by_idx on public.tickets (resolved_by);

comment on column public.tickets.resolved_by is
  'Quién resolvió el ticket. Lo pone la aplicación al marcarlo resuelto, y se puede cambiar a mano desde la ficha.';
