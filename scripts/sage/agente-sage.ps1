<#
  AGENTE DE SAGE → COMMERCIAL HUB
  ===============================

  Lee las ventas de Sage, calcula los totales por día y los envía al Hub.
  Pensado para correr en el propio servidor de Sage como tarea programada.

  Qué envía: totales por sociedad, día, serie y comercial. Nada más.
  NO envía clientes, ni artículos, ni documentos, ni precios de nadie.

  Qué NO hace: escribir en Sage. Todas las consultas son de solo lectura.

  ---------------------------------------------------------------------------
  PUESTA EN MARCHA
  ---------------------------------------------------------------------------
  1. Copiar este archivo al servidor, por ejemplo en C:\intec\agente-sage.ps1
  2. Guardar la clave de envío en una variable del sistema (una sola vez, como
     administrador). Sin esto el agente no arranca:

       setx /M INTEC_SAGE_TOKEN "la-clave-que-te-pase"

  3. Probarlo a mano una vez:

       powershell -ExecutionPolicy Bypass -File C:\intec\agente-sage.ps1 -Dias 7

  4. Programarlo. Cada noche a las 03:00, y cada hora en horario de oficina:

       schtasks /Create /TN "Intec - Sage noche" /SC DAILY /ST 03:00 /RU SYSTEM ^
         /TR "powershell -ExecutionPolicy Bypass -File C:\intec\agente-sage.ps1 -Dias 90"

       schtasks /Create /TN "Intec - Sage hoy" /SC HOURLY /RU SYSTEM ^
         /TR "powershell -ExecutionPolicy Bypass -File C:\intec\agente-sage.ps1 -Dias 2"

  La tarea de la noche repasa los últimos 90 días, por si alguien corrige un
  albarán viejo. La de cada hora solo mira hoy y ayer, que es barato.

  ---------------------------------------------------------------------------
  Deja un registro en C:\intec\agente-sage.log con lo que hace cada ejecución.
#>

param(
  [string]$Servidor = "",
  # Salen de variables del sistema para que la contraseña no quede escrita en la
  # tarea programada, donde la vería cualquiera que mire sus propiedades.
  [string]$Usuario = $env:INTEC_SAGE_DB_USER,
  [string]$Clave = $env:INTEC_SAGE_DB_PASSWORD,
  [string]$BaseDeDatos = "Sage",
  [int]$Dias = 90,
  [string]$Destino = "https://app.suministrointec.com/api/sage/ingest",
  [string]$Token = $env:INTEC_SAGE_TOKEN,
  [string]$Registro = "",
  [switch]$SoloProbar
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Data

# Lo mismo que en el script de alta: una variable recién puesta con setx no
# existe en la consola donde se escribió. Se lee de donde quedó guardada.
if ([string]::IsNullOrWhiteSpace($Token)) { $Token = [Environment]::GetEnvironmentVariable("INTEC_SAGE_TOKEN", "Machine") }
if ([string]::IsNullOrWhiteSpace($Usuario)) { $Usuario = [Environment]::GetEnvironmentVariable("INTEC_SAGE_DB_USER", "Machine") }
if ([string]::IsNullOrWhiteSpace($Clave)) { $Clave = [Environment]::GetEnvironmentVariable("INTEC_SAGE_DB_PASSWORD", "Machine") }

if ($Registro -eq "") {
  $Registro = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "agente-sage.log"
}

function Apuntar($texto) {
  $linea = "{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $texto
  Write-Host $linea
  try { Add-Content -Path $Registro -Value $linea -Encoding UTF8 } catch { }
}

# Las sociedades de demostración y de pruebas de Sage no son negocio.
$EmpresasExcluidas = @(9999, 10000)

# ---------------------------------------------------------------------------
# Conexión
# ---------------------------------------------------------------------------
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
  $cadena = "Server=$servidor;Database=$BaseDeDatos;Connect Timeout=10;Application Name=Agente Intec;"
  # Si no hay usuario configurado se entra con la cuenta de Windows que ejecuta
  # la tarea. Ojo: $env: devuelve nulo cuando la variable no existe, no cadena
  # vacía, así que hay que comprobarlo así y no con -ne "".
  if (-not [string]::IsNullOrWhiteSpace($Usuario)) { return $cadena + "User ID=$Usuario;Password=$Clave;" }
  return $cadena + "Integrated Security=SSPI;"
}

