<#
  SAGE 200 — NOMBRES DE EMPRESAS Y COMERCIALES
  ============================================

  Lo último que falta: poner nombre a los códigos. Enseña en pantalla qué
  empresa es cada código (1, 2, 3, 4) y cómo se llama cada comercial (150, 54,
  24...), y lo deja también en CSV por si es más cómodo copiarlo.

  La columna del nombre se busca sola: en esta instalación la de Empresas no se
  llama RazonSocial sino Empresa, así que aquí se prueban todas las columnas de
  texto y se coge la primera que tenga algo escrito.

  No lee importes, ni clientes, ni ventas. No escribe nada.

  CÓMO SE USA
  -----------
  Cópialo al servidor y botón derecho > "Ejecutar con PowerShell".
  Si Windows lo bloquea:

    powershell -ExecutionPolicy Bypass -File C:\ruta\nombres.ps1
#>

param(
  [string]$Servidor = "",
  [string]$Usuario = "",
  [string]$Clave = "",
  [string]$BaseDeDatos = "Sage",
  [string]$Salida = ""
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Data

# El Escritorio de verdad, que con OneDrive no es "$env:USERPROFILE\Desktop"
# sino una carpeta redirigida. Si aun así no se puede escribir, se deja al lado
# del propio script, que es donde seguro que hay permiso.
if ($Salida -eq "") {
  $escritorio = [Environment]::GetFolderPath('Desktop')
  if ($escritorio -eq "" -or -not (Test-Path $escritorio)) {
    $escritorio = Split-Path -Parent $MyInvocation.MyCommand.Path
  }
  $Salida = Join-Path $escritorio "sage-nombres"
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

function Nueva-Cadena($servidor) {
  $cadena = "Server=$servidor;Database=$BaseDeDatos;Connect Timeout=8;Application Name=Reconocimiento Intec;"
  if ($Usuario -ne "") { return $cadena + "User ID=$Usuario;Password=$Clave;" }
  return $cadena + "Integrated Security=SSPI;"
}

function Consultar($servidor, $sql) {
  $conexion = New-Object System.Data.SqlClient.SqlConnection (Nueva-Cadena $servidor)
  try {
    $conexion.Open()
    $comando = $conexion.CreateCommand()
    $comando.CommandText = $sql
    $comando.CommandTimeout = 120
    $adaptador = New-Object System.Data.SqlClient.SqlDataAdapter $comando
    $tabla = New-Object System.Data.DataTable
    [void]$adaptador.Fill($tabla)
    return ,$tabla
  } finally {
    $conexion.Close()
  }
}

# Construye un coalesce sobre todas las columnas de texto de la tabla, para dar
# con la que lleva el nombre sin tener que adivinarla.
function Expresion-Nombre($servidor, $tabla, $excluir) {
  $columnas = Consultar $servidor @"
select c.name
from sys.columns c
join sys.tables t on t.object_id = c.object_id
join sys.types ty on ty.user_type_id = c.user_type_id
where t.name = '$tabla'
  and ty.name in ('varchar', 'nvarchar', 'char', 'nchar')
  and c.max_length >= 10
order by c.column_id;
"@
  $trozos = @()
  foreach ($fila in $columnas.Rows) {
    $columna = $fila["name"]
    if ($excluir -contains $columna) { continue }
    $trozos += "nullif(ltrim(rtrim(cast([$columna] as nvarchar(200)))), '')"
    if ($trozos.Count -ge 8) { break }
  }
  if ($trozos.Count -eq 0) { return "'sin nombre'" }
  return "coalesce(" + ($trozos -join ", ") + ", 'sin nombre')"
}

# ---------------------------------------------------------------------------
$candidatos = @()
if ($Servidor -ne "") { $candidatos = @($Servidor) } else { $candidatos = Buscar-Instancias }

Write-Host ""
$servidorBueno = ""
foreach ($candidato in $candidatos) {
  try {
    [void](Consultar $candidato "select 1")
    $servidorBueno = $candidato
    break
  } catch { }
}
if ($servidorBueno -eq "") {
  Write-Host "No se pudo conectar. Pasa el nombre con -Servidor ""NOMBRE\INSTANCIA""" -ForegroundColor Red
  Read-Host "Pulsa Intro para cerrar"
  exit 1
}
if (-not (Test-Path $Salida)) { New-Item -ItemType Directory -Path $Salida -Force | Out-Null }

Write-Host "=== EMPRESAS ===" -ForegroundColor Cyan
try {
  $expresion = Expresion-Nombre $servidorBueno "Empresas" @("CodigoMonedaBase", "SiglaNacion")
  $empresas = Consultar $servidorBueno "select CodigoEmpresa, $expresion as Empresa from Empresas order by CodigoEmpresa;"
  foreach ($fila in $empresas.Rows) { Write-Host ("  {0,-8} {1}" -f $fila["CodigoEmpresa"], $fila["Empresa"]) }
  $empresas | Export-Csv -Path (Join-Path $Salida "empresas.csv") -NoTypeInformation -Delimiter ";" -Encoding UTF8
} catch {
  Write-Host "  no se pudo: $($_.Exception.Message)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=== COMERCIALES ===" -ForegroundColor Cyan
try {
  $expresion = Expresion-Nombre $servidorBueno "Comisionistas" @()
  # No todas las tablas de Sage llevan CodigoEmpresa; se comprueba antes de pedirlo.
  $tieneEmpresa = (Consultar $servidorBueno "select count(*) as n from sys.columns c join sys.tables t on t.object_id = c.object_id where t.name = 'Comisionistas' and c.name = 'CodigoEmpresa';").Rows[0]["n"] -gt 0
  if ($tieneEmpresa) {
    $comerciales = Consultar $servidorBueno "select CodigoEmpresa, CodigoComisionista, $expresion as Comercial from Comisionistas order by CodigoEmpresa, CodigoComisionista;"
    foreach ($fila in $comerciales.Rows) { Write-Host ("  {0,-4} {1,-6} {2}" -f $fila["CodigoEmpresa"], $fila["CodigoComisionista"], $fila["Comercial"]) }
  } else {
    $comerciales = Consultar $servidorBueno "select CodigoComisionista, $expresion as Comercial from Comisionistas order by CodigoComisionista;"
    foreach ($fila in $comerciales.Rows) { Write-Host ("  {0,-6} {1}" -f $fila["CodigoComisionista"], $fila["Comercial"]) }
  }
  $comerciales | Export-Csv -Path (Join-Path $Salida "comerciales.csv") -NoTypeInformation -Delimiter ";" -Encoding UTF8
} catch {
  Write-Host "  no se pudo: $($_.Exception.Message)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=======================================================" -ForegroundColor Green
Write-Host " Guardado en: $Salida" -ForegroundColor Green
Write-Host "=======================================================" -ForegroundColor Green
Write-Host ""
Read-Host "Pulsa Intro para cerrar"
