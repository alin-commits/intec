/*
  RECONOCIMIENTO DE SAGE 200 — solo lectura
  =========================================

  Para qué sirve: saber cómo se llaman las tablas en NUESTRA instalación de
  Sage antes de programar nada. Sage cambia de nombres según la versión y según
  lo que haya personalizado el partner, así que no se puede dar por supuesto.

  Qué NO hace: no devuelve ni un solo dato de cliente, de venta o de precio.
  Solo nombres de bases de datos, nombres de tablas, nombres de columnas y
  cuántas filas tiene cada tabla. No modifica absolutamente nada.

  Cómo se ejecuta:
    1. Entrar por escritorio remoto al servidor donde está Sage.
    2. Abrir "SQL Server Management Studio" (si no está, vale cualquier
       herramienta que permita lanzar consultas).
    3. Ejecutar los pasos de uno en uno y guardar el resultado de cada uno
       (botón derecho sobre la cuadrícula > "Save Results As..." > CSV).

  Si alguno de los pasos da error de permisos, apúntalo y sigue con el
  siguiente: con lo que salga ya se puede avanzar.
*/


-- ---------------------------------------------------------------------------
-- PASO 1. Qué bases de datos hay (deberían salir las de las 4 empresas)
-- ---------------------------------------------------------------------------
select
  name                as base_de_datos,
  create_date         as creada_el,
  state_desc          as estado
from sys.databases
where database_id > 4          -- deja fuera las internas de SQL Server
order by name;


-- ---------------------------------------------------------------------------
-- PASO 2. Tablas que nos interesan, EN CADA BASE DE DATOS DE EMPRESA
--
-- Repetir este paso una vez por empresa: descomenta la línea "use" y pon el
-- nombre que haya salido en el paso 1.
-- ---------------------------------------------------------------------------
-- use [PON_AQUI_EL_NOMBRE_DE_LA_EMPRESA];

select
  s.name        as esquema,
  t.name        as tabla,
  sum(p.rows)   as filas
from sys.tables t
join sys.schemas s on s.schema_id = t.schema_id
join sys.partitions p on p.object_id = t.object_id and p.index_id in (0, 1)
where t.name like '%Pedido%'
   or t.name like '%Albaran%'
   or t.name like '%Factura%'
   or t.name like '%Client%'
   or t.name like '%Articulo%'
   or t.name like '%Presupuesto%'
   or t.name like '%Oferta%'
   or t.name like '%Vendedor%'
   or t.name like '%Comercial%'
   or t.name like '%Familia%'
   or t.name like '%Serie%'
   or t.name like '%Almacen%'
group by s.name, t.name
having sum(p.rows) > 0
order by sum(p.rows) desc;


-- ---------------------------------------------------------------------------
-- PASO 3. Columnas de las tablas grandes
--
-- Del resultado del paso 2, coge las 6 u 8 tablas con más filas y pon aquí
-- sus nombres, entre comillas simples y separados por comas.
-- ---------------------------------------------------------------------------
select
  t.name         as tabla,
  c.column_id    as orden,
  c.name         as columna,
  ty.name        as tipo,
  c.is_nullable  as admite_vacio
from sys.columns c
join sys.tables t on t.object_id = c.object_id
join sys.types ty on ty.user_type_id = c.user_type_id
where t.name in (
  'PON_AQUI_UNA_TABLA',
  'Y_OTRA'
)
order by t.name, c.column_id;


-- ---------------------------------------------------------------------------
-- PASO 4. Quién puede leer qué
--
-- Para confirmar si el usuario de solo lectura existe ya y con qué permisos.
-- ---------------------------------------------------------------------------
select
  usuario.name  as usuario,
  rol.name      as rol,
  usuario.type_desc as tipo
from sys.database_role_members m
join sys.database_principals rol on rol.principal_id = m.role_principal_id
join sys.database_principals usuario on usuario.principal_id = m.member_principal_id
where usuario.name not in ('dbo', 'public')
order by usuario.name, rol.name;


-- ---------------------------------------------------------------------------
-- PASO 5. Hasta dónde llega el histórico
--
-- Sustituye el nombre de la tabla y el de la columna de fecha por los que
-- hayan salido en los pasos 2 y 3 (la tabla de cabeceras de factura de cliente
-- y su fecha). Dice desde cuándo hay datos y cuántos documentos hay.
-- ---------------------------------------------------------------------------
-- select
--   min(FechaFactura) as desde,
--   max(FechaFactura) as hasta,
--   count(*)          as documentos
-- from PON_AQUI_LA_TABLA_DE_FACTURAS;
