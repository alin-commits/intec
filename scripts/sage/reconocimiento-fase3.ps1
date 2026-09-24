<#
  SAGE 200 — QUÉ HAY DE CLIENTES, OFERTAS, PEDIDOS Y FAMILIAS
  ===========================================================

  El panel de ventas ya trae ventas, margen y comerciales. Para lo que falta del
  PDF de KPI hacen falta cuatro cosas más, y este script mira si están y cómo se
  llaman sus columnas, que cambian de una instalación de Sage a otra:

    1. CLIENTES     -> clientes activos, nuevos, perdidos, sin contacto, venta
                       media por cliente, recurrencia
    2. OFERTAS      -> ofertas emitidas, ratio oferta/pedido, tiempo de respuesta
    3. PEDIDOS      -> número de pedidos de verdad (hoy se cuentan albaranes)
    4. FAMILIAS     -> ventas recurrentes por familia, artículos por albarán

  QUÉ LEE Y QUÉ NO
  ----------------
  Lee NOMBRES DE COLUMNA, recuentos y rangos de fecha. Del contenido solo saca
  totales agregados; no vuelca ni un cliente, ni un precio, ni un nombre. No
  escribe absolutamente nada en Sage.

  CÓMO SE USA
  -----------
    powershell -ExecutionPolicy Bypass -File C:\intec\reconocimiento-fase3.ps1

  Deja un TXT y varios CSV en una carpeta "sage-fase3" del Escritorio. Mándame
  el TXT y con eso puedo escribir el agente sin adivinar nada.
#>

