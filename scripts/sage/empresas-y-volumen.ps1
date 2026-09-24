<#
  SAGE 200 — EMPRESAS Y VOLUMEN
  =============================

  Segundo paso del reconocimiento. Responde a tres cosas:

    1. Qué empresas hay y con qué código.
    2. Cuántos documentos hay por empresa y año (ofertas, pedidos, albaranes).
    3. Si los campos que hacen falta para cada KPI están de verdad rellenos:
       el comercial, el coste, el CIF del cliente y el número de factura.

  Qué NO hace: no lee importes, ni nombres de clientes, ni precios. Solo cuenta
  filas y mira cuántas tienen un campo relleno. No escribe nada.

  CÓMO SE USA
  -----------
  Igual que el anterior: cópialo al servidor de Sage y botón derecho >
  "Ejecutar con PowerShell". Si Windows lo bloquea:

    powershell -ExecutionPolicy Bypass -File C:\ruta\empresas-y-volumen.ps1

  Si no encuentra el servidor, pásaselo:  -Servidor "NOMBRE\INSTANCIA"
  Y si entra con usuario de SQL:          -Usuario "nombre" -Clave "la clave"

  Deja los CSV en el Escritorio, en la carpeta "sage-empresas".
#>

param(
  [string]$Servidor = "",
  [string]$Usuario = "",
  [string]$Clave = "",
  [string]$BaseDeDatos = "Sage",
  [int]$DesdeAnio = 2022,
  [string]$Salida = "$env:USERPROFILE\Desktop\sage-empresas"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Data

function Buscar-Instancias {
  $encontradas = @()
  $ruta = "HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\Instance Names\SQL"
  if (Test-Path $ruta) {
    $propiedades = (Get-ItemProperty $ruta).PSObject.Properties
    foreach ($propiedad in $propiedades) {
      if ($propiedad.Name -like "PS*") { continue }
      if ($propiedad.Name -eq "MSSQLSERVER") { $encontradas += $env:COMPUTERNAME }
      else { $encontradas += "$env:COMPUTERNAME\$($propiedad.Name)" }
    }
  }
  if ($encontradas.Count -eq 0) { $encontradas = @("localhost", ".\SQLEXPRESS") }
  return $encontradas
}

function Nueva-Cadena($servidor, $baseDeDatos) {
  $cadena = "Server=$servidor;Database=$baseDeDatos;Connect Timeout=8;Application Name=Reconocimiento Intec;"
  if ($Usuario -ne "") { return $cadena + "User ID=$Usuario;Password=$Clave;" }
  return $cadena + "Integrated Security=SSPI;"
}

function Consultar($servidor, $baseDeDatos, $sql) {
  $conexion = New-Object System.Data.SqlClient.SqlConnection (Nueva-Cadena $servidor $baseDeDatos)
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

function Filas-A-Objetos($tabla) {
  $lista = @()
  foreach ($fila in $tabla.Rows) {
    $objeto = New-Object PSObject
    foreach ($columna in $tabla.Columns) {
      Add-Member -InputObject $objeto -MemberType NoteProperty -Name $columna.ColumnName -Value $fila[$columna.ColumnName]
    }
    $lista += $objeto
  }
  return $lista
}

# ---------------------------------------------------------------------------
# Conectar
# ---------------------------------------------------------------------------
$candidatos = @()
if ($Servidor -ne "") { $candidatos = @($Servidor) } else { $candidatos = Buscar-Instancias }

Write-Host ""
Write-Host "Buscando el servidor..." -ForegroundColor Cyan
$servidorBueno = ""
foreach ($candidato in $candidatos) {
  try {
    [void](Consultar $candidato $BaseDeDatos "select 1")
    $servidorBueno = $candidato
    Write-Host "  Conectado a $candidato, base de datos $BaseDeDatos" -ForegroundColor Green
    break
  } catch {
    Write-Host "  $candidato -> no responde" -ForegroundColor DarkGray
  }
}
if ($servidorBueno -eq "") {
  Write-Host "No se pudo conectar. Pasa el nombre con -Servidor ""NOMBRE\INSTANCIA""" -ForegroundColor Red
  exit 1
}

if (-not (Test-Path $Salida)) { New-Item -ItemType Directory -Path $Salida -Force | Out-Null }
$avisos = @()

# ---------------------------------------------------------------------------
# 1. Las empresas. El nombre se busca solo, que cada versión de Sage lo llama
#    de una manera.
# ---------------------------------------------------------------------------
Write-Host "  Empresas..." -NoNewline
try {
  $columnasEmpresa = Consultar $servidorBueno $BaseDeDatos @"
select c.name
from sys.columns c
join sys.tables t on t.object_id = c.object_id
where t.name = 'Empresas' and (c.name like '%Nombre%' or c.name like '%Razon%')
order by c.column_id;
"@
  $campoNombre = "CodigoEmpresa"
  if ($columnasEmpresa.Rows.Count -gt 0) { $campoNombre = $columnasEmpresa.Rows[0]["name"] }
  $empresas = Consultar $servidorBueno $BaseDeDatos "select CodigoEmpresa, [$campoNombre] as Empresa from Empresas order by CodigoEmpresa;"
  Filas-A-Objetos $empresas | Export-Csv -Path (Join-Path $Salida "1-empresas.csv") -NoTypeInformation -Delimiter ";" -Encoding UTF8
  Write-Host " $($empresas.Rows.Count)" -ForegroundColor Green
} catch {
  $avisos += "Empresas: $($_.Exception.Message)"
  Write-Host " no se pudo" -ForegroundColor Yellow
}

# ---------------------------------------------------------------------------
# 2. Cuántos documentos por empresa y año. Solo recuentos.
# ---------------------------------------------------------------------------
$documentos = @(
  @{ Nombre = "Ofertas";   Tabla = "CabeceraOfertaCliente";   Fecha = "FechaOferta" },
  @{ Nombre = "Pedidos";   Tabla = "CabeceraPedidoCliente";   Fecha = "FechaPedido" },
  @{ Nombre = "Albaranes"; Tabla = "CabeceraAlbaranCliente";  Fecha = "FechaAlbaran" }
)

$volumen = @()
foreach ($documento in $documentos) {
  Write-Host "  $($documento.Nombre)..." -NoNewline
  try {
    $sql = @"
select CodigoEmpresa, year([$($documento.Fecha)]) as Anio, count(*) as Documentos
from [$($documento.Tabla)]
where [$($documento.Fecha)] >= '$DesdeAnio-01-01'
group by CodigoEmpresa, year([$($documento.Fecha)])
order by CodigoEmpresa, Anio;
"@
    $resultado = Consultar $servidorBueno $BaseDeDatos $sql
    foreach ($fila in $resultado.Rows) {
      $objeto = New-Object PSObject
      Add-Member -InputObject $objeto -MemberType NoteProperty -Name "documento" -Value $documento.Nombre
      Add-Member -InputObject $objeto -MemberType NoteProperty -Name "codigo_empresa" -Value $fila["CodigoEmpresa"]
      Add-Member -InputObject $objeto -MemberType NoteProperty -Name "anio" -Value $fila["Anio"]
      Add-Member -InputObject $objeto -MemberType NoteProperty -Name "documentos" -Value $fila["Documentos"]
      $volumen += $objeto
    }
    Write-Host " $($resultado.Rows.Count) combinaciones" -ForegroundColor Green
  } catch {
    $avisos += "$($documento.Nombre): $($_.Exception.Message)"
    Write-Host " no se pudo" -ForegroundColor Yellow
  }
}
if ($volumen.Count -gt 0) {
  $volumen | Export-Csv -Path (Join-Path $Salida "2-volumen.csv") -NoTypeInformation -Delimiter ";" -Encoding UTF8
}

# ---------------------------------------------------------------------------
# 3. Si los campos que necesita cada KPI están rellenos de verdad.
#    Cuenta filas, no mira importes.
# ---------------------------------------------------------------------------
Write-Host "  Campos rellenos..." -NoNewline
try {
  $sqlCobertura = @"
select
  a.CodigoEmpresa,
  year(a.FechaAlbaran)                                                     as Anio,
  count(*)                                                                 as Albaranes,
  sum(case when a.CodigoComisionista is not null and a.CodigoComisionista <> 0 then 1 else 0 end) as ConComercial,
  sum(case when a.ImporteCoste is not null and a.ImporteCoste <> 0 then 1 else 0 end)             as ConCoste,
  sum(case when a.NumeroFactura is not null and a.NumeroFactura <> 0 then 1 else 0 end)           as ConNumeroFactura,
  sum(case when a.StatusFacturado = 1 then 1 else 0 end)                                          as Facturados,
  sum(case when a.CifDni is not null and ltrim(rtrim(a.CifDni)) <> '' then 1 else 0 end)          as ConCif
from CabeceraAlbaranCliente a
where a.FechaAlbaran >= '$DesdeAnio-01-01'
group by a.CodigoEmpresa, year(a.FechaAlbaran)
order by a.CodigoEmpresa, Anio;
"@
  $cobertura = Consultar $servidorBueno $BaseDeDatos $sqlCobertura
  Filas-A-Objetos $cobertura | Export-Csv -Path (Join-Path $Salida "3-campos-rellenos.csv") -NoTypeInformation -Delimiter ";" -Encoding UTF8
  Write-Host " ok" -ForegroundColor Green
} catch {
  $avisos += "Campos rellenos: $($_.Exception.Message)"
  Write-Host " no se pudo" -ForegroundColor Yellow
}

# ---------------------------------------------------------------------------
# 4. Cuántos comerciales distintos aparecen, y con cuántos albaranes cada uno.
#    Solo el código, sin nombres ni importes.
# ---------------------------------------------------------------------------
Write-Host "  Comerciales..." -NoNewline
try {
  $sqlComerciales = @"
select CodigoEmpresa, CodigoComisionista, count(*) as Albaranes
from CabeceraAlbaranCliente
where FechaAlbaran >= '$DesdeAnio-01-01'
group by CodigoEmpresa, CodigoComisionista
order by CodigoEmpresa, count(*) desc;
"@
  $comerciales = Consultar $servidorBueno $BaseDeDatos $sqlComerciales
  Filas-A-Objetos $comerciales | Export-Csv -Path (Join-Path $Salida "4-comerciales.csv") -NoTypeInformation -Delimiter ";" -Encoding UTF8
  Write-Host " $($comerciales.Rows.Count)" -ForegroundColor Green
} catch {
  $avisos += "Comerciales: $($_.Exception.Message)"
  Write-Host " no se pudo" -ForegroundColor Yellow
}

if ($avisos.Count -gt 0) {
  $avisos | Set-Content -Path (Join-Path $Salida "5-avisos.txt") -Encoding UTF8
}

Write-Host ""
Write-Host "Listo." -ForegroundColor Cyan
Write-Host "Los CSV estan en: $Salida" -ForegroundColor Green
if ($avisos.Count -gt 0) {
  Write-Host "Algo no se pudo leer; mira 5-avisos.txt" -ForegroundColor Yellow
}
Write-Host ""
Read-Host "Pulsa Intro para cerrar"
