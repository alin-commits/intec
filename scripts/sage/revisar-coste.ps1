<#
  ¿QUÉ ES "ImporteCoste" EN VUESTRO SAGE?
  =======================================

  Al traer el histórico salió que en 2023, 2024 y 2025 el coste de la cabecera
  del albarán es MAYOR que la venta, lo que daría un margen negativo imposible.
  En 2026 el mismo campo da un margen normal. Así que ese campo no significa lo
  mismo en todos los años, o no significa lo que parece.

  Este script compara, año por año:

    - La base imponible de la cabecera
    - El coste que dice la cabecera
    - El coste sumando las LÍNEAS del albarán, que es el que debería mandar
    - Cuántos albaranes tienen un coste mayor que su propia venta

  Si el coste de las líneas sí cuadra, el agente pasa a usar ese y listo.

  Este script SÍ enseña importes. Se queda en pantalla y en un CSV del
  Escritorio. No escribe nada en Sage.

  CÓMO SE USA
  -----------
    powershell -ExecutionPolicy Bypass -File C:\intec\revisar-coste.ps1
#>

param(
  [string]$Servidor = "",
  [string]$BaseDeDatos = "Sage",
  [int]$Empresa = 1,
  [int]$DesdeAnio = 2023,
  [string]$Salida = ""
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Data

if ([string]::IsNullOrWhiteSpace($Salida)) {
  $escritorio = [Environment]::GetFolderPath('Desktop')
  if ([string]::IsNullOrWhiteSpace($escritorio) -or -not (Test-Path $escritorio)) {
    $escritorio = Split-Path -Parent $MyInvocation.MyCommand.Path
  }
  $Salida = Join-Path $escritorio "sage-coste"
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
    $comando.CommandTimeout = 900
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

$desde = "${DesdeAnio}0101"

Write-Host ""
Write-Host "Comparando el coste de la cabecera con el de las lineas, sociedad $Empresa" -ForegroundColor Cyan
Write-Host ""

# El coste de las líneas se suma aparte y luego se cruza por documento, para no
# multiplicar la cabecera por cada línea al unir las dos tablas.
$sql = @"
with lineas as (
  select
    l.CodigoEmpresa, l.EjercicioAlbaran, l.SerieAlbaran, l.NumeroAlbaran,
    sum(isnull(l.ImporteCoste, 0)) as CosteLineas,
    sum(isnull(l.ImporteNeto, 0))  as NetoLineas
  from LineasAlbaranCliente l
  where l.CodigoEmpresa = $Empresa
    and l.FechaAlbaran >= convert(datetime, '$desde', 112)
  group by l.CodigoEmpresa, l.EjercicioAlbaran, l.SerieAlbaran, l.NumeroAlbaran
)
select
  year(a.FechaAlbaran)                       as Anio,
  count(*)                                   as Albaranes,
  sum(isnull(a.BaseImponible, 0))            as BaseCabecera,
  sum(isnull(a.ImporteCoste, 0))             as CosteCabecera,
  sum(isnull(l.CosteLineas, 0))              as CosteLineas,
  sum(isnull(l.NetoLineas, 0))               as NetoLineas,
  sum(case when isnull(a.ImporteCoste, 0) > isnull(a.BaseImponible, 0) and isnull(a.BaseImponible, 0) > 0 then 1 else 0 end) as ConCosteMayorQueVenta
from CabeceraAlbaranCliente a
left join lineas l
  on l.CodigoEmpresa = a.CodigoEmpresa
 and l.EjercicioAlbaran = a.EjercicioAlbaran
 and l.SerieAlbaran = a.SerieAlbaran
 and l.NumeroAlbaran = a.NumeroAlbaran
where a.CodigoEmpresa = $Empresa
  and a.FechaAlbaran >= convert(datetime, '$desde', 112)
group by year(a.FechaAlbaran)
order by Anio;
"@

$t = Consultar $servidorBueno $sql
$t | Export-Csv -Path (Join-Path $Salida "coste-por-anio.csv") -NoTypeInformation -Delimiter ";" -Encoding UTF8

Write-Host ("  {0,-6} {1,7} {2,14} {3,14} {4,14} {5,9} {6,9}" -f "Anio", "Albar.", "Base", "Coste cabecera", "Coste lineas", "Mg cab.", "Mg lin.")
Write-Host ("  " + ("-" * 82))
foreach ($fila in $t.Rows) {
  $base = [double]$fila["BaseCabecera"]
  $cc = [double]$fila["CosteCabecera"]
  $cl = [double]$fila["CosteLineas"]
  $mgc = if ($base -ne 0) { (($base - $cc) / $base * 100).ToString("0.0") } else { "-" }
  $mgl = if ($base -ne 0) { (($base - $cl) / $base * 100).ToString("0.0") } else { "-" }
  Write-Host ("  {0,-6} {1,7} {2,14:N0} {3,14:N0} {4,14:N0} {5,8} % {6,8} %" -f $fila["Anio"], $fila["Albaranes"], $base, $cc, $cl, $mgc, $mgl)
}

Write-Host ""
Write-Host "  Albaranes cuyo coste de cabecera supera a su propia venta:" -ForegroundColor Yellow
foreach ($fila in $t.Rows) {
  Write-Host ("    {0}: {1} de {2}" -f $fila["Anio"], $fila["ConCosteMayorQueVenta"], $fila["Albaranes"])
}

Write-Host ""
Write-Host "  La columna que hay que mirar es 'Mg lin.': si ese margen es razonable" -ForegroundColor Cyan
Write-Host "  todos los anios, el agente pasa a sumar el coste de las lineas." -ForegroundColor Cyan
Write-Host ""
Write-Host "  Guardado en: $Salida" -ForegroundColor Green
Write-Host ""
Read-Host "Pulsa Intro para cerrar"