function Consultar($servidor, $sql) {
  $conexion = New-Object System.Data.SqlClient.SqlConnection (Nueva-Cadena $servidor)
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

# ---------------------------------------------------------------------------
Apuntar "----- arranque: ultimos $Dias dias -----"

if (-not $SoloProbar -and [string]::IsNullOrWhiteSpace($Token)) {
  Apuntar "ERROR: falta la clave. Ponla con:  setx /M INTEC_SAGE_TOKEN ""...""  y vuelve a abrir la consola."
  exit 1
}

$candidatos = @()
if ($Servidor -ne "") { $candidatos = @($Servidor) } else { $candidatos = Buscar-Instancias }
$servidorBueno = ""
foreach ($candidato in $candidatos) {
  try { [void](Consultar $candidato "select 1"); $servidorBueno = $candidato; break } catch { }
}
if ($servidorBueno -eq "") {
  Apuntar "ERROR: no se pudo conectar a SQL Server. Prueba con -Servidor ""NOMBRE\INSTANCIA""."
  exit 1
}
Apuntar "conectado a $servidorBueno"

# Dos formatos para las mismas fechas. El de SQL Server va sin guiones y se
# convierte con el estilo 112: con guiones, un servidor configurado en español
# lee "2026-09-17" como día 2026 y revienta. El otro, con guiones, es el que
# entiende el Hub.
$desde = (Get-Date).AddDays(-$Dias).ToString("yyyy-MM-dd")
$hasta = (Get-Date).AddDays(1).ToString("yyyy-MM-dd")
$desdeSql = (Get-Date).AddDays(-$Dias).ToString("yyyyMMdd")
$hastaSql = (Get-Date).AddDays(1).ToString("yyyyMMdd")
$excluidas = $EmpresasExcluidas -join ", "

# ---------------------------------------------------------------------------
# Las sociedades y los comerciales
# ---------------------------------------------------------------------------
$empresas = Consultar $servidorBueno @"
select CodigoEmpresa, ltrim(rtrim(Empresa)) as Empresa
from Empresas
where CodigoEmpresa not in ($excluidas)
order by CodigoEmpresa;
"@

# La columna del nombre no se adivina: se prueban las de texto de la tabla y se
# coge la primera que tenga algo escrito. Cada instalación de Sage la llama de
# una manera, y equivocarse aquí deja a todos los comerciales sin nombre.
$columnasComercial = Consultar $servidorBueno @"
select c.name
from sys.columns c
join sys.tables t on t.object_id = c.object_id
join sys.types ty on ty.user_type_id = c.user_type_id
where t.name = 'Comisionistas'
  and ty.name in ('varchar', 'nvarchar', 'char', 'nchar')
  and c.max_length >= 10
order by c.column_id;
"@
$trozos = @()
foreach ($fila in $columnasComercial.Rows) {
  $trozos += "nullif(ltrim(rtrim(cast([$($fila["name"])] as nvarchar(200)))), '')"
  if ($trozos.Count -ge 8) { break }
}
$expresionNombre = if ($trozos.Count -gt 0) { "coalesce(" + ($trozos -join ", ") + ", 'Sin nombre')" } else { "'Sin nombre'" }

$comerciales = Consultar $servidorBueno @"
select CodigoEmpresa, CodigoComisionista, $expresionNombre as Nombre
from Comisionistas
where CodigoEmpresa not in ($excluidas);
"@

# ---------------------------------------------------------------------------
# Las ventas. Dos maneras de fechar la misma venta: cuándo se sirvió y cuándo se
# facturó. Se mandan las dos y el panel enseña la que haga falta.
#
# Las devoluciones vienen en negativo y se suman tal cual, que es lo correcto:
# restan de la venta del día.
# ---------------------------------------------------------------------------
function Sql-Ventas($campoFecha, $filtro) {
  return @"
select
  a.CodigoEmpresa,
  cast(a.$campoFecha as date)                  as Dia,
  isnull(ltrim(rtrim(a.SerieAlbaran)), '')     as Serie,
  case when a.CodigoComisionista in (0, 9999) then null else a.CodigoComisionista end as Comercial,
  count(*)                                     as Documentos,
  sum(isnull(a.BaseImponible, 0))              as Neto,
  sum(isnull(a.ImporteCoste, 0))               as Coste,
  sum(isnull(a.TotalCuotaIva, 0))              as Iva,
  -- La venta cuyos albaranes no llevan coste: si se contara como si no
  -- costara nada, el margen saldría más alto de lo que es.
  sum(case when isnull(a.ImporteCoste, 0) = 0 then isnull(a.BaseImponible, 0) else 0 end) as NetoSinCoste
from CabeceraAlbaranCliente a
where a.$campoFecha >= convert(datetime, '$desdeSql', 112) and a.$campoFecha < convert(datetime, '$hastaSql', 112)
  and a.CodigoEmpresa not in ($excluidas)
  $filtro
group by
  a.CodigoEmpresa,
  cast(a.$campoFecha as date),
  isnull(ltrim(rtrim(a.SerieAlbaran)), ''),
  case when a.CodigoComisionista in (0, 9999) then null else a.CodigoComisionista end;
"@
}

$porAlbaran = Consultar $servidorBueno (Sql-Ventas "FechaAlbaran" "")
# Solo los albaranes ya facturados tienen fecha de factura. En Sage el sí/no se
# guarda como -1, no como 1.
$porFactura = Consultar $servidorBueno (Sql-Ventas "FechaFactura" "and a.StatusFacturado = -1")

Apuntar "leido: $($empresas.Rows.Count) sociedades, $($comerciales.Rows.Count) comerciales, $($porAlbaran.Rows.Count)+$($porFactura.Rows.Count) filas de venta"

# ---------------------------------------------------------------------------
# Montar el envío
# ---------------------------------------------------------------------------
function Filas-Venta($tabla, $base) {
  $lista = @()
  foreach ($fila in $tabla.Rows) {
    $lista += [PSCustomObject]@{
      companyCode = [int]$fila["CodigoEmpresa"]
      basis       = $base
      day         = ([datetime]$fila["Dia"]).ToString("yyyy-MM-dd")
      series      = [string]$fila["Serie"]
      repCode     = $(if ($fila["Comercial"] -eq [DBNull]::Value) { $null } else { [int]$fila["Comercial"] })
      documents   = [int]$fila["Documentos"]
      netAmount   = [double]$fila["Neto"]
      costAmount  = [double]$fila["Coste"]
      vatAmount   = [double]$fila["Iva"]
      netWithoutCost = [double]$fila["NetoSinCoste"]
    }
  }
  return $lista
}

$ventas = @()
$ventas += Filas-Venta $porAlbaran "albaran"
$ventas += Filas-Venta $porFactura "factura"

$sociedades = @()
foreach ($fila in $empresas.Rows) {
  $sociedades += [PSCustomObject]@{ code = [int]$fila["CodigoEmpresa"]; name = [string]$fila["Empresa"]; isActive = $true }
}

$vendedores = @()
foreach ($fila in $comerciales.Rows) {
  $nombre = [string]$fila["Nombre"]
  # "GENERAL" y las altas automáticas no son personas: el panel las enseña como
  # ventas sin comercial asignado.
  $esPersona = -not ($nombre -match "GENERAL|AUTOM|NO ASIG|SAT ")
  $vendedores += [PSCustomObject]@{
    companyCode = [int]$fila["CodigoEmpresa"]
    code        = [int]$fila["CodigoComisionista"]
    name        = $nombre
    isPerson    = $esPersona
  }
}

$envio = [PSCustomObject]@{
  coveredFrom = $desde
  coveredTo   = (Get-Date).ToString("yyyy-MM-dd")
  companies   = $sociedades
  reps        = $vendedores
  sales       = $ventas
}

if ($SoloProbar) {
  $muestra = Join-Path (Split-Path -Parent $Registro) "agente-sage-muestra.json"
  $envio | ConvertTo-Json -Depth 6 | Set-Content -Path $muestra -Encoding UTF8
  Apuntar "prueba: no se ha enviado nada. Lo que se mandaria esta en $muestra"
  exit 0
}

# ---------------------------------------------------------------------------
# Enviar
# ---------------------------------------------------------------------------
try {
  $json = $envio | ConvertTo-Json -Depth 6 -Compress
  # El cuerpo va como UTF-8 explícito: con acentos, dejarlo al azar rompe los
  # nombres de las sociedades.
  $cuerpo = [System.Text.Encoding]::UTF8.GetBytes($json)
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $respuesta = Invoke-RestMethod -Uri $Destino -Method Post -Body $cuerpo `
    -ContentType "application/json; charset=utf-8" `
    -Headers @{ Authorization = "Bearer $Token" } `
    -TimeoutSec 180
  Apuntar "enviado correctamente: $($respuesta.rowsWritten) filas guardadas"
} catch {
  Apuntar "ERROR al enviar: $($_.Exception.Message)"
  if ($_.ErrorDetails -and $_.ErrorDetails.Message) { Apuntar "respuesta: $($_.ErrorDetails.Message)" }
  exit 1
}
