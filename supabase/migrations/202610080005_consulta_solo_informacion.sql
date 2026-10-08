-- "Solo información" como estado de una consulta.
--
-- La mayoría de las llamadas no son una oportunidad: preguntan un precio
-- aproximado, piden el catálogo o quieren saber si trabajamos una marca. Eso no
-- es "contactado" camino de una oferta, y marcarlo como tal infla el embudo y
-- hace que luego no cuadre nada.
--
-- Va al principio del recorrido, antes de contactado: lo que empieza como
-- información puede subir a contactado y a oferta si la cosa avanza.
--
-- Solo en consultas, como "seguimiento": en el CRM se apunta a quien se conoce
-- en persona, y ahí nadie "pide información" sin más.
--
-- Se puede volver a ejecutar sin romper nada.

alter table public.inquiries drop constraint if exists inquiries_status_check;
alter table public.inquiries add constraint inquiries_status_check
  check (status in ('informacion', 'contactado', 'oferta_enviada', 'seguimiento', 'interesado', 'ganado', 'perdido'));

comment on column public.inquiries.status is
  'En qué quedó la consulta: solo información, contactado, oferta enviada, seguimiento, interesado, ganado o perdido. En las altas semanales no significa nada: ahí solo se cuenta volumen.';
