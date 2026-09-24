<#
  COMPROBAR UN DÍA CONTRA SAGE
  ============================

  Enseña el desglose de un día para poder cuadrarlo con lo que Sage muestra en
  su propia pantalla. No sirve para "validar" el total por sí solo —pregunta a
  la misma base de datos—, sirve para encontrar POR QUÉ no cuadra cuando no
  cuadra, que casi siempre es una de estas tres:

    - Los abonos y devoluciones: Sage los puede estar enseñando aparte, o
      restándolos, o no incluyéndolos.
    - La serie: algún listado filtra solo unas series.
    - Base imponible contra total con IVA.

  Por eso lo separa todo: positivos y negativos, serie por serie, y las dos
  sumas.

  Este script SÍ enseña importes. Se queda en la pantalla del servidor.

  CÓMO SE USA
  -----------
    powershell -ExecutionPolicy Bypass -File C:\comprobar-dia.ps1 -Fecha 2026-09-23

  Para otra sociedad:  -Empresa 2
#>

param(
  [string]$Fecha = "",
  [int]$Empresa = 1,
  [string]$Servidor = "",
  [string]$BaseDeDatos = "Sage"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Data

if ([string]::IsNullOrWhiteSpace($Fecha)) { $Fecha = (Get-Date).AddDays(-1).ToString("yyyy-MM-dd") }
try {
  $dia = [datetime]::ParseExact($Fecha, "yyyy-MM-dd", $null)
} catch {
  Write-Host "La fecha se escribe asi: -Fecha 2026-09-23" -ForegroundColor Red
  Read-Host "Pulsa Intro para cerrar"
  exit 1
}
# Sin guiones y con estilo 112, que un servidor en español no se lía.
$desde = $dia.ToString("yyyyMMdd")
$hasta = $dia.AddDays(1).ToString("yyyyMMdd")

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
  $conexion = New-Object System.Data.SqlClient.SqlConnection "Server=$servidor;Database=$BaseDeDatos;Integrated Security=SSPI;Connect Timeout=10;Application Name=Comprobacion Intec;"
  try {
    $conexion.Open()
    $comando = $conexion.CreateCommand()
    $comando.CommandText = $sql
    $comando.CommandTimeout = 300
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

$rango = "a.FechaAlbaran >= convert(datetime, '$desde', 112) and a.FechaAlbaran < convert(datetime, '$hasta', 112) and a.CodigoEmpresa = $Empresa"

Write-Host ""
Write-Host "  ALBARANES DE CLIENTE - $($dia.ToString('dd/MM/yyyy')) - sociedad $Empresa" -ForegroundColor Cyan
Write-Host "  ---------------------------------------------------------------"

# ---------------------------------------------------------------------------
# Lo primero que descuadra: si los abonos cuentan o no
# ---------------------------------------------------------------------------
$signos = Consultar $servidorBueno @"
select
  case when isnull(a.BaseImponible, 0) < 0 then 'Abonos y devoluciones' else 'Ventas' end as Tipo,
  count(*)                              as Albaranes,
  sum(isnull(a.BaseImponible, 0))       as Base,
  sum(isnull(a.TotalCuotaIva, 0))       as Iva
from CabeceraAlbaranCliente a
where $rango
group by case when isnull(a.BaseImponible, 0) < 0 then 'Abonos y devoluciones' else 'Ventas' end
order by 1 desc;
"@

$totalDoc = 0; $totalBase = 0.0; $totalIva = 0.0
foreach ($fila in $signos.Rows) {
  $totalDoc += [int]$fila["Albaranes"]
  $totalBase += [double]$fila["Base"]
  $totalIva += [double]$fila["Iva"]
  Write-Host ("  {0,-24} {1,4} albaranes   base {2,14:N2}   IVA {3,12:N2}" -f $fila["Tipo"], $fila["Albaranes"], $fila["Base"], $fila["Iva"])
}
Write-Host "  ---------------------------------------------------------------"
Write-Host ("  {0,-24} {1,4} albaranes   base {2,14:N2}   IVA {3,12:N2}" -f "TOTAL DEL DIA", $totalDoc, $totalBase, $totalIva) -ForegroundColor Green
Write-Host ("  {0,-24}                    total con IVA {1,12:N2}" -f "", ($totalBase + $totalIva))

# ---------------------------------------------------------------------------
# Y lo segundo: la serie, por si el listado de Sage filtra alguna
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "  POR SERIE" -ForegroundColor Cyan
$series = Consultar $servidorBueno @"
select
  isnull(ltrim(rtrim(a.SerieAlbaran)), '(sin serie)') as Serie,
  count(*)                        as Albaranes,
  sum(isnull(a.BaseImponible, 0)) as Base
from CabeceraAlbaranCliente a
where $rango
group by isnull(ltrim(rtrim(a.SerieAlbaran)), '(sin serie)')
order by sum(isnull(a.BaseImponible, 0)) desc;
"@
foreach ($fila in $series.Rows) {
  Write-Host ("    {0,-12} {1,4} albaranes   base {2,14:N2}" -f $fila["Serie"], $fila["Albaranes"], $fila["Base"])
}

Write-Host ""
Write-Host "  Si el numero de Sage no coincide, mira si incluye los abonos y si" -ForegroundColor Yellow
Write-Host "  esta sumando base imponible o total con IVA." -ForegroundColor Yellow
Write-Host ""
Read-Host "Pulsa Intro para cerrar"
