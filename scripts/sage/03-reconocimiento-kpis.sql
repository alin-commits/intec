/*
  Qué tablas hacen falta para los KPI del PDF de Dirección Comercial, y cómo se
  llaman en NUESTRA instalación de Sage.

  Hoy el agente solo lee CabeceraAlbaranCliente, así que del panel salen las
  ventas, el margen y el reparto por comercial y canal. Para el resto de KPI hace
  falta el cliente de cada venta, las líneas (artículo y familia), los pedidos y
  los presupuestos. Antes de escribir una sola consulta hay que saber cómo se
  llaman esas tablas aquí y si tienen datos.

  Este script NO MODIFICA NADA. Solo lee nombres de tablas, nombres de columnas y
  cuántas filas tiene cada una. No saca ni un solo dato de cliente ni de venta.

  Cómo se pasa: en SQL Server Management Studio, sobre la base de datos de la
  empresa (la misma contra la que corre el agente), y se me manda el resultado de
  cada paso.
*/

-- ---------------------------------------------------------------------------
-- PASO 1. Las tablas candidatas que existen de verdad, y su tamaño.
-- ---------------------------------------------------------------------------
-- Se busca por parecido, sin dar por hecho ningún nombre: en cada instalación
-- de Sage pueden cambiar.

select
  t.name                                  as tabla,
  sum(case when p.index_id in (0,1) then p.rows else 0 end) as filas
from sys.tables t
join sys.partitions p on p.object_id = t.object_id
where t.name like '%Pedido%'
   or t.name like '%Presupuesto%'
   or t.name like '%Oferta%'
   or t.name like '%LineasAlbaran%'
   or t.name like '%LineasFactura%'
   or t.name like '%CabeceraFactura%'
   or t.name = 'Clientes'
   or t.name like '%Articulo%'
   or t.name like '%Familia%'
group by t.name
order by filas desc;

-- ---------------------------------------------------------------------------
-- PASO 2. Las columnas de esas tablas.
-- ---------------------------------------------------------------------------
-- Del paso 1, poner aquí las que tengan filas. Interesa saber si llevan fecha,
-- empresa, cliente, comercial, serie, importe y coste, que es lo que se necesita
-- para cuadrar cada KPI con lo que ya sube el agente.

select
  t.name  as tabla,
  c.name  as columna,
  ty.name as tipo,
  c.max_length
from sys.columns c
join sys.tables t on t.object_id = c.object_id
join sys.types ty on ty.user_type_id = c.user_type_id
where t.name in (
  'CabeceraPedidoCliente',
  'LineasPedidoCliente',
  'LineasAlbaranCliente',
  'CabeceraPresupuestoCliente',
  'LineasPresupuestoCliente',
  'Clientes',
  'Articulos'
  -- ...y las demás que salgan en el paso 1
)
order by t.name, c.column_id;

-- ---------------------------------------------------------------------------
-- PASO 3. ¿Desde cuándo hay datos en cada una?
-- ---------------------------------------------------------------------------
-- Para saber desde qué año se puede calcular cada KPI sin mentir. Hay que
-- sustituir el nombre de la tabla y el de su columna de fecha por los que hayan
-- salido en el paso 2, y repetirlo por cada tabla.

-- select min(FechaPedido) as desde, max(FechaPedido) as hasta, count(*) as filas
-- from CabeceraPedidoCliente;

-- ---------------------------------------------------------------------------
-- PASO 4. ¿El cliente está en la cabecera del albarán?
-- ---------------------------------------------------------------------------
-- Si CabeceraAlbaranCliente ya trae el código de cliente, la mitad de los KPI de
-- cartera (clientes activos, nuevos, perdidos, recurrentes) salen ampliando la
-- consulta que el agente ya hace, sin tocar ninguna tabla más.

select c.name as columna, ty.name as tipo
from sys.columns c
join sys.tables t on t.object_id = c.object_id
join sys.types ty on ty.user_type_id = c.user_type_id
where t.name = 'CabeceraAlbaranCliente'
  and (c.name like '%Cliente%' or c.name like '%Cuenta%' or c.name like '%Razon%')
order by c.column_id;
