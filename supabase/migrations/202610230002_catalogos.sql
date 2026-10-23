-- Los catálogos de los proveedores, para que el chat pueda responder.
--
-- En «08 TARIFAS 2026» hay 283 ficheros y 2,7 GB: 147 PDF con las
-- características y 122 Excel con los precios. Nada de eso se sube aquí. Lo
-- que llega es el texto —unos 40 MB, el 1,5 % del volumen— porque lo que se
-- busca son palabras, no ficheros.
--
-- Tres tablas, y la razón de que sean tres:
--
--   catalog_files    un registro por fichero. Lleva el hash para no volver a
--                    leer lo que no ha cambiado, y la fecha del fichero, que
--                    hace falta para avisar cuando una tarifa no es del año
--                    en curso. En la carpeta de 2026 hay tarifas de 2022.
--
--   catalog_chunks   el texto partido en trozos. Un catálogo tiene 99 páginas
--                    de media y los hay de 720: entero no cabe en ninguna
--                    pregunta, así que se busca el trozo y se manda solo ese.
--
--   catalog_prices   las filas de los Excel ya normalizadas. Los precios no
--                    se buscan por parecido ni los redacta el modelo: se
--                    leen de aquí tal cual y se devuelven con su origen. Una
--                    cifra inventada acaba en un presupuesto a un cliente.
--
-- Quién lo ve: los mismos que ya ven los artículos de Sage. Dirección decidió
-- que los comerciales ven el coste, que es lo que ya ven en Sage.
--
-- Se puede volver a ejecutar sin romper nada.

create table if not exists public.catalog_files (
  id            bigint generated always as identity primary key,
  supplier      text not null,
  file_name     text not null,
  rel_path      text not null,
  kind          text not null,
  bytes         bigint,
  modified_at   timestamptz,
  content_hash  text,
  pages         integer,
  -- El año que dice el fichero (por el nombre o por dentro). Nulo si no se
  -- ha podido averiguar: entonces el chat lo dice en vez de callárselo.
  year_hint     integer,
  read_at       timestamptz,
  read_error    text,
  updated_at    timestamptz not null default now()
);

create unique index if not exists catalog_files_ruta on public.catalog_files (rel_path);
create index if not exists catalog_files_proveedor on public.catalog_files (supplier);

create table if not exists public.catalog_chunks (
  id        bigint generated always as identity primary key,
  file_id   bigint not null references public.catalog_files(id) on delete cascade,
  page      integer,
  ordinal   integer not null,
  content   text not null
);

create unique index if not exists catalog_chunks_orden on public.catalog_chunks (file_id, ordinal);

-- La búsqueda por palabras de Postgres, que ya viene puesta y no cuesta nada.
-- Si más adelante hace falta buscar por significado se añade pgvector al lado,
-- sin tocar esto.
alter table public.catalog_chunks
  add column if not exists search tsvector
  generated always as (to_tsvector('spanish', content)) stored;

create index if not exists catalog_chunks_busqueda on public.catalog_chunks using gin (search);

create table if not exists public.catalog_prices (
  id           bigint generated always as identity primary key,
  file_id      bigint not null references public.catalog_files(id) on delete cascade,
  supplier     text not null,
  reference    text,
  ean          text,
  description  text,
  price        numeric(14, 4),
  currency     text not null default 'EUR',
  unit         text,
  -- Qué columna del Excel era cada cosa. Cada proveedor manda su formato
  -- —«EUR», «TARIFA 2026», «Precio 2026»— y cuando una cifra no cuadre habrá
  -- que poder mirar de qué celda salió.
  raw          jsonb
);

create index if not exists catalog_prices_ref on public.catalog_prices (reference);
create index if not exists catalog_prices_ean on public.catalog_prices (ean);
create index if not exists catalog_prices_fichero on public.catalog_prices (file_id);
create index if not exists catalog_prices_texto on public.catalog_prices
  using gin (to_tsvector('spanish', coalesce(description, '')));

alter table public.catalog_files  enable row level security;
alter table public.catalog_chunks enable row level security;
alter table public.catalog_prices enable row level security;

-- Leerlo: los mismos roles que ya ven los artículos y las ventas de Sage.
-- Escribirlo: solo el agente, que entra con la clave de servicio y se salta
-- estas políticas. Desde el navegador no se escribe aquí.
drop policy if exists catalog_files_read on public.catalog_files;
create policy catalog_files_read on public.catalog_files
for select to authenticated
  using ((select public.current_user_has_any_role(ARRAY['admin','direction','commercial','purchasing']::app_role[])));

drop policy if exists catalog_chunks_read on public.catalog_chunks;
create policy catalog_chunks_read on public.catalog_chunks
for select to authenticated
  using ((select public.current_user_has_any_role(ARRAY['admin','direction','commercial','purchasing']::app_role[])));

drop policy if exists catalog_prices_read on public.catalog_prices;
create policy catalog_prices_read on public.catalog_prices
for select to authenticated
  using ((select public.current_user_has_any_role(ARRAY['admin','direction','commercial','purchasing']::app_role[])));

comment on table public.catalog_files is
  'Un registro por catálogo o tarifa de proveedor. El fichero no se sube: solo su texto.';
comment on column public.catalog_files.content_hash is
  'Para no releer lo que no ha cambiado. Si coincide, el agente se salta el fichero.';
comment on column public.catalog_files.year_hint is
  'De qué año es la tarifa. Nulo si no se sabe. El chat lo enseña siempre y avisa si no es del año en curso.';
comment on table public.catalog_chunks is
  'El texto de los catálogos en trozos buscables. Un catálogo entero no cabe en una pregunta.';
comment on table public.catalog_prices is
  'Las filas de las tarifas ya normalizadas. Los precios se leen de aquí, nunca los redacta el modelo.';
