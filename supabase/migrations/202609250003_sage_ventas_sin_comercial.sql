-- Las ventas sin comercial asignado no caben en la tabla.
--
-- `rep_code` formaba parte de la clave primaria, y en Postgres eso obliga a que
-- no sea nula. Pero un 6 % de los albaranes de Sage no tienen comercial (van al
-- código "GENERAL" o a un alta automática), y esos se guardan con rep_code nulo
-- para que el panel los enseñe como "sin asignar".
--
-- La clave primaria pasa a ser un número propio, y la combinación natural se
-- protege con dos índices únicos: uno para las filas con comercial y otro para
-- las que no, porque un índice único normal considera distintos dos nulos.

alter table public.sage_sales_daily drop constraint if exists sage_sales_daily_pkey;

-- Quitar la clave primaria no quita el "no nulo" que traía puesto.
alter table public.sage_sales_daily alter column rep_code drop not null;

alter table public.sage_sales_daily
  add column if not exists id bigint generated always as identity primary key;

create unique index if not exists sage_sales_daily_con_comercial_idx
  on public.sage_sales_daily (company_code, basis, day, series, rep_code)
  where rep_code is not null;

-- El de las filas sin comercial ya existía de la migración anterior:
--   sage_sales_daily_sin_comercial_idx
