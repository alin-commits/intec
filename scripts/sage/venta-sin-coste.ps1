<#
  QUÉ VENTA NO TIENE COSTE GRABADO
  ================================

  En la primera prueba salieron 4.711 € de 100.296 € sin coste, un 4,7 %. Esa
  venta cuenta como si no costara nada, así que infla el margen. Este script
  dice dónde está, para que Administración pueda mirarlo.

  Devuelve cuatro cosas:

    1. Cuánta venta sin coste hay, por sociedad y mes.
    2. En qué series ocurre (tienda, web, servicio técnico...).
    3. Los albaranes concretos, para poder abrirlos en Sage.
    4. Los ARTÍCULOS a los que les falta el precio de coste en su ficha, que es
       la causa de fondo: arreglando la ficha se arregla de aquí en adelante.

  OJO: a diferencia de los otros scripts, este SÍ devuelve datos de negocio
  (números de albarán, códigos de artículo e importes). Se queda en el servidor,
  en la carpeta "sage-sin-coste" del Escritorio. Decide tú si hace falta
  enviarlo a alguien.

  No escribe nada en Sage.

  CÓMO SE USA
  -----------
    powershell -ExecutionPolicy Bypass -File C:\venta-sin-coste.ps1

  Por defecto mira el año en curso. Para otro periodo:  -Dias 365
#>

param(
  [string]$Servidor = "",
  [string]$BaseDeDatos = "Sage",
  [int]$Dias = 0,
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
  $Salida = Join-Path $escritorio "sage-sin-coste"
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
  $conexion = New-Object System.Data.SqlClient.SqlConnection "Server=$servidor;Database=$BaseDeDatos;Integrated Security=SSPI;Connect Timeout=10;Application Name=Revision Intec;"
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

# Sin guiones y con estilo 112: un servidor en español lee "2026-09-17" como
# día 2026 y falla.
if ($Dias -gt 0) { $desde = (Get-Date).AddDays(-$Dias).ToString("yyyyMMdd") }
else { $desde = (Get-Date -Format "yyyy") + "0101" }
$hasta = (Get-Date).AddDays(1).ToString("yyyyMMdd")
$rango = "a.FechaAlbaran >= convert(datetime, '$desde', 112) and a.FechaAlbaran < convert(datetime, '$hasta', 112)"

Write-Host ""
Write-Host "Mirando desde $desde en la sociedad $Empresa..." -ForegroundColor Cyan

function Guardar($nombre, $sql) {
  Write-Host "  $nombre..." -NoNewline
  try {
    $t = Consultar $servidorBueno $sql
    $t | Export-Csv -Path (Join-Path $Salida $nombre) -NoTypeInformation -Delimiter ";" -Encoding UTF8
    Write-Host " $($t.Rows.Count) filas" -ForegroundColor Green
    return ,$t
  } catch {
    Write-Host " no se pudo: $($_.Exception.Message)" -ForegroundColor Yellow
    return $null
  }
}

# ---------------------------------------------------------------------------
# 1. Cuánto es, por mes
# ---------------------------------------------------------------------------
$resumen = Guardar "1-por-mes.csv" @"
select
  a.CodigoEmpresa,
  year(a.FechaAlbaran) * 100 + month(a.FechaAlbaran) as Mes,
  count(*)                                           as Albaranes,
  sum(isnull(a.BaseImponible, 0))                    as VentaTotal,
  sum(case when isnull(a.ImporteCoste, 0) = 0 then isnull(a.BaseImponible, 0) else 0 end) as VentaSinCoste
from CabeceraAlbaranCliente a
where $rango and a.CodigoEmpresa = $Empresa
group by a.CodigoEmpresa, year(a.FechaAlbaran) * 100 + month(a.FechaAlbaran)
order by Mes;
"@

if ($resumen -ne $null) {
  Write-Host ""
  foreach ($fila in $resumen.Rows) {
    $total = [double]$fila["VentaTotal"]
    $sin = [double]$fila["VentaSinCoste"]
    $parte = if ($total -ne 0) { ($sin / $total * 100).ToString("0.0") } else { "0,0" }
    Write-Host ("  {0}   sin coste {1,12:N2} EUR de {2,12:N2}   ({3} %)" -f $fila["Mes"], $sin, $total, $parte)
  }
  Write-Host ""
}

# ---------------------------------------------------------------------------
# 2. En qué series pasa
# ---------------------------------------------------------------------------
[void](Guardar "2-por-serie.csv" @"
select
  isnull(ltrim(rtrim(a.SerieAlbaran)), '') as Serie,
  count(*)                                 as Albaranes,
  sum(isnull(a.BaseImponible, 0))          as VentaSinCoste
from CabeceraAlbaranCliente a
where $rango and a.CodigoEmpresa = $Empresa and isnull(a.ImporteCoste, 0) = 0 and isnull(a.BaseImponible, 0) > 0
group by isnull(ltrim(rtrim(a.SerieAlbaran)), '')
order by sum(isnull(a.BaseImponible, 0)) desc;
"@)

# ---------------------------------------------------------------------------
# 3. Los albaranes concretos, para abrirlos en Sage
# ---------------------------------------------------------------------------
[void](Guardar "3-albaranes.csv" @"
select top (500)
  a.EjercicioAlbaran, a.SerieAlbaran, a.NumeroAlbaran,
  cast(a.FechaAlbaran as date) as Fecha,
  a.CodigoCliente,
  a.BaseImponible
from CabeceraAlbaranCliente a
where $rango and a.CodigoEmpresa = $Empresa and isnull(a.ImporteCoste, 0) = 0 and isnull(a.BaseImponible, 0) > 0
order by a.BaseImponible desc;
"@)

# ---------------------------------------------------------------------------
# 4. La causa de fondo: artículos vendidos sin precio de coste en su línea
# ---------------------------------------------------------------------------
[void](Guardar "4-articulos.csv" @"
select top (300)
  l.CodigoArticulo,
  max(l.DescripcionArticulo)      as Descripcion,
  max(l.CodigoFamilia)            as Familia,
  count(*)                        as Lineas,
  sum(isnull(l.ImporteNeto, 0))   as VentaSinCoste
from LineasAlbaranCliente l
join CabeceraAlbaranCliente a
  on a.CodigoEmpresa = l.CodigoEmpresa
 and a.EjercicioAlbaran = l.EjercicioAlbaran
 and a.SerieAlbaran = l.SerieAlbaran
 and a.NumeroAlbaran = l.NumeroAlbaran
where $rango and l.CodigoEmpresa = $Empresa
  and isnull(l.ImporteCoste, 0) = 0
  and isnull(l.ImporteNeto, 0) > 0
group by l.CodigoArticulo
order by sum(isnull(l.ImporteNeto, 0)) desc;
"@)

Write-Host ""
Write-Host "Los CSV estan en: $Salida" -ForegroundColor Green
Write-Host "El que mas sirve es 4-articulos.csv: son las fichas a las que les falta el coste." -ForegroundColor Cyan
Write-Host "Ojo: estos ficheros SI llevan datos de negocio." -ForegroundColor Yellow
Write-Host ""
Read-Host "Pulsa Intro para cerrar"
