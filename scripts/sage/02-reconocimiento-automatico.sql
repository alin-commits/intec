/*
  RECONOCIMIENTO DE SAGE 200 — versión de un solo paso
  ====================================================

  Igual que 01-reconocimiento.sql, pero sin rellenar nada a mano: recorre solo
  todas las bases de datos de las empresas y devuelve tres resultados seguidos.

  Solo lectura. No devuelve ni un dato de cliente, de venta o de precio: solo
  nombres de bases de datos, nombres de tablas, nombres de columnas y cuántas
  filas tiene cada tabla. No modifica absolutamente nada.

  Cómo se ejecuta:
    1. Entrar por escritorio remoto al servidor donde está Sage.
    2. Abrir SQL Server Management Studio y conectarse al motor.
    3. Pegar esto entero y pulsar Ejecutar (F5).
    4. Salen tres cuadrículas. En cada una: botón derecho > "Save Results As..."
       y guardar como CSV.

  Si da error de permisos en alguna base de datos, se la salta y sigue con las
  demás; al final avisa de cuáles no pudo mirar.
*/

set nocount on;

-- Las bases de datos de empresa: las del sistema quedan fuera.
if object_id('tempdb..#bases') is not null drop table #bases;
if object_id('tempdb..#tablas') is not null drop table #tablas;
if object_id('tempdb..#columnas') is not null drop table #columnas;
if object_id('tempdb..#fallos') is not null drop table #fallos;

create table #bases (nombre sysname);
create table #tablas (base_de_datos sysname, esquema sysname, tabla sysname, filas bigint);
create table #columnas (base_de_datos sysname, tabla sysname, orden int, columna sysname, tipo sysname);
create table #fallos (base_de_datos sysname, motivo nvarchar(400));

insert into #bases (nombre)
select name
from sys.databases
where database_id > 4
  and state = 0                 -- solo las que están en línea
  and is_read_only = 0
  and has_dbaccess(name) = 1;   -- y a las que este usuario puede entrar

declare @base sysname, @sql nvarchar(max);
declare bases cursor local fast_forward for select nombre from #bases;
open bases;
fetch next from bases into @base;

while @@fetch_status = 0
begin
  begin try
    -- Tablas que suenan a comercial, con su número de filas.
    set @sql = N'
      use ' + quotename(@base) + N';
      insert into #tablas (base_de_datos, esquema, tabla, filas)
      select ' + quotename(@base, '''') + N', s.name, t.name, sum(p.rows)
      from sys.tables t
      join sys.schemas s on s.schema_id = t.schema_id
      join sys.partitions p on p.object_id = t.object_id and p.index_id in (0, 1)
      where t.name like ''%Pedido%'' or t.name like ''%Albaran%'' or t.name like ''%Factura%''
         or t.name like ''%Client%''  or t.name like ''%Articulo%'' or t.name like ''%Presupuesto%''
         or t.name like ''%Oferta%''  or t.name like ''%Vendedor%'' or t.name like ''%Comercial%''
         or t.name like ''%Familia%'' or t.name like ''%Serie%''    or t.name like ''%Almacen%''
      group by s.name, t.name
      having sum(p.rows) > 0;';
    exec sp_executesql @sql;

    -- Columnas de las diez tablas con más filas de esa empresa.
    set @sql = N'
      use ' + quotename(@base) + N';
      with grandes as (
        select top (10) t.object_id, t.name
        from sys.tables t
        join sys.partitions p on p.object_id = t.object_id and p.index_id in (0, 1)
        where t.name like ''%Pedido%'' or t.name like ''%Albaran%'' or t.name like ''%Factura%''
           or t.name like ''%Client%''  or t.name like ''%Articulo%''
        group by t.object_id, t.name
        order by sum(p.rows) desc
      )
      insert into #columnas (base_de_datos, tabla, orden, columna, tipo)
      select ' + quotename(@base, '''') + N', g.name, c.column_id, c.name, ty.name
      from grandes g
      join sys.columns c on c.object_id = g.object_id
      join sys.types ty on ty.user_type_id = c.user_type_id;';
    exec sp_executesql @sql;
  end try
  begin catch
    insert into #fallos (base_de_datos, motivo) values (@base, error_message());
  end catch;

  fetch next from bases into @base;
end;

close bases;
deallocate bases;

-- ---------------------------------------------------------------------------
-- RESULTADO 1: qué bases de datos hay y cuántas tablas nos interesan de cada una
-- ---------------------------------------------------------------------------
select
  b.nombre                        as base_de_datos,
  count(t.tabla)                  as tablas_de_interes,
  isnull(sum(t.filas), 0)         as filas_en_total,
  case when f.base_de_datos is null then 'ok' else 'NO SE PUDO LEER' end as estado
from #bases b
left join #tablas t on t.base_de_datos = b.nombre
left join #fallos f on f.base_de_datos = b.nombre
group by b.nombre, f.base_de_datos
order by filas_en_total desc;

-- ---------------------------------------------------------------------------
-- RESULTADO 2: las tablas, de más llena a más vacía
-- ---------------------------------------------------------------------------
select base_de_datos, esquema, tabla, filas
from #tablas
order by base_de_datos, filas desc;

-- ---------------------------------------------------------------------------
-- RESULTADO 3: las columnas de las tablas grandes
-- ---------------------------------------------------------------------------
select base_de_datos, tabla, orden, columna, tipo
from #columnas
order by base_de_datos, tabla, orden;

-- ---------------------------------------------------------------------------
-- RESULTADO 4: bases de datos que no se pudieron mirar (normalmente, permisos)
-- ---------------------------------------------------------------------------
select base_de_datos, motivo from #fallos;

drop table #bases;
drop table #tablas;
drop table #columnas;
drop table #fallos;
