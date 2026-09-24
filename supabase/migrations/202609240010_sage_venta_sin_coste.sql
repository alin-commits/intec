-- La parte de la venta que no tiene coste grabado.
--
-- Sin esto, esa venta cuenta como si no costara nada y el margen sale más alto
-- de lo que es. Guardándola aparte, el panel puede calcular el margen solo
-- sobre lo que sí tiene coste y avisar de cuánto se queda fuera.
--
-- En los siete días de la primera prueba eran 4.711 € de 100.296 €, un 4,7 %.

alter table public.sage_sales_daily
  add column if not exists net_without_cost numeric(14, 2) not null default 0;

comment on column public.sage_sales_daily.net_without_cost is
  'Parte de net_amount cuyos albaranes no llevan coste grabado en Sage. El margen fiable se calcula sobre net_amount - net_without_cost.';