param(
  [string]$Servidor = "",
  [string]$BaseDeDatos = "Sage",
  [int]$Empresa = 1,
  [string]$Salida = ""
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Data

if ([string]::IsNullOrWhiteSpace($Salida)) {
  $escritorio = [Environment]::GetFolderPath('Desktop')
  if ([string]::IsNullOrWhiteSpace($escritorio) -or -not (Test-Path $escritorio)) {
    $escritorio = Split-Path -Parent $MyInvocation.MyCommand.Path
  }
  $Salida = Join-Path $escritorio "sage-fase3"
}

function Buscar-Instancias {
  $encontradas = @()
  $ruta = "HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\Instance Names\SQL"
  if (Test-Path $ruta) {
    foreach ($propiedad in (Get-ItemProperty $ruta).PSObject.Properties) {
      if ($propiedad.Name -like "PS*") { continue }
      if ($propiedad.Name -eq "MSSQLSERVER") { $encontradas += $env:COMPUTERNAME }
      else { $encontradas += "$env:COMPUTERNAME\$($propiedad.Name)" }
    }
  }
  if ($encontradas.Count -eq 0) { $encontradas = @("localhost", ".\SQLEXPRESS") }
  return $encontradas
}

function Consultar($servidor, $sql) {
  $conexion = New-Object System.Data.SqlClient.SqlConnection "Server=$servidor;Database=$BaseDeDatos;Integrated Security=SSPI;Connect Timeout=10;Application Name=Reconocimiento Intec;"
  try {
    $conexion.Open()
    $comando = $conexion.CreateCommand()
    $comando.CommandText = $sql
    $comando.CommandTimeout = 600
    $adaptador = New-Object System.Data.SqlClient.SqlDataAdapter $comando
    $tabla = New-Object System.Data.DataTable
    [void]$adaptador.Fill($tabla)
    return ,$tabla
  } finally {
    $conexion.Close()
  }
}

$candidatos = @()
if ($Servidor -ne "") { $candidatos = @($Servidor) } else { $candidatos = Buscar-Instancias }
$servidorBueno = ""
foreach ($candidato in $candidatos) {
  try { [void](Consultar $candidato "select 1"); $servidorBueno = $candidato; break } catch { }
}
if ($servidorBueno -eq "") {
  Write-Host "No se pudo conectar. Pasa el nombre con -Servidor ""NOMBRE\INSTANCIA""" -ForegroundColor Red
  Read-Host "Pulsa Intro para cerrar"
  exit 1
}
if (-not (Test-Path $Salida)) { New-Item -ItemType Directory -Path $Salida -Force | Out-Null }

$informe = Join-Path $Salida "informe.txt"
"RECONOCIMIENTO FASE 3 — $(Get-Date -Format 'dd/MM/yyyy HH:mm')" | Out-File $informe -Encoding UTF8
function Apuntar($texto) {
  Write-Host $texto
  $texto | Out-File $informe -Encoding UTF8 -Append
}

Apuntar ""
Apuntar "Servidor: $servidorBueno   Base: $BaseDeDatos   Sociedad de muestra: $Empresa"
Apuntar ""

# ---------------------------------------------------------------- 1. QUE EXISTE
Apuntar "=== TABLAS QUE NOS INTERESAN ==="
$candidatasSql = @"
select t.name as Tabla, sum(p.rows) as Filas
from sys.tables t
join sys.partitions p on p.object_id = t.object_id and p.index_id in (0, 1)
where t.name like '%Cliente%' or t.name like '%Oferta%' or t.name like '%Pedido%'
   or t.name like '%Presupuesto%' or t.name like 'Clientes' or t.name like '%Articulo%'
   or t.name like '%Familia%'
group by t.name
having sum(p.rows) > 0
order by sum(p.rows) desc;
"@
$tablas = Consultar $servidorBueno $candidatasSql
$tablas | Export-Csv -Path (Join-Path $Salida "tablas.csv") -NoTypeInformation -Delimiter ";" -Encoding UTF8
foreach ($fila in $tablas.Rows) {
  Apuntar ("  {0,-42} {1,12:N0} filas" -f $fila["Tabla"], $fila["Filas"])
}

# ------------------------------------------------------------ 2. LAS COLUMNAS
# Sin esto hay que adivinar, y adivinar en un servidor donde no puedo depurar
# es perder un día por cada nombre que no acierte.
$interesantes = @(
  "Clientes",
  "CabeceraOfertaCliente", "LineasOfertaCliente",
  "CabeceraPedidoCliente", "LineasPedidoCliente",
  "LineasAlbaranCliente",
  "Articulos"
)
foreach ($tabla in $interesantes) {
  $columnas = Consultar $servidorBueno @"
select c.name as Columna, ty.name as Tipo, c.max_length as Largo, c.is_nullable as Nulo
from sys.columns c
join sys.tables t on t.object_id = c.object_id
join sys.types ty on ty.user_type_id = c.user_type_id
where t.name = '$tabla'
order by c.column_id;
"@
  Apuntar ""
  if ($columnas.Rows.Count -eq 0) {
    Apuntar "=== $tabla — NO EXISTE en esta instalación ==="
    continue
  }
  Apuntar "=== $tabla — $($columnas.Rows.Count) columnas ==="
  $columnas | Export-Csv -Path (Join-Path $Salida "columnas-$tabla.csv") -NoTypeInformation -Delimiter ";" -Encoding UTF8
  # En pantalla solo las que de verdad hacen falta, que hay tablas de 200
  # columnas y el informe se vuelve ilegible.
  $utiles = @()
  foreach ($fila in $columnas.Rows) {
    $n = [string]$fila["Columna"]
    if ($n -match "Fecha|Codigo|Numero|Serie|Ejercicio|Empresa|Importe|Base|Neto|Coste|Unidades|Cantidad|Precio|Estado|Status|Familia|Articulo|Comisionista|Razon|Nombre|Alta|Baja|Tipo") {
      $utiles += ("{0} ({1})" -f $n, $fila["Tipo"])
    }
  }
  foreach ($linea in $utiles) { Apuntar "    $linea" }
  Apuntar "    ... y $($columnas.Rows.Count - $utiles.Count) columnas más, todas en el CSV"
}

# ------------------------------------------------- 3. ¿TIENEN DATOS UTILIZABLES?
function Sondear($titulo, $sql) {
  Apuntar ""
  Apuntar "=== $titulo ==="
  try {
    $t = Consultar $servidorBueno $sql
    if ($t.Rows.Count -eq 0) { Apuntar "  (sin filas)"; return }
    $cabecera = ($t.Columns | ForEach-Object { $_.ColumnName }) -join " | "
    Apuntar "  $cabecera"
    foreach ($fila in $t.Rows) {
      Apuntar ("  " + (($t.Columns | ForEach-Object { $fila[$_.ColumnName] }) -join " | "))
    }
  } catch {
    Apuntar "  NO SE PUDO: $($_.Exception.Message)"
  }
}

Sondear "OFERTAS por año (sociedad $Empresa)" @"
select year(FechaOferta) as Anio, count(*) as Ofertas
from CabeceraOfertaCliente
where CodigoEmpresa = $Empresa and FechaOferta >= convert(datetime, '20220101', 112)
group by year(FechaOferta) order by Anio;
"@

Sondear "PEDIDOS por año (sociedad $Empresa)" @"
select year(FechaPedido) as Anio, count(*) as Pedidos
from CabeceraPedidoCliente
where CodigoEmpresa = $Empresa and FechaPedido >= convert(datetime, '20220101', 112)
group by year(FechaPedido) order by Anio;
"@

Sondear "CLIENTES que han comprado, por año" @"
select year(a.FechaAlbaran) as Anio, count(distinct a.CodigoCliente) as ClientesDistintos
from CabeceraAlbaranCliente a
where a.CodigoEmpresa = $Empresa and a.FechaAlbaran >= convert(datetime, '20220101', 112)
group by year(a.FechaAlbaran) order by Anio;
"@

Sondear "¿Hay FAMILIA en las líneas del albarán?" @"
select top 5 CodigoFamilia, count(*) as Lineas, sum(isnull(ImporteNeto, 0)) as Neto
from LineasAlbaranCliente
where CodigoEmpresa = $Empresa and FechaAlbaran >= convert(datetime, '20260101', 112)
group by CodigoFamilia order by sum(isnull(ImporteNeto, 0)) desc;
"@

Sondear "¿Se guarda la fecha de ALTA del cliente?" @"
select top 3 name as PosibleColumnaDeAlta
from sys.columns
where object_id = object_id('Clientes') and name like '%Alta%';
"@

Apuntar ""
Apuntar "Guardado en: $Salida"
Apuntar "Mándame informe.txt y con eso escribo el agente sin adivinar."
Apuntar ""
Read-Host "Pulsa Intro para cerrar"
