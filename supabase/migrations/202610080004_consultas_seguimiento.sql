-- "Seguimiento" como estado de una consulta.
--
-- Va solo aquí, no en el CRM: en una consulta se manda la oferta y después se
-- persigue, y esa etapa intermedia es la mitad del trabajo. En el CRM —gente de
-- ferias y conocidos— ese paso no se usa, así que su lista de estados se queda
-- como está.
--
-- Encaja detrás de "oferta enviada": contactado → oferta enviada → seguimiento
-- → interesado → ganado o perdido.
--
-- Se puede volver a ejecutar sin romper nada.

alter table public.inquiries drop constraint if exists inquiries_status_check;
alter table public.inquiries add constraint inquiries_status_check
  check (status in ('contactado', 'oferta_enviada', 'seguimiento', 'interesado', 'ganado', 'perdido'));

comment on column public.inquiries.status is
  'En qué quedó la consulta: el vocabulario del CRM más "seguimiento". En las altas semanales no significa nada: ahí solo se cuenta volumen.';
