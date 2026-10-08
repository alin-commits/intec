-- Las consultas, con ficha y estado.
--
-- Hasta ahora una consulta era solo un número: marca, canal y fecha. Servía
-- para el gráfico, pero no para trabajar —no se podía saber quién preguntó ni
-- en qué quedó— y por eso el módulo lleva desde el principio sin una sola fila.
--
-- Ahora cada consulta puede llevar a quién pregunta y qué quiere, y su estado.
-- El vocabulario de estados es el mismo que el del CRM, porque es lo mismo
-- visto desde otra puerta: lo que cambia es de dónde viene (una campaña, una
-- llamada, una feria), no lo que se hace con ello.
--
-- Dos cosas que NO cambian, a propósito:
--
--   · El alta en bloque por semana sigue ahí. Sirve para contar volumen —"esta
--     semana entraron 40 por teléfono"— y esas filas no llevan ficha: nadie va
--     a teclear cuarenta nombres, y obligar a ello es la forma más segura de
--     que no se apunte nada.
--   · El dinero de una consulta se sigue apuntando a mano. En leads y en CRM el
--     apunte lo lleva un disparador porque hay uno por ficha; aquí puede haber
--     varios por consulta (una oferta y después el pedido), así que atarlo al
--     estado rompería lo que ya funciona.
--
-- El estado por defecto es "contactado" y no "sin contactar": la consulta la
-- apunta el comercial que la está atendiendo, no entra sola a una bandeja.
--
-- Se puede volver a ejecutar sin romper nada.

alter table public.inquiries
  add column if not exists contact_name text,
  add column if not exists company_name text,
  add column if not exists phone text,
  add column if not exists email text,
  add column if not exists product_interest text,
  add column if not exists notes text,
  add column if not exists status text not null default 'contactado';

alter table public.inquiries drop constraint if exists inquiries_status_check;
alter table public.inquiries add constraint inquiries_status_check
  check (status in ('contactado', 'oferta_enviada', 'interesado', 'ganado', 'perdido'));

create index if not exists inquiries_status_idx on public.inquiries (status);

comment on column public.inquiries.status is
  'En qué quedó la consulta. Mismo vocabulario que el CRM. En las altas semanales no significa nada: ahí solo se cuenta volumen.';
comment on column public.inquiries.contact_name is
  'Quién pregunta. Vacío en las altas semanales, que son un recuento y no una ficha.';
