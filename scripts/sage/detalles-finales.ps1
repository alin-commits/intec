<#
  SAGE 200 — DETALLES QUE FALTAN
  ==============================

  Tercer y último paso del reconocimiento. Cierra los cabos sueltos que dejaron
  los dos anteriores:

    1. El nombre de cada empresa (el script anterior cogió una columna vacía).
    2. Qué significa "facturado": Sage guarda los sí/no como 0 y -1, no como 1,
       así que hay que mirar qué valores usa de verdad.
    3. En qué tabla están guardados los comerciales, para poder ponerles
       nombre más adelante.
    4. Las series de albarán de cada empresa, que es lo que permitirá separar
       la venta de tienda de la de los comerciales de calle.
    5. Si hay devoluciones o abonos, para no contarlos como venta.

  Como los dos anteriores: no lee importes, ni nombres de clientes, ni de
  empleados, ni precios. Solo cuenta filas y mira nombres de tablas y columnas.
  No escribe nada.

  CÓMO SE USA
  -----------
  Igual que los anteriores: al servidor, botón derecho > "Ejecutar con
  PowerShell". Si Windows lo bloquea:

    powershell -ExecutionPolicy Bypass -File C:\ruta\detalles-finales.ps1

  Deja los CSV en el Escritorio, en la carpeta "sage-detalles".
#>

param(
  [string]$Servidor = "",
  [string]$Usuario = "",
  [string]$Clave = "",
  [string]$BaseDeDatos = "Sage",
  [int]$DesdeAnio = 2025,
  [string]$Salida = "$env:USERPROFILE\Desktop\sage-detalles"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Data

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

$avisos = @()
function Guardar($nombre, $sql) {
  Write-Host "  $nombre..." -NoNewline
  try {
    $resultado = Consultar $script:servidorBueno $BaseDeDatos $sql
    Filas-A-Objetos $resultado | Export-Csv -Path (Join-Path $Salida $nombre) -NoTypeInformation -Delimiter ";" -Encoding UTF8
    Write-Host " $($resultado.Rows.Count) filas" -ForegroundColor Green
  } catch {
    $script:avisos += "$nombre -> $($_.Exception.Message)"
    Write-Host " no se pudo" -ForegroundColor Yellow
  }
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
    Write-Host "  Conectado a $candidato" -ForegroundColor Green
    break
  } catch { Write-Host "  $candidato -> no responde" -ForegroundColor DarkGray }
}
if ($servidorBueno -eq "") {
  Write-Host "No se pudo conectar. Pasa el nombre con -Servidor ""NOMBRE\INSTANCIA""" -ForegroundColor Red
  exit 1
}
if (-not (Test-Path $Salida)) { New-Item -ItemType Directory -Path $Salida -Force | Out-Null }

# ---------------------------------------------------------------------------
# 1. El nombre de las empresas: se prueban todas las columnas de texto y se
#    devuelve la primera que tenga algo escrito.
# ---------------------------------------------------------------------------
Guardar "1-empresas.csv" @"
select
  CodigoEmpresa,
  coalesce(
    nullif(ltrim(rtrim(cast(RazonSocial as nvarchar(200)))), ''),
    nullif(ltrim(rtrim(cast(Nombre      as nvarchar(200)))), ''),
    'sin nombre'
  ) as Empresa
from Empresas
order by CodigoEmpresa;
"@

# Por si esta versión de Sage llama de otra manera a esas columnas.
Guardar "1b-columnas-de-empresas.csv" @"
select c.name as columna, ty.name as tipo, c.max_length as largo
from sys.columns c
join sys.tables t on t.object_id = c.object_id
join sys.types ty on ty.user_type_id = c.user_type_id
where t.name = 'Empresas' and ty.name in ('varchar', 'nvarchar', 'char', 'nchar')
order by c.column_id;
"@

# ---------------------------------------------------------------------------
# 2. Qué valores usa de verdad el "facturado" y el "contabilizado".
# ---------------------------------------------------------------------------
Guardar "2-estados.csv" @"
select
  CodigoEmpresa,
  year(FechaAlbaran) as Anio,
  StatusFacturado,
  StatusContabilizado,
  count(*) as Albaranes
from CabeceraAlbaranCliente
where FechaAlbaran >= '$DesdeAnio-01-01'
group by CodigoEmpresa, year(FechaAlbaran), StatusFacturado, StatusContabilizado
order by CodigoEmpresa, Anio, count(*) desc;
"@

# ---------------------------------------------------------------------------
# 3. En qué tabla viven los comerciales. Solo el nombre de la tabla: los
#    nombres de las personas se mirarán después, si hacen falta.
# ---------------------------------------------------------------------------
Guardar "3-comerciales.csv" @"
select c.name as tabla_de_comerciales
from sys.tables c
where c.name like '%Comision%' or c.name like '%Agente%' or c.name like '%Vendedor%'
order by c.name;
"@

# ---------------------------------------------------------------------------
# 4. Las series de albarán de cada empresa: aquí suele estar la diferencia
#    entre la venta de tienda y la de los comerciales.
# ---------------------------------------------------------------------------
Guardar "4-series.csv" @"
select
  CodigoEmpresa,
  year(FechaAlbaran) as Anio,
  SerieAlbaran,
  count(*) as Albaranes,
  min(FechaAlbaran) as Desde,
  max(FechaAlbaran) as Hasta
from CabeceraAlbaranCliente
where FechaAlbaran >= '$DesdeAnio-01-01'
group by CodigoEmpresa, year(FechaAlbaran), SerieAlbaran
order by CodigoEmpresa, Anio, count(*) desc;
"@

# ---------------------------------------------------------------------------
# 5. Devoluciones y abonos: cuántos documentos van en negativo. Solo se cuenta
#    el signo, no se lee ningún importe.
# ---------------------------------------------------------------------------
Guardar "5-devoluciones.csv" @"
select
  CodigoEmpresa,
  year(FechaAlbaran) as Anio,
  case when BaseImponible < 0 then 'negativo' else 'positivo' end as Signo,
  count(*) as Albaranes
from CabeceraAlbaranCliente
where FechaAlbaran >= '$DesdeAnio-01-01'
group by CodigoEmpresa, year(FechaAlbaran), case when BaseImponible < 0 then 'negativo' else 'positivo' end
order by CodigoEmpresa, Anio, Signo;
"@

# ---------------------------------------------------------------------------
# 6. Las familias de artículo que se usan, para las ventas por familia.
# ---------------------------------------------------------------------------
Guardar "6-familias.csv" @"
select top (60)
  l.CodigoEmpresa,
  l.CodigoFamilia,
  count(*) as Lineas
from LineasAlbaranCliente l
where l.FechaAlbaran >= '$DesdeAnio-01-01'
group by l.CodigoEmpresa, l.CodigoFamilia
order by count(*) desc;
"@

if ($avisos.Count -gt 0) {
  $avisos | Set-Content -Path (Join-Path $Salida "9-avisos.txt") -Encoding UTF8
}

Write-Host ""
Write-Host "Listo." -ForegroundColor Cyan
Write-Host "Los CSV estan en: $Salida" -ForegroundColor Green
if ($avisos.Count -gt 0) { Write-Host "Algo no se pudo leer; mira 9-avisos.txt" -ForegroundColor Yellow }
Write-Host ""
Read-Host "Pulsa Intro para cerrar"
