-- Las tarifas también se buscan por palabras.
--
-- En la migración anterior puse un índice sobre una expresión:
--
--   create index ... using gin (to_tsvector('spanish', coalesce(description,'')))
--
-- Eso acelera la consulta si alguien escribe exactamente esa expresión en SQL,
-- pero el Hub no habla SQL: habla por PostgREST, y PostgREST busca contra una
-- columna, no contra una expresión. El resultado era que «compresor 8 bar»
-- encontraba las páginas del catálogo y cero productos de la tarifa, teniendo
-- 347.345 precios cargados.
--
-- Lo que hacía falta es lo mismo que ya tienen los trozos de catálogo: una
-- columna tsvector que se mantiene sola.
--
-- Va sobre descripción, referencia y proveedor juntos, no solo la descripción,
-- porque un comercial escribe «abac compresor» o busca por la referencia que
-- le ha dado el cliente, y las tres cosas tienen que encontrar.
--
-- Se puede volver a ejecutar sin romper nada.

alter table public.catalog_prices
  add column if not exists search tsvector
  generated always as (
    to_tsvector('spanish',
      coalesce(description, '') || ' ' ||
      coalesce(reference, '') || ' ' ||
      coalesce(supplier, ''))
  ) stored;

create index if not exists catalog_prices_busqueda on public.catalog_prices using gin (search);

-- El de la expresión ya no lo usa nadie.
drop index if exists public.catalog_prices_texto;

comment on column public.catalog_prices.search is
  'Descripción, referencia y proveedor juntos, para buscar por palabras en español.';
