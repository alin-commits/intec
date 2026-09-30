<#
  AGENTE DE SAGE → COMMERCIAL HUB
  ===============================

  Lee Sage y envía al Hub lo que necesita el cuadro de mando comercial.
  Pensado para correr en el propio servidor de Sage como tarea programada.

  Qué envía:
    - ventas por sociedad, día, serie y comercial (con líneas por albarán);
    - ofertas y pedidos: totales por día y, además, uno a uno con su estado,
      motivo de rechazo, fechas y el enlace oferta → pedido → albarán;
    - venta por familia, subfamilia y artículo (con marca);
    - clientes con nombre y contacto, y lo que compra cada uno (por día y por
      familia). Dirección decidió traerlos para que las listas de clientes a
      recuperar sirvan para actuar;
    - abonos e incidencias de los albaranes;
    - la cartera de pedidos pendientes y cuántos clientes han dejado de comprar;
    - las tablas de códigos de Sage (motivos, tipos de cliente...) y la
      estructura de las tablas que interesan (solo nombres de columnas).
  NO envía cobros, ni precios de compra, ni documentos completos.

  Qué NO hace: escribir en Sage. Todas las consultas son de solo lectura.

  Si alguna tabla o columna no existe en esta instalación de Sage, esa parte se
  salta, queda apuntado por qué, y el resto sigue llegando igual.

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

  La tarea de la noche repasa los últimos 90 días (y las ofertas y pedidos del
  último año, que cambian de estado aunque sean viejos). La de cada hora solo
  mira hoy y ayer, que es barato.

  5. El botón "Actualizar desde Sage" del panel. El Hub no puede entrar en este
     servidor, así que es el agente quien pregunta cada minuto si alguien lo ha
     pulsado. Si no, termina en un momento sin tocar Sage:

       schtasks /Create /TN "Intec - Sage a peticion" /SC MINUTE /MO 1 /RU SYSTEM ^
         /TR "powershell -ExecutionPolicy Bypass -WindowStyle Hidden -File C:\intec\agente-sage.ps1 -Vigilar"

  Dos lecturas nunca van a la vez: si coinciden, la segunda espera su turno.

  ---------------------------------------------------------------------------
  ACTUALIZAR UNA VERSIÓN ANTERIOR
  ---------------------------------------------------------------------------
  Basta con sustituir el archivo: las tareas programadas siguen igual. Para
  traer también el histórico de los datos nuevos, lanzarlo una vez a mano:

       powershell -ExecutionPolicy Bypass -File C:\intec\agente-sage.ps1 -Dias 1500

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
  # Cuántos días van en cada envío. Con años de histórico, mandarlo todo junto
  # no cabe ni en la ruta ni en el tamaño máximo del servidor.
  [int]$DiasPorEnvio = 45,
  # Hasta dónde se repasan ofertas y pedidos en la lectura de la noche: una
  # oferta de hace meses puede ganarse o perderse hoy.
  [int]$DiasDocumentos = 365,
  [string]$Destino = "https://app.suministrointec.com/api/sage/ingest",
  [string]$Token = $env:INTEC_SAGE_TOKEN,
  [string]$Registro = "",
  [switch]$SoloProbar,
  # Manda también la estructura y las tablas de códigos aunque sea una lectura corta.
  [switch]$Reconocer,
  # Por si algo de lo nuevo diera guerra: solo ventas, como la primera versión.
  [switch]$SoloVentas,
  # Para la tarea de cada minuto: lee Sage solo si alguien ha pulsado el botón.
  [switch]$Vigilar
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Data

# Lo mismo que en el script de alta: una variable recién puesta con setx no
# existe en la consola donde se escribió. Se lee de donde quedó guardada.
if ([string]::IsNullOrWhiteSpace($Token)) { $Token = [Environment]::GetEnvironmentVariable("INTEC_SAGE_TOKEN", "Machine") }
if ([string]::IsNullOrWhiteSpace($Usuario)) { $Usuario = [Environment]::GetEnvironmentVariable("INTEC_SAGE_DB_USER", "Machine") }
if ([string]::IsNullOrWhiteSpace($Clave)) { $Clave = [Environment]::GetEnvironmentVariable("INTEC_SAGE_DB_PASSWORD", "Machine") }

# Con qué se entra en Sage, apartado en variables de solo lectura que nada más
# usa. En PowerShell $clave y $Clave son la misma variable: el 29/09/2026 una
# función la tapó y el 30/09 un $clave del script la pisó (las remesas de pagos
# la usaban para agrupar), y todo lo que venía detrás daba "Error de inicio de
# sesión". Así, si algo vuelve a llamarse igual, no cambia la contraseña.
New-Variable -Name SageConexionUsuario -Value $Usuario -Option ReadOnly -Scope Script
New-Variable -Name SageConexionClave -Value $Clave -Option ReadOnly -Scope Script
New-Variable -Name SageConexionBase -Value $BaseDeDatos -Option ReadOnly -Scope Script

if ($Registro -eq "") {
  $Registro = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "agente-sage.log"
}

function Apuntar($texto) {
  $linea = "{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $texto
  Write-Host $linea
  try { Add-Content -Path $Registro -Value $linea -Encoding UTF8 } catch { }
}

# Qué versión del agente es. Sale en el registro y en el envío de pagos de la
# lectura larga, para saber desde el Hub qué copia hay en el servidor. Se cambia
# cada vez que se manda una versión nueva al servidor.
$VersionAgente = "2026-09-30 administracion"

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
  # Usuario, clave y base salen de las copias de solo lectura del principio, no
  # de $Usuario y $Clave: cualquier $clave de por medio se colaría como contraseña.
  $cadena = "Server=$servidor;Database=$($script:SageConexionBase);Connect Timeout=10;Application Name=Agente Intec;"
  # Si no hay usuario configurado se entra con la cuenta de Windows que ejecuta
  # la tarea. Ojo: $env: devuelve nulo cuando la variable no existe, no cadena
  # vacía, así que hay que comprobarlo así y no con -ne "".
  if (-not [string]::IsNullOrWhiteSpace($script:SageConexionUsuario)) { return $cadena + "User ID=$($script:SageConexionUsuario);Password=$($script:SageConexionClave);" }
  return $cadena + "Integrated Security=SSPI;"
}

function Consultar($servidor, $sql) {
  $conexion = New-Object System.Data.SqlClient.SqlConnection (Nueva-Cadena $servidor)
  try {
    $conexion.Open()
    # Sage se usa a la vez que se lee: en horario de oficina hay quien graba
    # y factura, y eso bloquea filas. Leyendo sin bloqueos, el agente no espera
    # a nadie ni hace esperar a nadie (el 29/09 se quedó parado minutos en un
    # mes). Si algo se leyera a medio grabar, la lectura siguiente lo corrige.
    # Y si aun así algo le obliga a esperar más de un minuto, esa consulta
    # falla, se apunta como aviso y el resto sigue.
    $ajustes = $conexion.CreateCommand()
    $ajustes.CommandText = "SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED; SET LOCK_TIMEOUT 60000;"
    [void]$ajustes.ExecuteNonQuery()
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

# Un valor de SQL que puede venir vacío (DBNull) pasado a número, texto, fecha o nulo.
function Entero-O-Nulo($valor) {
  if ($valor -eq [DBNull]::Value -or $null -eq $valor) { return $null }
  return [int]$valor
}
function Numero($valor) {
  if ($valor -eq [DBNull]::Value -or $null -eq $valor) { return [double]0 }
  return [double]$valor
}
# Para los importes que esta instalación puede no tener (bruto, comisión...):
# nulo le dice al Hub "no se leyó", que no es lo mismo que cero.
function Numero-O-Nulo($valor) {
  if ($valor -eq [DBNull]::Value -or $null -eq $valor) { return $null }
  return [double]$valor
}
function Texto($valor, [int]$maximo) {
  if ($valor -eq [DBNull]::Value -or $null -eq $valor) { return "" }
  $limpio = ([string]$valor).Trim()
  if ($limpio.Length -gt $maximo) { $limpio = $limpio.Substring(0, $maximo) }
  return $limpio
}
function Texto-O-Nulo($valor, [int]$maximo) {
  $limpio = Texto $valor $maximo
  if ($limpio -eq "") { return $null }
  return $limpio
}
function Fecha-O-Nulo($valor) {
  if ($valor -eq [DBNull]::Value -or $null -eq $valor) { return $null }
  $fecha = [datetime]$valor
  # Sage usa fechas de relleno (1900, 9999) cuando no hay fecha.
  if ($fecha.Year -lt 1990 -or $fecha.Year -gt 2100) { return $null }
  return $fecha.ToString("yyyy-MM-dd")
}

# ---------------------------------------------------------------------------
# Turno, petición del botón y salida
# ---------------------------------------------------------------------------
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

if (-not $SoloProbar -and [string]::IsNullOrWhiteSpace($Token)) {
  Apuntar "ERROR: falta la clave. Ponla con:  setx /M INTEC_SAGE_TOKEN ""...""  y vuelve a abrir la consola."
  exit 1
}

# Las rutas del botón cuelgan de la misma dirección que la de los envíos.
$raizHub = $Destino -replace "/api/sage/ingest/?$", ""
$urlRecoger = "$raizHub/api/sage/refresh/claim"
$urlTerminar = "$raizHub/api/sage/refresh/finish"
$script:peticion = $null

# Dos lecturas a la vez leerían Sage dos veces y se pisarían los envíos: cada
# ejecución espera su turno. La de cada minuto no espera: si hay otra en marcha,
# lo deja para el minuto siguiente (la petición sigue pendiente).
$turno = New-Object System.Threading.Mutex($false, "Global\IntecAgenteSage")
$tengoTurno = $false
try { $tengoTurno = $turno.WaitOne($(if ($Vigilar) { 0 } else { 40 * 60 * 1000 })) }
catch [System.Threading.AbandonedMutexException] { $tengoTurno = $true }
if (-not $tengoTurno) {
  if (-not $Vigilar) { Apuntar "otra lectura lleva 40 minutos en marcha: esta se salta" }
  exit 0
}

# Termina avisando al panel si la lectura se pidió con el botón, y soltando el turno.
function Terminar([int]$codigo, [string]$mensaje) {
  if ($script:peticion) {
    try {
      $aviso = @{ id = $script:peticion; ok = ($codigo -eq 0); message = $mensaje } | ConvertTo-Json -Compress
      [void](Invoke-RestMethod -Uri $urlTerminar -Method Post -Body ([System.Text.Encoding]::UTF8.GetBytes($aviso)) `
        -ContentType "application/json; charset=utf-8" -Headers @{ Authorization = "Bearer $Token" } -TimeoutSec 60)
    } catch { Apuntar "no se pudo avisar al panel del final de la lectura: $($_.Exception.Message)" }
  }
  try { $turno.ReleaseMutex() } catch { }
  exit $codigo
}

# Cualquier error no previsto termina igual: avisando y soltando el turno.
trap {
  Apuntar "ERROR: $($_.Exception.Message)"
  Terminar 1 "Error leyendo Sage: $($_.Exception.Message)"
}

if ($Vigilar) {
  $pedido = $null
  try {
    $pedido = (Invoke-RestMethod -Uri $urlRecoger -Method Post -Body "{}" -ContentType "application/json" `
      -Headers @{ Authorization = "Bearer $Token" } -TimeoutSec 30).request
  } catch {
    Apuntar "no se pudo preguntar al Hub si hay lecturas pedidas: $($_.Exception.Message)"
    Terminar 1 ""
  }
  # Lo normal: nadie ha pulsado. Se sale sin tocar Sage ni escribir en el registro.
  if (-not $pedido) { Terminar 0 "" }
  $script:peticion = [string]$pedido.id
  $Dias = [int]$pedido.days
  Apuntar "lectura pedida desde el panel"
}

Apuntar "----- arranque: ultimos $Dias dias (agente $VersionAgente) -----"

$candidatos = @()
if ($Servidor -ne "") { $candidatos = @($Servidor) } else { $candidatos = Buscar-Instancias }
$servidorBueno = ""
foreach ($candidato in $candidatos) {
  try { [void](Consultar $candidato "select 1"); $servidorBueno = $candidato; break } catch { }
}
if ($servidorBueno -eq "") {
  Apuntar "ERROR: no se pudo conectar a SQL Server. Prueba con -Servidor ""NOMBRE\INSTANCIA""."
  Terminar 1 "No se pudo conectar con la base de datos de Sage."
}
Apuntar "conectado a $servidorBueno"

$excluidas = $EmpresasExcluidas -join ", "

# ---------------------------------------------------------------------------
# Antes de leer una tabla se mira qué columnas tiene: cada instalación de Sage
# nombra alguna a su manera. Lo que no está se salta, se apunta el porqué
# (llega al Hub como aviso) y el resto no se entera.
# ---------------------------------------------------------------------------
$avisosDeArranque = New-Object System.Collections.Generic.List[string]
function Avisar($lista, $texto) {
  Apuntar "  aviso: $texto"
  if ($lista.Count -lt 30) { $lista.Add($(if ($texto.Length -gt 300) { $texto.Substring(0, 300) } else { $texto })) }
}

$cacheColumnas = @{}
function Columnas($tabla) {
  if (-not $cacheColumnas.ContainsKey($tabla)) {
    $conjunto = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
    $filas = Consultar $servidorBueno "select c.name from sys.columns c join sys.tables t on t.object_id = c.object_id where t.name = '$tabla';"
    foreach ($f in $filas.Rows) { [void]$conjunto.Add([string]$f["name"]) }
    $cacheColumnas[$tabla] = $conjunto
  }
  return ,$cacheColumnas[$tabla]
}
function Elegir($tabla, [string[]]$candidatas) {
  $cols = Columnas $tabla
  foreach ($c in $candidatas) { if ($cols.Contains($c)) { return $c } }
  return $null
}
function Faltan($tabla, [string[]]$necesarias) {
  $cols = Columnas $tabla
  if ($cols.Count -eq 0) { return @("(no existe la tabla $tabla)") }
  return @($necesarias | Where-Object { -not $cols.Contains($_) })
}
function Tiene($tabla, $columna) { return (Columnas $tabla).Contains($columna) }

# Trozos de SQL para una columna que puede no existir: si falta, sale un nulo
# del tipo correcto y la consulta sigue valiendo.
function Sql-Texto($alias, $columna, [int]$largo) {
  if ($columna) { return "nullif(ltrim(rtrim(cast($alias.[$columna] as nvarchar($largo)))), '')" }
  return "cast(null as nvarchar($largo))"
}
function Sql-Fecha($alias, $columna) {
  if ($columna) { return "cast($alias.[$columna] as date)" }
  return "cast(null as date)"
}
function Sql-Comercial($alias, $columna) {
  if ($columna) { return "case when $alias.[$columna] in (0, 9999) then null else $alias.[$columna] end" }
  return "cast(null as int)"
}
function Sql-Numero($alias, $columna) {
  if ($columna) { return "isnull($alias.[$columna], 0)" }
  return "0"
}
function Sql-Entre($expresion, $desde, $hasta) {
  return "$expresion >= convert(datetime, '$desde', 112) and $expresion < convert(datetime, '$hasta', 112)"
}

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

# Para el director comercial: quién es jefe de ventas, de quién depende cada uno
# y quién ya no está. Son columnas de Sage que no todas las instalaciones tienen.
$expJefe = if (Tiene "Comisionistas" "IndicadorJefeVenta_") { "isnull(IndicadorJefeVenta_, 0)" } else { "0" }
$expSuJefe = if (Tiene "Comisionistas" "CodigoJefeVenta_") { "CodigoJefeVenta_" } else { "cast(null as int)" }
$expFechaBaja = if (Tiene "Comisionistas" "FechaBajaLc") { "FechaBajaLc" } else { "cast(null as datetime)" }
$expBaja = if (Tiene "Comisionistas" "BajaEmpresaLc") { "isnull(BajaEmpresaLc, 0)" } else { "0" }
$comerciales = Consultar $servidorBueno @"
select CodigoEmpresa, CodigoComisionista, $expresionNombre as Nombre,
  $expJefe as Jefe, $expSuJefe as SuJefe, $expFechaBaja as FechaBaja, $expBaja as Baja
from Comisionistas
where CodigoEmpresa not in ($excluidas);
"@

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
  # En Sage el sí es -1. La baja puede estar marcada, fechada o las dos cosas; con
  # fecha futura todavía está.
  $fechaBaja = Fecha-O-Nulo $fila["FechaBaja"]
  $deBaja = ((Numero $fila["Baja"]) -ne 0) -or ($fechaBaja -and $fechaBaja -le (Get-Date).ToString("yyyy-MM-dd"))
  $suJefe = Entero-O-Nulo $fila["SuJefe"]
  if ($suJefe -in @(0, 9999)) { $suJefe = $null }
  $vendedores += [PSCustomObject]@{
    companyCode = [int]$fila["CodigoEmpresa"]
    code        = [int]$fila["CodigoComisionista"]
    name        = $nombre
    isPerson    = $esPersona
    isManager   = ((Numero $fila["Jefe"]) -ne 0)
    managerCode = $suJefe
    isActive    = (-not $deBaja)
    leftOn      = $fechaBaja
  }
}

# ---------------------------------------------------------------------------
# Las ventas. Dos maneras de fechar la misma venta: cuándo se sirvió y cuándo se
# facturó. Se mandan las dos y el panel enseña la que haga falta.
#
# Las devoluciones vienen en negativo y se suman tal cual, que es lo correcto:
# restan de la venta del día.
# ---------------------------------------------------------------------------
$expLineasAlbaran = if (Tiene "CabeceraAlbaranCliente" "NumeroLineas") { "isnull(a.NumeroLineas, 0)" } else { "0" }
# Para el director comercial, de la cabecera del albarán: el bruto antes de
# descuentos, el descuento de las líneas (el que pone el comercial; el resto
# hasta el neto son el descuento de la ficha del cliente y el pronto pago), el
# rappel y la comisión que calcula Sage para el comercial del albarán. Si la
# columna no existe va nulo: el Hub lo toma como "no se leyó", no como cero.
function Sql-SumaCabecera($columna) {
  if (Tiene "CabeceraAlbaranCliente" $columna) { return "sum(isnull(a.[$columna], 0))" }
  return "cast(null as decimal(14, 2))"
}
$expBruto = Sql-SumaCabecera "ImporteBruto"
$expDescuentoLineas = Sql-SumaCabecera "ImporteDescuentoLineas"
$expRappel = Sql-SumaCabecera "ImporteRappel"
$expComision = Sql-SumaCabecera "ImporteComision"

function Sql-Ventas($campoFecha, $filtro, $desdeBloque, $hastaBloque) {
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
  sum(case when isnull(a.ImporteCoste, 0) = 0 then isnull(a.BaseImponible, 0) else 0 end) as NetoSinCoste,
  sum($expLineasAlbaran)                       as Lineas,
  $expBruto                                    as Bruto,
  $expDescuentoLineas                          as DescuentoLineas,
  $expRappel                                   as Rappel,
  $expComision                                 as Comision
from CabeceraAlbaranCliente a
where a.$campoFecha >= convert(datetime, '$desdeBloque', 112) and a.$campoFecha < convert(datetime, '$hastaBloque', 112)
  and a.CodigoEmpresa not in ($excluidas)
  $filtro
group by
  a.CodigoEmpresa,
  cast(a.$campoFecha as date),
  isnull(ltrim(rtrim(a.SerieAlbaran)), ''),
  case when a.CodigoComisionista in (0, 9999) then null else a.CodigoComisionista end;
"@
}

function Filas-Venta($tabla, $base) {
  $lista = New-Object System.Collections.Generic.List[object]
  foreach ($fila in $tabla.Rows) {
    $lista.Add([PSCustomObject]@{
      companyCode = [int]$fila["CodigoEmpresa"]
      basis       = $base
      day         = ([datetime]$fila["Dia"]).ToString("yyyy-MM-dd")
      series      = [string]$fila["Serie"]
      repCode     = (Entero-O-Nulo $fila["Comercial"])
      documents   = [int]$fila["Documentos"]
      netAmount   = [double]$fila["Neto"]
      costAmount  = [double]$fila["Coste"]
      vatAmount   = [double]$fila["Iva"]
      netWithoutCost = [double]$fila["NetoSinCoste"]
      lines       = [int]$fila["Lineas"]
      grossAmount = (Numero-O-Nulo $fila["Bruto"])
      lineDiscountAmount = (Numero-O-Nulo $fila["DescuentoLineas"])
      rappelAmount = (Numero-O-Nulo $fila["Rappel"])
      commissionAmount = (Numero-O-Nulo $fila["Comision"])
    })
  }
  # La coma evita que PowerShell desenrolle la lista: una lista vacía llegaría
  # como nada y una de un elemento, como un objeto suelto.
  return ,$lista
}

# --- Ofertas y pedidos: cabeceras, totales por día, serie y comercial -------
function Preparar-Documentos($nombre, $tabla, $fecha, [string[]]$series) {
  $faltan = Faltan $tabla @("CodigoEmpresa", $fecha)
  if ($faltan.Count -gt 0) { Avisar $avisosDeArranque "${nombre}: faltan $($faltan -join ', ')"; return $null }
  $importe = Elegir $tabla @("BaseImponible", "ImporteNeto", "ImporteLiquido")
  if (-not $importe) { Avisar $avisosDeArranque "${nombre}: no hay columna de importe en $tabla"; return $null }
  return @{ Tabla = $tabla; Fecha = $fecha; Serie = (Elegir $tabla $series); Comercial = (Elegir $tabla @("CodigoComisionista")); Importe = $importe }
}

function Sql-Documentos($cfg, $desdeBloque, $hastaBloque) {
  $fecha = "d.[$($cfg.Fecha)]"
  $grupos = @("d.CodigoEmpresa", "cast($fecha as date)")
  $serie = "''"
  $comercial = "cast(null as int)"
  if ($cfg.Serie) { $serie = "isnull(ltrim(rtrim(d.[$($cfg.Serie)])), '')"; $grupos += $serie }
  if ($cfg.Comercial) { $comercial = "case when d.[$($cfg.Comercial)] in (0, 9999) then null else d.[$($cfg.Comercial)] end"; $grupos += $comercial }
  return @"
select d.CodigoEmpresa, cast($fecha as date) as Dia, $serie as Serie, $comercial as Comercial,
  count(*) as Documentos, sum(isnull(d.[$($cfg.Importe)], 0)) as Neto
from [$($cfg.Tabla)] d
where $fecha >= convert(datetime, '$desdeBloque', 112) and $fecha < convert(datetime, '$hastaBloque', 112)
  and d.CodigoEmpresa not in ($excluidas)
group by $($grupos -join ", ");
"@
}

function Filas-Documentos($tabla) {
  $lista = New-Object System.Collections.Generic.List[object]
  foreach ($fila in $tabla.Rows) {
    $lista.Add([PSCustomObject]@{
      companyCode = [int]$fila["CodigoEmpresa"]
      day         = ([datetime]$fila["Dia"]).ToString("yyyy-MM-dd")
      series      = (Texto $fila["Serie"] 20)
      repCode     = (Entero-O-Nulo $fila["Comercial"])
      documents   = [int]$fila["Documentos"]
      netAmount   = (Numero $fila["Neto"])
    })
  }
  return ,$lista
}

# --- Venta por familia: líneas de albarán, fechadas por su cabecera ---------
function Preparar-Familias {
  $claves = @("CodigoEmpresa", "EjercicioAlbaran", "SerieAlbaran", "NumeroAlbaran")
  $faltan = @(Faltan "LineasAlbaranCliente" $claves) + @(Faltan "CabeceraAlbaranCliente" ($claves + @("FechaAlbaran")))
  if ($faltan.Count -gt 0) { Avisar $avisosDeArranque "familias: faltan $($faltan -join ', ')"; return $null }
  $importe = Elegir "LineasAlbaranCliente" @("BaseImponible", "ImporteNeto", "ImporteLiquido")
  if (-not $importe) { Avisar $avisosDeArranque "familias: no hay columna de importe en LineasAlbaranCliente"; return $null }

  # La familia puede estar en la propia línea o solo en el artículo.
  $familia = $null
  $subfamilia = "''"
  $unirArticulos = ""
  $conArticulo = Tiene "LineasAlbaranCliente" "CodigoArticulo"
  if (Tiene "LineasAlbaranCliente" "CodigoFamilia") {
    $familia = "l.[CodigoFamilia]"
    if (Tiene "LineasAlbaranCliente" "CodigoSubfamilia") { $subfamilia = "l.[CodigoSubfamilia]" }
  } elseif ($conArticulo -and (@(Faltan "Articulos" @("CodigoEmpresa", "CodigoArticulo", "CodigoFamilia")).Count -eq 0)) {
    $familia = "ar.[CodigoFamilia]"
    if (Tiene "Articulos" "CodigoSubfamilia") { $subfamilia = "ar.[CodigoSubfamilia]" }
    $unirArticulos = "left join Articulos ar on ar.CodigoEmpresa = l.CodigoEmpresa and ar.CodigoArticulo = l.CodigoArticulo"
  } else {
    Avisar $avisosDeArranque "familias: no se encuentra CodigoFamilia ni en las lineas ni en Articulos"
    return $null
  }

  $unidades = Elegir "LineasAlbaranCliente" @("Unidades", "UnidadesServidas")
  $expUnidades = if ($unidades) { "l.[$unidades]" } else { "0" }
  $expCoste = "0"
  if (Tiene "LineasAlbaranCliente" "ImporteCoste") { $expCoste = "l.[ImporteCoste]" }
  elseif ($unidades -and (Tiene "LineasAlbaranCliente" "PrecioCoste")) { $expCoste = "l.[PrecioCoste] * l.[$unidades]" }
  else { Avisar $avisosDeArranque "familias: las lineas no traen coste; se envia la venta sin margen" }

  # El bruto de la línea, antes de descuentos: con el neto da el descuento por
  # familia, artículo y cliente.
  $bruto = $null
  if (Tiene "LineasAlbaranCliente" "ImporteBruto") { $bruto = "l.[ImporteBruto]" }

  return @{
    Importe = $importe; Familia = $familia; Subfamilia = $subfamilia; Unir = $unirArticulos
    Unidades = $expUnidades; Coste = $expCoste; ConArticulo = $conArticulo; Bruto = $bruto
  }
}

function Sql-BrutoLineas($cfg) {
  if ($cfg.Bruto) { return "sum(isnull($($cfg.Bruto), 0))" }
  return "cast(null as decimal(14, 2))"
}

# Lo que se repite en todas las consultas de líneas: la unión con su cabecera.
function Sql-UnirLineas($cfg) {
  return @"
from LineasAlbaranCliente l
join CabeceraAlbaranCliente a
  on a.CodigoEmpresa = l.CodigoEmpresa and a.EjercicioAlbaran = l.EjercicioAlbaran
 and a.SerieAlbaran = l.SerieAlbaran and a.NumeroAlbaran = l.NumeroAlbaran
$($cfg.Unir)
"@
}

function Sql-Familias($cfg, $desdeBloque, $hastaBloque) {
  $codigo = "isnull(ltrim(rtrim(cast($($cfg.Familia) as nvarchar(40)))), '')"
  return @"
select a.CodigoEmpresa, cast(a.FechaAlbaran as date) as Dia, $codigo as Familia,
  sum(isnull($($cfg.Unidades), 0)) as Unidades,
  sum(isnull(l.[$($cfg.Importe)], 0)) as Neto,
  sum(isnull($($cfg.Coste), 0)) as Coste,
  -- Lo vendido sin coste grabado: el margen de la familia lo deja fuera.
  sum(case when isnull($($cfg.Coste), 0) = 0 then isnull(l.[$($cfg.Importe)], 0) else 0 end) as NetoSinCoste,
  $(Sql-BrutoLineas $cfg) as Bruto
$(Sql-UnirLineas $cfg)
where $(Sql-Entre "a.FechaAlbaran" $desdeBloque $hastaBloque)
  and a.CodigoEmpresa not in ($excluidas)
group by a.CodigoEmpresa, cast(a.FechaAlbaran as date), $codigo;
"@
}

function Filas-Familias($tabla) {
  $lista = New-Object System.Collections.Generic.List[object]
  foreach ($fila in $tabla.Rows) {
    $lista.Add([PSCustomObject]@{
      companyCode = [int]$fila["CodigoEmpresa"]
      day         = ([datetime]$fila["Dia"]).ToString("yyyy-MM-dd")
      familyCode  = (Texto $fila["Familia"] 40)
      units       = (Numero $fila["Unidades"])
      netAmount   = (Numero $fila["Neto"])
      costAmount  = (Numero $fila["Coste"])
      netWithoutCost = (Numero $fila["NetoSinCoste"])
      grossAmount = (Numero-O-Nulo $fila["Bruto"])
    })
  }
  return ,$lista
}

# Los nombres de las familias y de las subfamilias. En Sage van en la misma
# tabla: la fila de la familia es la que no tiene subfamilia.
function Leer-NombresFamilia($subfamilias) {
  $faltan = Faltan "Familias" @("CodigoEmpresa", "CodigoFamilia")
  if ($faltan.Count -gt 0) { Avisar $avisosDeArranque "nombres de familia: faltan $($faltan -join ', ')"; return $null }
  $descripcion = Elegir "Familias" @("Descripcion", "DescripcionFamilia", "Familia", "Nombre")
  if (-not $descripcion) { Avisar $avisosDeArranque "nombres de familia: no hay columna de descripcion"; return $null }
  $conSub = Tiene "Familias" "CodigoSubfamilia"
  if ($subfamilias -and -not $conSub) { return $null }
  $filtro = ""
  $columnaSub = ""
  $grupoSub = ""
  if ($conSub) {
    if ($subfamilias) {
      $filtro = "and isnull(ltrim(rtrim(CodigoSubfamilia)), '') not in ('', '**********')"
      $columnaSub = ", ltrim(rtrim(cast(CodigoSubfamilia as nvarchar(40)))) as Subfamilia"
      $grupoSub = ", ltrim(rtrim(cast(CodigoSubfamilia as nvarchar(40))))"
    } else {
      $filtro = "and isnull(ltrim(rtrim(CodigoSubfamilia)), '') in ('', '**********')"
    }
  }
  $tabla = Consultar $servidorBueno @"
select CodigoEmpresa, ltrim(rtrim(cast(CodigoFamilia as nvarchar(40)))) as Codigo$columnaSub,
  max(ltrim(rtrim(cast([$descripcion] as nvarchar(160))))) as Nombre
from Familias
where CodigoEmpresa not in ($excluidas) $filtro
group by CodigoEmpresa, ltrim(rtrim(cast(CodigoFamilia as nvarchar(40))))$grupoSub;
"@
  $lista = New-Object System.Collections.Generic.List[object]
  foreach ($fila in $tabla.Rows) {
    $nombre = Texto $fila["Nombre"] 160
    if ($nombre -eq "") { continue }
    if ($subfamilias) {
      $lista.Add([PSCustomObject]@{ companyCode = [int]$fila["CodigoEmpresa"]; familyCode = (Texto $fila["Codigo"] 40); code = (Texto $fila["Subfamilia"] 40); name = $nombre })
    } else {
      $lista.Add([PSCustomObject]@{ companyCode = [int]$fila["CodigoEmpresa"]; code = (Texto $fila["Codigo"] 40); name = $nombre })
    }
  }
  return ,$lista
}

# --- Artículos: venta por mes y la ficha de cada uno ------------------------
function Sql-ArticulosVenta($cfg, $mesDesde, $mesHasta) {
  $familia = "isnull(ltrim(rtrim(cast($($cfg.Familia) as nvarchar(40)))), '')"
  $articulo = "isnull(ltrim(rtrim(cast(l.[CodigoArticulo] as nvarchar(40)))), '')"
  # SQL Server no deja agrupar por un valor fijo: sin columna de subfamilia, va
  # vacía y fuera del group by.
  $subfamilia = "''"
  $grupos = @("a.CodigoEmpresa", "convert(char(7), a.FechaAlbaran, 120)", $articulo, $familia)
  if ($cfg.Subfamilia -ne "''") {
    $subfamilia = "isnull(ltrim(rtrim(cast($($cfg.Subfamilia) as nvarchar(40)))), '')"
    $grupos += $subfamilia
  }
  return @"
select a.CodigoEmpresa, convert(char(7), a.FechaAlbaran, 120) as Mes, $articulo as Articulo, $familia as Familia, $subfamilia as Subfamilia,
  sum(isnull($($cfg.Unidades), 0)) as Unidades,
  count(distinct concat(a.EjercicioAlbaran, '|', a.SerieAlbaran, '|', a.NumeroAlbaran)) as Documentos,
  sum(isnull(l.[$($cfg.Importe)], 0)) as Neto,
  sum(isnull($($cfg.Coste), 0)) as Coste,
  sum(case when isnull($($cfg.Coste), 0) = 0 then isnull(l.[$($cfg.Importe)], 0) else 0 end) as NetoSinCoste,
  $(Sql-BrutoLineas $cfg) as Bruto
$(Sql-UnirLineas $cfg)
where $(Sql-Entre "a.FechaAlbaran" $mesDesde $mesHasta)
  and a.CodigoEmpresa not in ($excluidas)
group by $($grupos -join ", ");
"@
}

function Preparar-Articulos {
  $faltan = Faltan "Articulos" @("CodigoEmpresa", "CodigoArticulo")
  if ($faltan.Count -gt 0) { Avisar $avisosDeArranque "articulos: faltan $($faltan -join ', ')"; return $null }
  return @{
    Nombre = (Elegir "Articulos" @("DescripcionArticulo", "Descripcion", "Descripcion2Articulo"))
    Familia = (Elegir "Articulos" @("CodigoFamilia"))
    Subfamilia = (Elegir "Articulos" @("CodigoSubfamilia"))
    Marca = (Elegir "Articulos" @("MarcaProducto", "Marca"))
    Proveedor = (Elegir "Articulos" @("CodigoProveedor"))
    Fabricante = (Elegir "Articulos" @("CodigoFabricanteLc", "CodigoFabricante"))
    Abc = (Elegir "Articulos" @("TipoABC"))
    Alta = (Elegir "Articulos" @("FechaAlta"))
    Obsoleto = (Elegir "Articulos" @("ObsoletoLc", "Obsoleto"))
  }
}

# Los artículos vendidos en esos meses y los dados de alta en ellos.
function Sql-ArticulosLista($cfgArt, $cfg, $mesDesde, $mesHasta) {
  $obsoleto = if ($cfgArt.Obsoleto) { "case when isnull(ar.[$($cfgArt.Obsoleto)], 0) <> 0 then 1 else 0 end" } else { "0" }
  $alta = ""
  if ($cfgArt.Alta) { $alta = "or ($(Sql-Entre "ar.[$($cfgArt.Alta)]" $mesDesde $mesHasta))" }
  # Primero los artículos vendidos en el mes, de una pasada por los albaranes de
  # ese mes, y luego su ficha. Antes se preguntaba artículo por artículo si se
  # había vendido: con el catálogo entero, diciembre de 2024 tardaba 115 s.
  return @"
with vendidos as (
  select distinct l.CodigoEmpresa, l.CodigoArticulo
  from CabeceraAlbaranCliente a
  join LineasAlbaranCliente l
    on l.CodigoEmpresa = a.CodigoEmpresa and l.EjercicioAlbaran = a.EjercicioAlbaran
   and l.SerieAlbaran = a.SerieAlbaran and l.NumeroAlbaran = a.NumeroAlbaran
  where $(Sql-Entre "a.FechaAlbaran" $mesDesde $mesHasta)
    and a.CodigoEmpresa not in ($excluidas)
)
select ar.CodigoEmpresa, ltrim(rtrim(cast(ar.CodigoArticulo as nvarchar(40)))) as Codigo,
  $(Sql-Texto "ar" $cfgArt.Nombre 200) as Nombre,
  $(Sql-Texto "ar" $cfgArt.Familia 40) as Familia,
  $(Sql-Texto "ar" $cfgArt.Subfamilia 40) as Subfamilia,
  $(Sql-Texto "ar" $cfgArt.Marca 80) as Marca,
  $(Sql-Texto "ar" $cfgArt.Proveedor 40) as Proveedor,
  $(Sql-Texto "ar" $cfgArt.Fabricante 80) as Fabricante,
  $(Sql-Texto "ar" $cfgArt.Abc 10) as Abc,
  $(Sql-Fecha "ar" $cfgArt.Alta) as Alta,
  $obsoleto as Obsoleto
from Articulos ar
left join vendidos v on v.CodigoEmpresa = ar.CodigoEmpresa and v.CodigoArticulo = ar.CodigoArticulo
where ar.CodigoEmpresa not in ($excluidas)
  and (
    v.CodigoArticulo is not null
    $alta
  );
"@
}

# --- Clientes ---------------------------------------------------------------
function Preparar-Clientes {
  $faltan = Faltan "Clientes" @("CodigoEmpresa", "CodigoCliente")
  if ($faltan.Count -gt 0) { Avisar $avisosDeArranque "ficha de clientes: faltan $($faltan -join ', ')"; return $null }
  return @{
    Razon = (Elegir "Clientes" @("RazonSocial"))
    Nombre = (Elegir "Clientes" @("Nombre"))
    Comercial = (Elegir "Clientes" @("CodigoComisionista"))
    Provincia = (Elegir "Clientes" @("Provincia"))
    Municipio = (Elegir "Clientes" @("Municipio"))
    CodigoPostal = (Elegir "Clientes" @("CodigoPostal"))
    Actividad = (Elegir "Clientes" @("Actividad", "CodigoActividadLc"))
    Tipo = (Elegir "Clientes" @("CodigoTipoClienteLc", "TipoCliente"))
    Grupo = (Elegir "Clientes" @("CodigoGrupoClienteLc"))
    Telefono = (Elegir "Clientes" @("Telefono", "Telefono2"))
    Correo = (Elegir "Clientes" @("EMail1", "Email1", "EMail2"))
    Alta = (Elegir "Clientes" @("FechaAlta"))
    UltimaAccion = (Elegir "Clientes" @("FechaUltimaAccionLc"))
    MotivoBaja = (Elegir "Clientes" @("CodigoMotivoBajaClienteLc"))
    Baja = (Elegir "Clientes" @("FechaBajaLc"))
    # Para ver la venta por zona, canal, sector y forma de pago. Van los códigos;
    # los nombres llegan con las tablas de códigos.
    Zona = (Elegir "Clientes" @("CodigoZona"))
    Canal = (Elegir "Clientes" @("CodigoCanal"))
    Sector = (Elegir "Clientes" @("CodigoSector_", "CodigoSector"))
    FormaPago = (Elegir "Clientes" @("FormadePago", "CodigoFormaPago"))
    # Para Administración: el límite de riesgo y si tiene bloqueados albaranes o pedidos.
    Riesgo = (Elegir "Clientes" @("RiesgoMaximo"))
    BloqueoAlbaran = (Elegir "Clientes" @("BloqueoAlbaran"))
    BloqueoPedido = (Elegir "Clientes" @("BloqueoPedido"))
  }
}

# Los clientes que compran en esos meses, los que piden ofertas o pedidos en
# ellos y los dados de alta en ellos. Los demás no cambian nada en el panel.
function Sql-ClientesLista($cfgCli, $mesDesde, $mesHasta) {
  $otros = ""
  if ($cfgOfertas) {
    $otros += " or exists (select 1 from CabeceraOfertaCliente o where o.CodigoEmpresa = c.CodigoEmpresa and o.CodigoCliente = c.CodigoCliente and $(Sql-Entre "o.FechaOferta" $mesDesde $mesHasta))"
  }
  if ($cfgPedidos) {
    $otros += " or exists (select 1 from CabeceraPedidoCliente p where p.CodigoEmpresa = c.CodigoEmpresa and p.CodigoCliente = c.CodigoCliente and $(Sql-Entre "p.FechaPedido" $mesDesde $mesHasta))"
  }
  if ($cfgCli.Alta) { $otros += " or ($(Sql-Entre "c.[$($cfgCli.Alta)]" $mesDesde $mesHasta))" }
  # Bloqueado si no se le pueden hacer albaranes o pedidos (en Sage el sí es -1).
  $marcas = @()
  foreach ($columna in @($cfgCli.BloqueoAlbaran, $cfgCli.BloqueoPedido)) { if ($columna) { $marcas += "isnull(c.[$columna], 0) <> 0" } }
  $bloqueo = if ($marcas.Count -gt 0) { "case when $($marcas -join ' or ') then 1 else 0 end" } else { "0" }
  return @"
select c.CodigoEmpresa, ltrim(rtrim(cast(c.CodigoCliente as nvarchar(40)))) as Codigo,
  $(Sql-Texto "c" $cfgCli.Razon 200) as Razon,
  $(Sql-Texto "c" $cfgCli.Nombre 200) as Nombre,
  $(Sql-Comercial "c" $cfgCli.Comercial) as Comercial,
  $(Sql-Texto "c" $cfgCli.Provincia 80) as Provincia,
  $(Sql-Texto "c" $cfgCli.Municipio 80) as Municipio,
  $(Sql-Texto "c" $cfgCli.CodigoPostal 20) as CodigoPostal,
  $(Sql-Texto "c" $cfgCli.Actividad 120) as Actividad,
  $(Sql-Texto "c" $cfgCli.Tipo 40) as Tipo,
  $(Sql-Texto "c" $cfgCli.Grupo 40) as Grupo,
  $(Sql-Texto "c" $cfgCli.Telefono 40) as Telefono,
  $(Sql-Texto "c" $cfgCli.Correo 160) as Correo,
  $(Sql-Fecha "c" $cfgCli.Alta) as Alta,
  $(Sql-Fecha "c" $cfgCli.UltimaAccion) as UltimaAccion,
  $(Sql-Texto "c" $cfgCli.MotivoBaja 80) as MotivoBaja,
  $(Sql-Fecha "c" $cfgCli.Baja) as Baja,
  $(Sql-Texto "c" $cfgCli.Zona 40) as Zona,
  $(Sql-Texto "c" $cfgCli.Canal 40) as Canal,
  $(Sql-Texto "c" $cfgCli.Sector 40) as Sector,
  $(Sql-Texto "c" $cfgCli.FormaPago 40) as FormaPago,
  $(if ($cfgCli.Riesgo) { "c.[$($cfgCli.Riesgo)]" } else { "cast(null as decimal(14, 2))" }) as Riesgo,
  $bloqueo as Bloqueado
from Clientes c
where c.CodigoEmpresa not in ($excluidas)
  and (
    exists (select 1 from CabeceraAlbaranCliente a where a.CodigoEmpresa = c.CodigoEmpresa and a.CodigoCliente = c.CodigoCliente and $(Sql-Entre "a.FechaAlbaran" $mesDesde $mesHasta))
    $otros
  );
"@
}

function Filas-ClientesLista($tabla) {
  $lista = New-Object System.Collections.Generic.List[object]
  foreach ($fila in $tabla.Rows) {
    $codigo = Texto $fila["Codigo"] 40
    if ($codigo -eq "") { continue }
    $razon = Texto-O-Nulo $fila["Razon"] 200
    $comercialNombre = Texto-O-Nulo $fila["Nombre"] 200
    $nombre = if ($razon) { $razon } elseif ($comercialNombre) { $comercialNombre } else { "Cliente $codigo" }
    $lista.Add([PSCustomObject]@{
      companyCode   = [int]$fila["CodigoEmpresa"]
      code          = $codigo
      name          = $nombre
      tradeName     = $(if ($comercialNombre -and $comercialNombre -ne $nombre) { $comercialNombre } else { $null })
      repCode       = (Entero-O-Nulo $fila["Comercial"])
      province      = (Texto-O-Nulo $fila["Provincia"] 80)
      municipality  = (Texto-O-Nulo $fila["Municipio"] 80)
      postalCode    = (Texto-O-Nulo $fila["CodigoPostal"] 20)
      activity      = (Texto-O-Nulo $fila["Actividad"] 120)
      customerType  = (Texto-O-Nulo $fila["Tipo"] 40)
      customerGroup = (Texto-O-Nulo $fila["Grupo"] 40)
      phone         = (Texto-O-Nulo $fila["Telefono"] 40)
      email         = (Texto-O-Nulo $fila["Correo"] 160)
      createdOn     = (Fecha-O-Nulo $fila["Alta"])
      lastActionOn  = (Fecha-O-Nulo $fila["UltimaAccion"])
      leaveReason   = (Texto-O-Nulo $fila["MotivoBaja"] 80)
      leftOn        = (Fecha-O-Nulo $fila["Baja"])
      # La zona es un número y 0 quiere decir que no tiene.
      zoneCode      = $(if ((Texto $fila["Zona"] 40) -in @("", "0")) { $null } else { Texto $fila["Zona"] 40 })
      channelCode   = (Texto-O-Nulo $fila["Canal"] 40)
      sectorCode    = (Texto-O-Nulo $fila["Sector"] 40)
      paymentMethod = (Texto-O-Nulo $fila["FormaPago"] 40)
      # Un límite de cero es que no tiene límite puesto, no que no pueda deber nada.
      creditLimit   = $(if ((Numero $fila["Riesgo"]) -gt 0) { Numero $fila["Riesgo"] } else { $null })
      isBlocked     = ([int]$fila["Bloqueado"] -eq 1)
    })
  }
  return ,$lista
}

# --- Contactos de los clientes ---------------------------------------------
# La persona, su cargo y cómo localizarla, para que las listas de "a quién
# llamar" digan a quién y a qué número. No se mandan los que ya no están en el
# cliente ni los marcados para excluir por protección de datos.
function Sql-Marca($alias, $tabla, $columna) {
  if (Tiene $tabla $columna) { return "case when isnull($alias.[$columna], 0) <> 0 then 1 else 0 end" }
  return "0"
}

function Leer-ContactosClientes($avisos) {
  $t = "LcClienteContactos"
  $faltan = Faltan $t @("CodigoEmpresa", "CodigoCliente", "ContactoPosicionLc")
  if ($faltan.Count -gt 0) { Avisar $avisos "contactos de clientes: faltan $($faltan -join ', ')"; return $null }
  # El nombre entero si lo hay; si no, nombre y apellidos.
  $partes = @()
  foreach ($c in @("Nombre", "Apellido1", "Apellido2")) {
    if (Tiene $t $c) { $partes += "isnull(ltrim(rtrim(cast(k.[$c] as nvarchar(80)))), '')" }
  }
  $compuesto = if ($partes.Count -gt 0) { "ltrim(rtrim(" + ($partes -join " + ' ' + ") + "))" } else { "cast('' as nvarchar(200))" }
  $entero = Elegir $t @("NombreContactoLc")
  $nombre = if ($entero) { "coalesce($(Sql-Texto "k" $entero 200), $compuesto)" } else { $compuesto }
  $filtros = ""
  foreach ($c in @("BajaEmpresaLc", "ExcluirPorLOPDLc")) { if (Tiene $t $c) { $filtros += " and isnull(k.[$c], 0) = 0" } }
  $correo = "coalesce($(Sql-Texto "k" (Elegir $t @("EMail1")) 160), $(Sql-Texto "k" (Elegir $t @("EMail2")) 160))"
  $tabla = Consultar $servidorBueno @"
select k.CodigoEmpresa, ltrim(rtrim(cast(k.CodigoCliente as nvarchar(40)))) as Cliente, k.ContactoPosicionLc as Posicion,
  $nombre as Nombre,
  $(Sql-Texto "k" (Elegir $t @("CodigoCargoLc")) 40) as Cargo,
  $(Sql-Texto "k" (Elegir $t @("CodigoAreaContactoLc")) 40) as Area,
  $(Sql-Texto "k" (Elegir $t @("TelefonoContactoLc")) 40) as Telefono,
  $(Sql-Texto "k" (Elegir $t @("Telefono2ContactoLc")) 40) as Telefono2,
  $(Sql-Texto "k" (Elegir $t @("Telefono3ContactoLc")) 40) as Telefono3,
  $correo as Correo,
  $(Sql-Marca "k" $t "EsContactoComercialLc") as Comercial,
  $(Sql-Marca "k" $t "EsAdminClienteLc") as Administracion,
  $(Sql-Marca "k" $t "EsContactoOperativoLc") as Operativo
from [$t] k
where k.CodigoEmpresa not in ($excluidas)
  and k.ContactoPosicionLc is not null
  and isnull(ltrim(rtrim(cast(k.CodigoCliente as nvarchar(40)))), '') <> ''$filtros;
"@
  $lista = New-Object System.Collections.Generic.List[object]
  foreach ($fila in $tabla.Rows) {
    $nombreContacto = (Texto $fila["Nombre"] 200) -replace "\s+", " "
    if ($nombreContacto -eq "") { continue }
    $lista.Add([PSCustomObject]@{
      companyCode   = [int]$fila["CodigoEmpresa"]
      customerCode  = (Texto $fila["Cliente"] 40)
      position      = [int]$fila["Posicion"]
      name          = $nombreContacto
      roleCode      = (Texto-O-Nulo $fila["Cargo"] 40)
      areaCode      = (Texto-O-Nulo $fila["Area"] 40)
      phone         = (Texto-O-Nulo $fila["Telefono"] 40)
      phone2        = (Texto-O-Nulo $fila["Telefono2"] 40)
      phone3        = (Texto-O-Nulo $fila["Telefono3"] 40)
      email         = (Texto-O-Nulo $fila["Correo"] 160)
      isCommercial  = ([int]$fila["Comercial"] -eq 1)
      isAdmin       = ([int]$fila["Administracion"] -eq 1)
      isOperational = ([int]$fila["Operativo"] -eq 1)
    })
  }
  return ,$lista
}

# Lo que compra cada cliente cada día, por canal y comercial.
function Sql-ClientesDia($desdeBloque, $hastaBloque) {
  return @"
select a.CodigoEmpresa, ltrim(rtrim(cast(a.CodigoCliente as nvarchar(40)))) as Cliente, cast(a.FechaAlbaran as date) as Dia,
  isnull(ltrim(rtrim(a.SerieAlbaran)), '') as Serie,
  case when a.CodigoComisionista in (0, 9999) then null else a.CodigoComisionista end as Comercial,
  count(*) as Documentos,
  sum($expLineasAlbaran) as Lineas,
  sum(isnull(a.BaseImponible, 0)) as Neto,
  sum(isnull(a.ImporteCoste, 0)) as Coste,
  sum(case when isnull(a.ImporteCoste, 0) = 0 then isnull(a.BaseImponible, 0) else 0 end) as NetoSinCoste,
  $expBruto as Bruto,
  $expDescuentoLineas as DescuentoLineas
from CabeceraAlbaranCliente a
where $(Sql-Entre "a.FechaAlbaran" $desdeBloque $hastaBloque)
  and a.CodigoEmpresa not in ($excluidas)
  and isnull(ltrim(rtrim(a.CodigoCliente)), '') <> ''
group by a.CodigoEmpresa, ltrim(rtrim(cast(a.CodigoCliente as nvarchar(40)))), cast(a.FechaAlbaran as date),
  isnull(ltrim(rtrim(a.SerieAlbaran)), ''),
  case when a.CodigoComisionista in (0, 9999) then null else a.CodigoComisionista end;
"@
}

function Filas-ClientesDia($tabla) {
  $lista = New-Object System.Collections.Generic.List[object]
  foreach ($fila in $tabla.Rows) {
    $lista.Add([PSCustomObject]@{
      companyCode    = [int]$fila["CodigoEmpresa"]
      customerCode   = (Texto $fila["Cliente"] 40)
      day            = ([datetime]$fila["Dia"]).ToString("yyyy-MM-dd")
      series         = (Texto $fila["Serie"] 20)
      repCode        = (Entero-O-Nulo $fila["Comercial"])
      documents      = [int]$fila["Documentos"]
      lines          = [int](Numero $fila["Lineas"])
      netAmount      = (Numero $fila["Neto"])
      costAmount     = (Numero $fila["Coste"])
      netWithoutCost = (Numero $fila["NetoSinCoste"])
      grossAmount    = (Numero-O-Nulo $fila["Bruto"])
      lineDiscountAmount = (Numero-O-Nulo $fila["DescuentoLineas"])
    })
  }
  return ,$lista
}

# Qué familias compra cada cliente cada mes.
function Sql-ClientesFamilia($cfg, $mesDesde, $mesHasta) {
  $familia = "isnull(ltrim(rtrim(cast($($cfg.Familia) as nvarchar(40)))), '')"
  $cliente = "ltrim(rtrim(cast(a.CodigoCliente as nvarchar(40))))"
  return @"
select a.CodigoEmpresa, $cliente as Cliente, convert(char(7), a.FechaAlbaran, 120) as Mes, $familia as Familia,
  sum(isnull(l.[$($cfg.Importe)], 0)) as Neto,
  sum(isnull($($cfg.Coste), 0)) as Coste,
  sum(case when isnull($($cfg.Coste), 0) = 0 then isnull(l.[$($cfg.Importe)], 0) else 0 end) as NetoSinCoste,
  $(Sql-BrutoLineas $cfg) as Bruto
$(Sql-UnirLineas $cfg)
where $(Sql-Entre "a.FechaAlbaran" $mesDesde $mesHasta)
  and a.CodigoEmpresa not in ($excluidas)
  and isnull(ltrim(rtrim(a.CodigoCliente)), '') <> ''
group by a.CodigoEmpresa, $cliente, convert(char(7), a.FechaAlbaran, 120), $familia;
"@
}

# --- Clientes por mes: cuántos compran y cuántos lo hacen por primera vez ---
$clientesListos = $false
if (-not $SoloVentas) {
  $faltan = Faltan "CabeceraAlbaranCliente" @("CodigoEmpresa", "CodigoCliente", "FechaAlbaran", "BaseImponible")
  if ($faltan.Count -gt 0) { Avisar $avisosDeArranque "clientes: faltan $($faltan -join ', ')" } else { $clientesListos = $true }
}

function Sql-Clientes($mesDesde, $mesHasta) {
  return @"
with primeras as (
  select CodigoEmpresa, CodigoCliente, min(FechaAlbaran) as Primera
  from CabeceraAlbaranCliente
  where CodigoEmpresa not in ($excluidas)
  group by CodigoEmpresa, CodigoCliente
)
select a.CodigoEmpresa, convert(char(7), a.FechaAlbaran, 120) as Mes,
  count(distinct a.CodigoCliente) as Activos,
  count(distinct case when convert(char(7), p.Primera, 120) = convert(char(7), a.FechaAlbaran, 120) then a.CodigoCliente end) as Nuevos
from CabeceraAlbaranCliente a
join primeras p on p.CodigoEmpresa = a.CodigoEmpresa and p.CodigoCliente = a.CodigoCliente
where a.FechaAlbaran >= convert(datetime, '$mesDesde', 112) and a.FechaAlbaran < convert(datetime, '$mesHasta', 112)
  and a.CodigoEmpresa not in ($excluidas)
group by a.CodigoEmpresa, convert(char(7), a.FechaAlbaran, 120);
"@
}

# Clientes que compraron en los 12 meses anteriores a los últimos 90 días y
# desde entonces nada. Solo cuántos y cuánto compraban.
function Leer-Dormidos {
  $tabla = Consultar $servidorBueno @"
select x.CodigoEmpresa, count(*) as Clientes, sum(x.Neto) as Importe
from (
  select CodigoEmpresa, CodigoCliente, sum(isnull(BaseImponible, 0)) as Neto, max(FechaAlbaran) as Ultima
  from CabeceraAlbaranCliente
  where FechaAlbaran >= dateadd(day, -455, cast(getdate() as date)) and CodigoEmpresa not in ($excluidas)
  group by CodigoEmpresa, CodigoCliente
) x
where x.Ultima < dateadd(day, -90, cast(getdate() as date)) and x.Neto > 0
group by x.CodigoEmpresa;
"@
  $lista = New-Object System.Collections.Generic.List[object]
  foreach ($fila in $tabla.Rows) {
    $lista.Add([PSCustomObject]@{ companyCode = [int]$fila["CodigoEmpresa"]; count = [int]$fila["Clientes"]; amount = (Numero $fila["Importe"]) })
  }
  return ,$lista
}

# --- Cartera: pedidos de los últimos 12 meses con algo pendiente de servir ---
function Leer-Cartera {
  $claves = @("CodigoEmpresa", "EjercicioPedido", "SeriePedido", "NumeroPedido")
  $faltan = @(Faltan "CabeceraPedidoCliente" ($claves + @("FechaPedido"))) + @(Faltan "LineasPedidoCliente" ($claves + @("UnidadesPendientes")))
  if ($faltan.Count -gt 0) { Avisar $avisosDeArranque "cartera de pedidos: faltan $($faltan -join ', ')"; return $null }
  $pedidas = Elegir "LineasPedidoCliente" @("UnidadesPedidas", "Unidades")
  $importe = Elegir "LineasPedidoCliente" @("BaseImponible", "ImporteNeto", "ImporteLiquido")
  if (-not $pedidas -or -not $importe) { Avisar $avisosDeArranque "cartera de pedidos: faltan las unidades pedidas o el importe de la linea"; return $null }
  $comercial = "cast(null as int)"
  $grupo = ""
  if (Tiene "CabeceraPedidoCliente" "CodigoComisionista") {
    $comercial = "case when p.CodigoComisionista in (0, 9999) then null else p.CodigoComisionista end"
    $grupo = ", $comercial"
  }
  $tabla = Consultar $servidorBueno @"
select p.CodigoEmpresa, $comercial as Comercial,
  count(distinct concat(p.EjercicioPedido, '|', p.SeriePedido, '|', p.NumeroPedido)) as Pedidos,
  sum(isnull(l.[$importe] * l.UnidadesPendientes / nullif(l.[$pedidas], 0), 0)) as Pendiente
from CabeceraPedidoCliente p
join LineasPedidoCliente l
  on l.CodigoEmpresa = p.CodigoEmpresa and l.EjercicioPedido = p.EjercicioPedido
 and l.SeriePedido = p.SeriePedido and l.NumeroPedido = p.NumeroPedido
where l.UnidadesPendientes > 0
  and p.FechaPedido >= dateadd(day, -365, cast(getdate() as date))
  and p.CodigoEmpresa not in ($excluidas)
group by p.CodigoEmpresa$grupo;
"@
  $lista = New-Object System.Collections.Generic.List[object]
  foreach ($fila in $tabla.Rows) {
    $lista.Add([PSCustomObject]@{ companyCode = [int]$fila["CodigoEmpresa"]; repCode = (Entero-O-Nulo $fila["Comercial"]); count = [int]$fila["Pedidos"]; amount = (Numero $fila["Pendiente"]) })
  }
  return ,$lista
}

# --- Ofertas una a una: estado, motivo, fechas y lo que acabó en pedido -----
function Preparar-OfertasDetalle {
  $faltan = Faltan "CabeceraOfertaCliente" @("CodigoEmpresa", "EjercicioOferta", "NumeroOferta", "FechaOferta")
  if ($faltan.Count -gt 0) { Avisar $avisosDeArranque "ofertas una a una: faltan $($faltan -join ', ')"; return $null }
  $enlace = (@(Faltan "LineasPedidoCliente" @("CodigoEmpresa", "EjercicioOferta", "SerieOferta", "NumeroOferta", "FechaPedido")).Count -eq 0) -and (Tiene "CabeceraOfertaCliente" "SerieOferta")
  if (-not $enlace) { Avisar $avisosDeArranque "ofertas una a una: no se puede enlazar con los pedidos; sale sin conversion" }
  return @{
    Serie = (Elegir "CabeceraOfertaCliente" @("SerieOferta"))
    Presentacion = (Elegir "CabeceraOfertaCliente" @("FechaPresentacionOferta"))
    Validez = (Elegir "CabeceraOfertaCliente" @("_TS_FechaValidez", "FechaValidez"))
    Cierre = (Elegir "CabeceraOfertaCliente" @("FechaPrevistaCierreLc"))
    Cliente = (Elegir "CabeceraOfertaCliente" @("CodigoCliente"))
    Comercial = (Elegir "CabeceraOfertaCliente" @("CodigoComisionista"))
    Estado = (Elegir "CabeceraOfertaCliente" @("Estado", "StatusOferta"))
    Probabilidad = (Elegir "CabeceraOfertaCliente" @("CodigoTipoProbabilidadCierreLc"))
    Motivo = (Elegir "CabeceraOfertaCliente" @("CP_MotivoRechazo", "MotivoRechazo"))
    Detalle = (Elegir "CabeceraOfertaCliente" @("CP_Detalle_perdida_oferta"))
    Importe = (Elegir "CabeceraOfertaCliente" @("BaseImponible", "ImporteNeto", "ImporteLiquido"))
    Lineas = (Elegir "CabeceraOfertaCliente" @("NumeroLineas"))
    ImporteLinea = (Elegir "LineasPedidoCliente" @("BaseImponible", "ImporteNeto", "ImporteLiquido"))
    Enlace = $enlace
  }
}

function Sql-OfertasDetalle($cfg, $desde, $hasta) {
  $serie = if ($cfg.Serie) { "isnull(ltrim(rtrim(o.[$($cfg.Serie)])), '')" } else { "''" }
  $estado = if ($cfg.Estado) { "cast(o.[$($cfg.Estado)] as int)" } else { "cast(null as int)" }
  $pedido = "cast(0 as decimal(14, 2))"
  $primerPedido = "cast(null as date)"
  $unir = ""
  if ($cfg.Enlace -and $cfg.ImporteLinea) {
    $pedido = "isnull(p.Pedido, 0)"
    $primerPedido = "p.PrimerPedido"
    $unir = @"
left join (
  select l.CodigoEmpresa, l.EjercicioOferta, isnull(ltrim(rtrim(l.SerieOferta)), '') as SerieOferta, l.NumeroOferta,
    sum(isnull(l.[$($cfg.ImporteLinea)], 0)) as Pedido, cast(min(l.FechaPedido) as date) as PrimerPedido
  from LineasPedidoCliente l
  where isnull(l.NumeroOferta, 0) <> 0
  group by l.CodigoEmpresa, l.EjercicioOferta, isnull(ltrim(rtrim(l.SerieOferta)), ''), l.NumeroOferta
) p on p.CodigoEmpresa = o.CodigoEmpresa and p.EjercicioOferta = o.EjercicioOferta
   and p.SerieOferta = $serie and p.NumeroOferta = o.NumeroOferta
"@
  }
  return @"
select o.CodigoEmpresa, o.EjercicioOferta as Ejercicio, $serie as Serie, o.NumeroOferta as Numero,
  cast(o.FechaOferta as date) as Fecha,
  $(Sql-Fecha "o" $cfg.Presentacion) as Presentacion,
  $(Sql-Fecha "o" $cfg.Validez) as Validez,
  $(Sql-Fecha "o" $cfg.Cierre) as Cierre,
  $(Sql-Texto "o" $cfg.Cliente 40) as Cliente,
  $(Sql-Comercial "o" $cfg.Comercial) as Comercial,
  $estado as Estado,
  $(Sql-Texto "o" $cfg.Probabilidad 40) as Probabilidad,
  $(Sql-Texto "o" $cfg.Motivo 120) as Motivo,
  $(Sql-Texto "o" $cfg.Detalle 300) as Detalle,
  $(Sql-Numero "o" $cfg.Importe) as Neto,
  $(Sql-Numero "o" $cfg.Lineas) as Lineas,
  $pedido as Pedido,
  $primerPedido as PrimerPedido
from CabeceraOfertaCliente o
$unir
where $(Sql-Entre "o.FechaOferta" $desde $hasta)
  and o.CodigoEmpresa not in ($excluidas);
"@
}

function Filas-OfertasDetalle($tabla) {
  $lista = New-Object System.Collections.Generic.List[object]
  foreach ($fila in $tabla.Rows) {
    $lista.Add([PSCustomObject]@{
      companyCode   = [int]$fila["CodigoEmpresa"]
      year          = [int]$fila["Ejercicio"]
      series        = (Texto $fila["Serie"] 20)
      number        = [int]$fila["Numero"]
      offerDate     = ([datetime]$fila["Fecha"]).ToString("yyyy-MM-dd")
      presentedOn   = (Fecha-O-Nulo $fila["Presentacion"])
      validUntil    = (Fecha-O-Nulo $fila["Validez"])
      expectedClose = (Fecha-O-Nulo $fila["Cierre"])
      customerCode  = (Texto-O-Nulo $fila["Cliente"] 40)
      repCode       = (Entero-O-Nulo $fila["Comercial"])
      status        = (Entero-O-Nulo $fila["Estado"])
      probability   = (Texto-O-Nulo $fila["Probabilidad"] 40)
      rejectReason  = (Texto-O-Nulo $fila["Motivo"] 120)
      lossDetail    = (Texto-O-Nulo $fila["Detalle"] 300)
      netAmount     = (Numero $fila["Neto"])
      lines         = [int](Numero $fila["Lineas"])
      orderedAmount = (Numero $fila["Pedido"])
      firstOrderOn  = (Fecha-O-Nulo $fila["PrimerPedido"])
    })
  }
  return ,$lista
}

# --- Pedidos uno a uno: pendiente, fechas y cuándo empezó a servirse --------
function Preparar-PedidosDetalle {
  $faltan = Faltan "CabeceraPedidoCliente" @("CodigoEmpresa", "EjercicioPedido", "NumeroPedido", "FechaPedido")
  if ($faltan.Count -gt 0) { Avisar $avisosDeArranque "pedidos uno a uno: faltan $($faltan -join ', ')"; return $null }
  $enlace = (@(Faltan "CabeceraAlbaranCliente" @("EjercicioPedido", "SeriePedido", "NumeroPedido")).Count -eq 0) -and (Tiene "CabeceraPedidoCliente" "SeriePedido")
  return @{
    Serie = (Elegir "CabeceraPedidoCliente" @("SeriePedido"))
    Necesaria = (Elegir "CabeceraPedidoCliente" @("FechaNecesaria"))
    Entrega = (Elegir "CabeceraPedidoCliente" @("FechaEntrega"))
    Cliente = (Elegir "CabeceraPedidoCliente" @("CodigoCliente"))
    Comercial = (Elegir "CabeceraPedidoCliente" @("CodigoComisionista"))
    Estado = (Elegir "CabeceraPedidoCliente" @("Estado", "StatusPedido"))
    Importe = (Elegir "CabeceraPedidoCliente" @("BaseImponible", "ImporteNeto", "ImporteLiquido"))
    Pendiente = (Elegir "CabeceraPedidoCliente" @("BaseImponiblePendiente", "ImporteNetoLineasPendiente"))
    Lineas = (Elegir "CabeceraPedidoCliente" @("NumeroLineas"))
    Oferta = (Elegir "CabeceraPedidoCliente" @("NumeroOferta"))
    Enlace = $enlace
  }
}

function Sql-PedidosDetalle($cfg, $desde, $hasta) {
  $serie = if ($cfg.Serie) { "isnull(ltrim(rtrim(p.[$($cfg.Serie)])), '')" } else { "''" }
  $estado = if ($cfg.Estado) { "cast(p.[$($cfg.Estado)] as int)" } else { "cast(null as int)" }
  $deOferta = if ($cfg.Oferta) { "case when isnull(p.[$($cfg.Oferta)], 0) <> 0 then 1 else 0 end" } else { "0" }
  $servido = "cast(0 as decimal(14, 2))"
  $primerAlbaran = "cast(null as date)"
  $unir = ""
  if ($cfg.Enlace) {
    $servido = "isnull(s.Servido, 0)"
    $primerAlbaran = "s.PrimerAlbaran"
    $unir = @"
left join (
  select a.CodigoEmpresa, a.EjercicioPedido, isnull(ltrim(rtrim(a.SeriePedido)), '') as SeriePedido, a.NumeroPedido,
    sum(isnull(a.BaseImponible, 0)) as Servido, cast(min(a.FechaAlbaran) as date) as PrimerAlbaran
  from CabeceraAlbaranCliente a
  where isnull(a.NumeroPedido, 0) <> 0
  group by a.CodigoEmpresa, a.EjercicioPedido, isnull(ltrim(rtrim(a.SeriePedido)), ''), a.NumeroPedido
) s on s.CodigoEmpresa = p.CodigoEmpresa and s.EjercicioPedido = p.EjercicioPedido
   and s.SeriePedido = $serie and s.NumeroPedido = p.NumeroPedido
"@
  }
  return @"
select p.CodigoEmpresa, p.EjercicioPedido as Ejercicio, $serie as Serie, p.NumeroPedido as Numero,
  cast(p.FechaPedido as date) as Fecha,
  $(Sql-Fecha "p" $cfg.Necesaria) as Necesaria,
  $(Sql-Fecha "p" $cfg.Entrega) as Entrega,
  $(Sql-Texto "p" $cfg.Cliente 40) as Cliente,
  $(Sql-Comercial "p" $cfg.Comercial) as Comercial,
  $estado as Estado,
  $(Sql-Numero "p" $cfg.Importe) as Neto,
  $(Sql-Numero "p" $cfg.Pendiente) as Pendiente,
  $(Sql-Numero "p" $cfg.Lineas) as Lineas,
  $deOferta as DeOferta,
  $servido as Servido,
  $primerAlbaran as PrimerAlbaran
from CabeceraPedidoCliente p
$unir
where $(Sql-Entre "p.FechaPedido" $desde $hasta)
  and p.CodigoEmpresa not in ($excluidas);
"@
}

function Filas-PedidosDetalle($tabla) {
  $lista = New-Object System.Collections.Generic.List[object]
  foreach ($fila in $tabla.Rows) {
    $lista.Add([PSCustomObject]@{
      companyCode     = [int]$fila["CodigoEmpresa"]
      year            = [int]$fila["Ejercicio"]
      series          = (Texto $fila["Serie"] 20)
      number          = [int]$fila["Numero"]
      orderDate       = ([datetime]$fila["Fecha"]).ToString("yyyy-MM-dd")
      neededOn        = (Fecha-O-Nulo $fila["Necesaria"])
      deliveryOn      = (Fecha-O-Nulo $fila["Entrega"])
      customerCode    = (Texto-O-Nulo $fila["Cliente"] 40)
      repCode         = (Entero-O-Nulo $fila["Comercial"])
      status          = (Entero-O-Nulo $fila["Estado"])
      netAmount       = (Numero $fila["Neto"])
      pendingAmount   = (Numero $fila["Pendiente"])
      lines           = [int](Numero $fila["Lineas"])
      fromOffer       = ([int]$fila["DeOferta"] -eq 1)
      deliveredAmount = (Numero $fila["Servido"])
      firstDeliveryOn = (Fecha-O-Nulo $fila["PrimerAlbaran"])
    })
  }
  return ,$lista
}

# --- Abonos (devoluciones) e incidencias apuntadas en los albaranes ---------
function Sql-Incidencias($desde, $hasta) {
  $serie = "isnull(ltrim(rtrim(a.SerieAlbaran)), '')"
  $comercial = "case when a.CodigoComisionista in (0, 9999) then null else a.CodigoComisionista end"
  # Sin columna de motivo va vacío y fuera del group by (no se agrupa por un fijo).
  $motivo = "''"
  $grupos = @("a.CodigoEmpresa", "cast(a.FechaAlbaran as date)", $serie, $comercial)
  if (Tiene "CabeceraAlbaranCliente" "CodigoMotivoAbonoLc") {
    $motivo = "isnull(ltrim(rtrim(cast(a.CodigoMotivoAbonoLc as nvarchar(60)))), '')"
    $grupos += $motivo
  }
  $partes = @(@"
select a.CodigoEmpresa, cast(a.FechaAlbaran as date) as Dia, 'abono' as Tipo, $motivo as Motivo, $serie as Serie, $comercial as Comercial,
  count(*) as Documentos, sum(isnull(a.BaseImponible, 0)) as Neto
from CabeceraAlbaranCliente a
where $(Sql-Entre "a.FechaAlbaran" $desde $hasta) and a.CodigoEmpresa not in ($excluidas) and isnull(a.BaseImponible, 0) < 0
group by $($grupos -join ", ")
"@)
  if (Tiene "CabeceraAlbaranCliente" "IncidenciaAlbaran") {
    $incidencia = "left(isnull(ltrim(rtrim(cast(a.IncidenciaAlbaran as nvarchar(400)))), ''), 120)"
    $partes += @"
select a.CodigoEmpresa, cast(a.FechaAlbaran as date) as Dia, 'incidencia' as Tipo, $incidencia as Motivo, $serie as Serie, $comercial as Comercial,
  count(*) as Documentos, sum(isnull(a.BaseImponible, 0)) as Neto
from CabeceraAlbaranCliente a
where $(Sql-Entre "a.FechaAlbaran" $desde $hasta) and a.CodigoEmpresa not in ($excluidas)
  and isnull(ltrim(rtrim(cast(a.IncidenciaAlbaran as nvarchar(400)))), '') <> ''
group by a.CodigoEmpresa, cast(a.FechaAlbaran as date), $incidencia, $serie, $comercial
"@
  }
  return ($partes -join "`nunion all`n") + ";"
}

function Filas-Incidencias($tabla) {
  $lista = New-Object System.Collections.Generic.List[object]
  foreach ($fila in $tabla.Rows) {
    $lista.Add([PSCustomObject]@{
      companyCode = [int]$fila["CodigoEmpresa"]
      day         = ([datetime]$fila["Dia"]).ToString("yyyy-MM-dd")
      kind        = [string]$fila["Tipo"]
      reason      = (Texto $fila["Motivo"] 120)
      series      = (Texto $fila["Serie"] 20)
      repCode     = (Entero-O-Nulo $fila["Comercial"])
      documents   = [int]$fila["Documentos"]
      netAmount   = (Numero $fila["Neto"])
    })
  }
  return ,$lista
}

# --- Tablas de códigos: el nombre de cada motivo, tipo, grupo... ------------
# Tablas pequeñas cuyo nombre suena a catálogo. De cada una se coge la primera
# columna de código y la de descripción. No son datos de nadie, solo nombres.
function Leer-Codigos {
  # Las de nóminas, impuestos y sincronización coinciden con "Incidencia" o
  # "Actividad" pero no dicen nada de ventas: se dejan fuera.
  $candidatas = Consultar $servidorBueno @"
select t.name as Tabla, sum(p.rows) as Filas
from sys.tables t
join sys.partitions p on p.object_id = t.object_id and p.index_id in (0, 1)
where (t.name like '%Motivo%' or t.name like '%Probabilidad%' or t.name like '%TipoCliente%' or t.name like '%TiposCliente%'
    or t.name like '%GrupoCliente%' or t.name like '%GruposCliente%' or t.name like '%Actividad%' or t.name like '%Marca%'
    or t.name like '%Fabricante%' or t.name like '%Incidencia%' or t.name like '%Categoria%' or t.name like '%Sector%'
    or t.name like '%TipoAccion%' or t.name like '%ClaseLlamada%' or t.name like '%ClasesLlamada%' or t.name = 'Provincias'
    or t.name like '%Zona%' or t.name like '%Canal%' or t.name like '%FormasPago%' or t.name like '%FormaPago%'
    or t.name like '%Cargo%' or t.name like '%AreasContacto%')
  and t.name not like '%bak%' and t.name not like 'Tmp%' and t.name not like '%[_]Sync'
  and t.name not like 'IOF[_]%' and t.name not like 'IMP[_]%' and t.name not like 'RHH[_]%' and t.name not like 'NOM[_]%'
  and t.name not like 'GFP[_]%' and t.name not like 'GDPR[_]%' and t.name not like 'Nomina%'
group by t.name
having sum(p.rows) between 1 and 2000
order by t.name;
"@
  $lista = New-Object System.Collections.Generic.List[object]
  $tablas = 0
  foreach ($candidata in $candidatas.Rows) {
    if ($tablas -ge 60 -or $lista.Count -ge 18000) { break }
    $nombreTabla = [string]$candidata["Tabla"]
    try {
      $columnas = Consultar $servidorBueno "select c.name, ty.name as tipo from sys.columns c join sys.tables t on t.object_id = c.object_id join sys.types ty on ty.user_type_id = c.user_type_id where t.name = '$nombreTabla' order by c.column_id;"
      $nombres = @($columnas.Rows | ForEach-Object { [string]$_["name"] })
      $codigo = $null
      $descripcion = $null
      foreach ($n in $nombres) {
        if (-not $codigo -and $n -like "Codigo*" -and $n -ne "CodigoEmpresa") { $codigo = $n }
      }
      # Las formas de pago no tienen columna "Codigo...": su código es FormadePago.
      if (-not $codigo -and $nombres -contains "FormadePago") { $codigo = "FormadePago" }
      if (-not $codigo) { continue }
      # El nombre: una descripción, o la columna que se llama como el código sin
      # "Codigo" delante (CodigoMotivoAbonoLc -> MotivoAbonoLc, CodigoZona -> Zona).
      $gemela = $codigo -replace "^Codigo", ""
      foreach ($n in $nombres) {
        if (-not $descripcion -and ($n -like "*Descripcion*" -or $n -like "Nombre*" -or $n -eq "Motivo" -or $n -like "Denominacion*")) { $descripcion = $n }
      }
      if (-not $descripcion -and $gemela -ne $codigo -and ($nombres -contains $gemela)) { $descripcion = $gemela }
      if (-not $descripcion) {
        # Si no, la primera columna de texto que no sea otro código.
        foreach ($c in $columnas.Rows) {
          $n = [string]$c["name"]
          if ($n -eq $codigo -or $n -like "Codigo*" -or $n -like "Id*" -or $n -like "Status*" -or $n -like "sys*") { continue }
          if (@("varchar", "nvarchar", "char", "nchar") -contains [string]$c["tipo"]) { $descripcion = $n; break }
        }
      }
      if (-not $descripcion) { continue }
      $filas = Consultar $servidorBueno @"
select top 2000 ltrim(rtrim(cast([$codigo] as nvarchar(60)))) as Codigo, max(ltrim(rtrim(cast([$descripcion] as nvarchar(200))))) as Nombre
from [$nombreTabla]
group by ltrim(rtrim(cast([$codigo] as nvarchar(60))));
"@
      foreach ($f in $filas.Rows) {
        $cod = Texto $f["Codigo"] 60
        $nom = Texto $f["Nombre"] 200
        if ($cod -ne "" -and $nom -ne "") { $lista.Add([PSCustomObject]@{ table = $nombreTabla; code = $cod; name = $nom; column = $codigo }) }
      }
      $tablas++
    } catch { }
  }
  return ,$lista
}

# --- Estructura: nombres de columnas, para ampliar la lectura sin adivinar ---
# Con las tablas de visitas, acciones comerciales, objetivos y motivos a la
# vista se puede preparar la siguiente parte sin entrar en el servidor. La fila
# "__filas__" de cada tabla dice cuántos registros tiene (si se usa o no).
function Leer-Estructura {
  $filtro = @"
t.name in ('CabeceraAlbaranCliente', 'LineasAlbaranCliente', 'CabeceraOfertaCliente', 'LineasOfertaCliente',
           'CabeceraPedidoCliente', 'LineasPedidoCliente', 'Articulos', 'Familias', 'Clientes', 'Comisionistas')
   or t.name like '%Accion%' or t.name like '%Visita%' or t.name like '%Llamada%' or t.name like '%Agenda%'
   or t.name like '%Objetivo%' or t.name like '%Presupuesto%' or t.name like '%Motivo%' or t.name like '%Probabilidad%'
   or t.name like '%Incidencia%' or t.name like '%Marca%' or t.name like '%Oportunidad%' or t.name like '%Tarea%'
   or t.name like '%Actividad%' or t.name like '%Contacto%'
   or t.name in ('Proveedores', 'Empresas', 'Remesas', 'CarteraEfectos', 'Domicilios', 'Naciones')
   or t.name like '%Banco%'
   or t.name like '%Zona%' or t.name like '%Canal%' or t.name like '%FormasPago%' or t.name like '%FormaPago%' or t.name like '%Cargo%'
   or t.name like '%Saldo%'
"@
  $tabla = Consultar $servidorBueno @"
select top 14000 x.Tabla, x.Columna, x.Tipo from (
  select t.name as Tabla, c.name as Columna, ty.name as Tipo, c.column_id as Orden
  from sys.tables t
  join sys.columns c on c.object_id = t.object_id
  join sys.types ty on ty.user_type_id = c.user_type_id
  where ($filtro) and t.name not like '%bak%' and t.name not like 'Tmp%'
  union all
  select t.name, '__filas__', cast(sum(p.rows) as varchar(20)), 0
  from sys.tables t
  join sys.partitions p on p.object_id = t.object_id and p.index_id in (0, 1)
  where ($filtro) and t.name not like '%bak%' and t.name not like 'Tmp%'
  group by t.name
) x
order by x.Tabla, x.Orden;
"@
  $lista = New-Object System.Collections.Generic.List[object]
  foreach ($fila in $tabla.Rows) {
    $lista.Add([PSCustomObject]@{ table = (Texto $fila["Tabla"] 128); column = (Texto $fila["Columna"] 128); type = (Texto $fila["Tipo"] 64) })
  }
  return ,$lista
}

# ---------------------------------------------------------------------------
# Pagos a proveedores: remesas de Sage, proveedores y cartera pendiente
# ---------------------------------------------------------------------------
# Las remesas de pagos se hacen en Sage; el Hub las convierte en el fichero de
# confirming de cada banco. Para eso necesita cada remesa con sus efectos
# (factura del proveedor, vencimiento, importe, IBAN), los datos del proveedor
# y los de la sociedad que paga. La cartera pendiente es para la tesorería.
function Preparar-Pagos {
  $faltan = Faltan "CarteraEfectos" @("CodigoEmpresa", "Prevision", "CodigoClienteProveedor", "FechaVencimiento", "ImportePendiente")
  if ($faltan.Count -gt 0) { Avisar $avisosDeArranque "pagos: faltan $($faltan -join ', ') en CarteraEfectos"; return $null }
  $cfg = @{
    Mov          = (Elegir "CarteraEfectos" @("MovPosicion", "MovCartera"))
    NumeroEfecto = (Elegir "CarteraEfectos" @("NumeroEfecto"))
    Orden        = (Elegir "CarteraEfectos" @("NumeroOrdenEfecto"))
    SuFactura    = (Elegir "CarteraEfectos" @("SuFacturaNo"))
    Factura      = (Elegir "CarteraEfectos" @("Factura"))
    Serie        = (Elegir "CarteraEfectos" @("SerieFactura"))
    FechaFactura = (Elegir "CarteraEfectos" @("FechaFactura", "FechaEmision"))
    Importe      = (Elegir "CarteraEfectos" @("ImporteEfecto"))
    Iban         = (Elegir "CarteraEfectos" @("IBAN"))
    Remesa       = (Elegir "CarteraEfectos" @("NumeroRemesa"))
    BancoRemesa  = (Elegir "CarteraEfectos" @("BancoRemesa"))
    TipoEfecto   = (Elegir "CarteraEfectos" @("TipoEfecto"))
    Borrado      = (Elegir "CarteraEfectos" @("StatusBorrado"))
    # Los recibos que el banco ha devuelto (impagados), para Administración.
    Impagado     = (Elegir "CarteraEfectos" @("StatusImpagado"))
    FechaImpagado = (Elegir "CarteraEfectos" @("FechaImpagado"))
    ConRemesas   = ((Faltan "Remesas" @("CodigoEmpresa", "NumeroRemesa", "FechaRemesa")).Count -eq 0)
    RFechaValor  = (Elegir "Remesas" @("FechaValor"))
    RBanco       = (Elegir "Remesas" @("BancoRemesa"))
    RTipo        = (Elegir "Remesas" @("TipoRemesa"))
    RNorma       = (Elegir "Remesas" @("NormaCSB"))
    RTotal       = (Elegir "Remesas" @("ImporteTotal"))
    REfectos     = (Elegir "Remesas" @("NumeroEfectos"))
    RProvisional = (Elegir "Remesas" @("Provisional"))
    Proveedores  = $null
  }
  if (-not $cfg.Remesa) { Avisar $avisosDeArranque "remesas de pagos: CarteraEfectos no tiene NumeroRemesa" }
  if (-not $cfg.ConRemesas) { Avisar $avisosDeArranque "remesas de pagos: no se encuentra la tabla Remesas" }
  if ((Faltan "Proveedores" @("CodigoEmpresa", "CodigoProveedor")).Count -eq 0) {
    $cfg.Proveedores = @{
      Razon        = (Elegir "Proveedores" @("RazonSocial"))
      Nombre       = (Elegir "Proveedores" @("Nombre"))
      Nif          = (Elegir "Proveedores" @("CifDni", "CifEuropeo", "Nif"))
      Domicilio    = (Elegir "Proveedores" @("Domicilio", "Direccion"))
      CodigoPostal = (Elegir "Proveedores" @("CodigoPostal"))
      Municipio    = (Elegir "Proveedores" @("Municipio", "Poblacion"))
      Provincia    = (Elegir "Proveedores" @("Provincia"))
      Nacion       = (Elegir "Proveedores" @("Nacion", "CodigoNacion"))
      Telefono     = (Elegir "Proveedores" @("Telefono", "Telefono2"))
      Correo       = (Elegir "Proveedores" @("EMail1", "Email1", "EMail2", "E_Mail"))
      Iban         = (Elegir "Proveedores" @("IBAN"))
    }
  } else {
    Avisar $avisosDeArranque "proveedores: no se encuentra la tabla Proveedores"
  }
  return $cfg
}

# El número de factura que ve el proveedor es el suyo (SuFacturaNo); si falta,
# el de Sage (serie y número).
function Sql-FacturaEfecto($cfg) {
  $propia = if ($cfg.Factura) { "nullif(ltrim(rtrim(isnull(cast(e.[$($cfg.Serie)] as nvarchar(20)), '') + cast(e.[$($cfg.Factura)] as nvarchar(20)))), '0')" } else { "cast(null as nvarchar(40))" }
  if (-not $cfg.Serie -and $cfg.Factura) { $propia = "nullif(cast(e.[$($cfg.Factura)] as nvarchar(40)), '0')" }
  $suya = Sql-Texto "e" $cfg.SuFactura 40
  return "coalesce($suya, $propia)"
}
function Sql-MovEfecto($cfg) {
  $partes = @("cast(e.CodigoEmpresa as nvarchar(10))")
  if ($cfg.NumeroEfecto) { $partes += "cast(e.[$($cfg.NumeroEfecto)] as nvarchar(20))" }
  if ($cfg.Orden) { $partes += "cast(e.[$($cfg.Orden)] as nvarchar(10))" }
  $respaldo = $partes -join " + '-' + "
  if ($cfg.Mov) { return "coalesce(cast(e.[$($cfg.Mov)] as nvarchar(60)), $respaldo)" }
  return $respaldo
}
function Sql-NoBorrado($cfg) {
  if ($cfg.Borrado) { return "and isnull(e.[$($cfg.Borrado)], 0) = 0" }
  return ""
}

# Las remesas de pagos de los últimos 180 días, con sus efectos.
function Leer-RemesasPagos($cfg) {
  # En Sage las remesas de cobro y las de pago comparten numeración: un efecto de
  # pago de la remesa 12 se cruzaba también con la remesa de cobro 12. El
  # 30/09/2026 llegaron 17 de 183 remesas de pagos con la cabecera de una de
  # cobro ("Cobro" o "Descuento"). Las de confirming se hacen como "Talones".
  $soloPagos = ""
  if ($cfg.RTipo) { $soloPagos = "and isnull(r.[$($cfg.RTipo)], '') not in ('Cobro', 'Descuento')" }
  # Las remesas con algún pago se sacan de una sola pasada por la cartera.
  $remesas = Consultar $servidorBueno @"
with pagos as (
  select distinct e.CodigoEmpresa, e.[$($cfg.Remesa)] as NumeroRemesa
  from CarteraEfectos e
  where e.Prevision = 'P' and isnull(e.[$($cfg.Remesa)], 0) > 0 and e.CodigoEmpresa not in ($excluidas)
)
select r.CodigoEmpresa, r.NumeroRemesa, cast(r.FechaRemesa as date) as FechaRemesa,
  $(Sql-Fecha "r" $cfg.RFechaValor) as FechaValor,
  $(Sql-Texto "r" $cfg.RBanco 40) as Banco,
  $(Sql-Texto "r" $cfg.RTipo 20) as Tipo,
  $(Sql-Texto "r" $cfg.RNorma 20) as Norma,
  $(Sql-Numero "r" $cfg.RTotal) as Total,
  $(Sql-Numero "r" $cfg.REfectos) as Efectos,
  $(Sql-Numero "r" $cfg.RProvisional) as Provisional
from Remesas r
join pagos x on x.CodigoEmpresa = r.CodigoEmpresa and x.NumeroRemesa = r.NumeroRemesa
where r.FechaRemesa >= dateadd(day, -180, getdate())
  $soloPagos;
"@
  # El IBAN del efecto, y si no lo tiene, el de la ficha del proveedor. El
  # 30/09/2026 cuatro de cada diez efectos remesados no lo traían en el efecto,
  # y sin IBAN no se puede hacer el fichero del banco.
  $iban = Sql-Texto "e" $cfg.Iban 40
  $ibanFicha = ""
  if ($cfg.Proveedores -and $cfg.Proveedores.Iban) {
    $iban = "coalesce($iban, $(Sql-Texto "pv" "Iban" 40))"
    $ibanFicha = @"
outer apply (
  select top 1 pr.[$($cfg.Proveedores.Iban)] as Iban
  from Proveedores pr
  where pr.CodigoEmpresa = e.CodigoEmpresa and pr.CodigoProveedor = e.CodigoClienteProveedor
    and nullif(ltrim(rtrim(pr.[$($cfg.Proveedores.Iban)])), '') is not null
) pv
"@
  }
  $efectos = Consultar $servidorBueno @"
select e.CodigoEmpresa, e.[$($cfg.Remesa)] as Remesa, $(Sql-MovEfecto $cfg) as Mov,
  $(if ($cfg.NumeroEfecto) { "e.[$($cfg.NumeroEfecto)]" } else { "cast(null as int)" }) as NumeroEfecto,
  ltrim(rtrim(cast(e.CodigoClienteProveedor as nvarchar(40)))) as Proveedor,
  $(Sql-FacturaEfecto $cfg) as Factura,
  $(Sql-Fecha "e" $cfg.FechaFactura) as FechaFactura,
  cast(e.FechaVencimiento as date) as Vencimiento,
  $(Sql-Numero "e" $cfg.Importe) as Importe,
  isnull(e.ImportePendiente, 0) as Pendiente,
  $iban as Iban
from CarteraEfectos e
join Remesas r on r.CodigoEmpresa = e.CodigoEmpresa and r.NumeroRemesa = e.[$($cfg.Remesa)]
$ibanFicha
where e.CodigoEmpresa not in ($excluidas) and e.Prevision = 'P'
  and r.FechaRemesa >= dateadd(day, -180, getdate())
  $soloPagos
  $(Sql-NoBorrado $cfg);
"@
  $cabeceras = New-Object System.Collections.Generic.List[object]
  foreach ($fila in $remesas.Rows) {
    $cabeceras.Add([PSCustomObject]@{
      companyCode    = [int]$fila["CodigoEmpresa"]
      number         = [int]$fila["NumeroRemesa"]
      remittanceDate = (Fecha-O-Nulo $fila["FechaRemesa"])
      valueDate      = (Fecha-O-Nulo $fila["FechaValor"])
      bankCode       = (Texto $fila["Banco"] 40)
      remittanceType = (Texto-O-Nulo $fila["Tipo"] 20)
      csbNorm        = (Texto-O-Nulo $fila["Norma"] 20)
      total          = (Numero $fila["Total"])
      effects        = [int](Numero $fila["Efectos"])
      provisional    = ((Numero $fila["Provisional"]) -ne 0)
    })
  }
  $lineas = New-Object System.Collections.Generic.List[object]
  foreach ($fila in $efectos.Rows) {
    $lineas.Add([PSCustomObject]@{
      companyCode      = [int]$fila["CodigoEmpresa"]
      remittanceNumber = [int]$fila["Remesa"]
      movementId       = (Texto $fila["Mov"] 60)
      effectNumber     = (Entero-O-Nulo $fila["NumeroEfecto"])
      supplierCode     = (Texto $fila["Proveedor"] 40)
      invoiceNumber    = (Texto-O-Nulo $fila["Factura"] 40)
      invoiceDate      = (Fecha-O-Nulo $fila["FechaFactura"])
      dueDate          = (Fecha-O-Nulo $fila["Vencimiento"])
      amount           = (Numero $fila["Importe"])
      pending          = (Numero $fila["Pendiente"])
      iban             = (Texto-O-Nulo $fila["Iban"] 40)
    })
  }
  return @{ Remesas = $cabeceras; Efectos = $lineas }
}

# Los proveedores con pagos en el último año y pico: los de las remesas y los de la cartera.
function Leer-Proveedores($cfg) {
  $p = $cfg.Proveedores
  # Primero los códigos con pagos (una pasada por la cartera) y luego su ficha.
  $tabla = Consultar $servidorBueno @"
with pagados as (
  select distinct e.CodigoEmpresa, ltrim(rtrim(cast(e.CodigoClienteProveedor as nvarchar(40)))) as Codigo
  from CarteraEfectos e
  where e.Prevision = 'P' and e.CodigoEmpresa not in ($excluidas)
    and e.FechaVencimiento >= dateadd(day, -400, getdate())
)
select pr.CodigoEmpresa, ltrim(rtrim(cast(pr.CodigoProveedor as nvarchar(40)))) as Codigo,
  $(Sql-Texto "pr" $p.Razon 200) as Razon,
  $(Sql-Texto "pr" $p.Nombre 200) as Nombre,
  $(Sql-Texto "pr" $p.Nif 30) as Nif,
  $(Sql-Texto "pr" $p.Domicilio 200) as Domicilio,
  $(Sql-Texto "pr" $p.CodigoPostal 20) as CodigoPostal,
  $(Sql-Texto "pr" $p.Municipio 100) as Municipio,
  $(Sql-Texto "pr" $p.Provincia 100) as Provincia,
  $(Sql-Texto "pr" $p.Nacion 60) as Nacion,
  $(Sql-Texto "pr" $p.Telefono 40) as Telefono,
  $(Sql-Texto "pr" $p.Correo 160) as Correo
from Proveedores pr
join pagados x on x.CodigoEmpresa = pr.CodigoEmpresa and x.Codigo = ltrim(rtrim(cast(pr.CodigoProveedor as nvarchar(40))));
"@
  $lista = New-Object System.Collections.Generic.List[object]
  foreach ($fila in $tabla.Rows) {
    $codigo = Texto $fila["Codigo"] 40
    if ($codigo -eq "") { continue }
    $razon = Texto-O-Nulo $fila["Razon"] 200
    $comercial = Texto-O-Nulo $fila["Nombre"] 200
    $nombre = if ($razon) { $razon } elseif ($comercial) { $comercial } else { "Proveedor $codigo" }
    $lista.Add([PSCustomObject]@{
      companyCode = [int]$fila["CodigoEmpresa"]
      code        = $codigo
      name        = $nombre
      tradeName   = $(if ($comercial -and $comercial -ne $nombre) { $comercial } else { $null })
      nif         = (Texto-O-Nulo $fila["Nif"] 30)
      address     = (Texto-O-Nulo $fila["Domicilio"] 200)
      postalCode  = (Texto-O-Nulo $fila["CodigoPostal"] 20)
      city        = (Texto-O-Nulo $fila["Municipio"] 100)
      province    = (Texto-O-Nulo $fila["Provincia"] 100)
      country     = (Texto-O-Nulo $fila["Nacion"] 60)
      phone       = (Texto-O-Nulo $fila["Telefono"] 40)
      email       = (Texto-O-Nulo $fila["Correo"] 160)
    })
  }
  return ,$lista
}

# NIF y domicilio de cada sociedad: el ordenante del fichero.
function Leer-EmpresasDetalle {
  $nif = Elegir "Empresas" @("CifDni", "CifEuropeo", "Nif")
  $domicilio = Elegir "Empresas" @("Domicilio", "Direccion")
  $cp = Elegir "Empresas" @("CodigoPostal")
  $municipio = Elegir "Empresas" @("Municipio", "Poblacion")
  $provincia = Elegir "Empresas" @("Provincia")
  $tabla = Consultar $servidorBueno @"
select em.CodigoEmpresa,
  $(Sql-Texto "em" $nif 30) as Nif,
  $(Sql-Texto "em" $domicilio 200) as Domicilio,
  $(Sql-Texto "em" $cp 20) as CodigoPostal,
  $(Sql-Texto "em" $municipio 100) as Municipio,
  $(Sql-Texto "em" $provincia 100) as Provincia
from Empresas em
where em.CodigoEmpresa not in ($excluidas);
"@
  $lista = New-Object System.Collections.Generic.List[object]
  foreach ($fila in $tabla.Rows) {
    $lista.Add([PSCustomObject]@{
      companyCode = [int]$fila["CodigoEmpresa"]
      nif         = (Texto-O-Nulo $fila["Nif"] 30)
      address     = (Texto-O-Nulo $fila["Domicilio"] 200)
      postalCode  = (Texto-O-Nulo $fila["CodigoPostal"] 20)
      city        = (Texto-O-Nulo $fila["Municipio"] 100)
      province    = (Texto-O-Nulo $fila["Provincia"] 100)
    })
  }
  return ,$lista
}

# La cartera pendiente de cobros y pagos que vencen entre hace un año y dentro de 13 meses.
function Leer-CarteraPendiente($cfg) {
  $tabla = Consultar $servidorBueno @"
select e.CodigoEmpresa, e.Prevision, $(Sql-MovEfecto $cfg) as Mov,
  ltrim(rtrim(cast(e.CodigoClienteProveedor as nvarchar(40)))) as Tercero,
  $(Sql-FacturaEfecto $cfg) as Factura,
  $(Sql-Fecha "e" $cfg.FechaFactura) as FechaFactura,
  cast(e.FechaVencimiento as date) as Vencimiento,
  $(Sql-Numero "e" $cfg.Importe) as Importe,
  e.ImportePendiente as Pendiente,
  $(if ($cfg.Remesa) { "nullif(e.[$($cfg.Remesa)], 0)" } else { "cast(null as int)" }) as Remesa,
  $(Sql-Texto "e" $cfg.BancoRemesa 40) as Banco,
  $(Sql-Texto "e" $cfg.TipoEfecto 20) as TipoEfecto,
  $(if ($cfg.Impagado) { "case when isnull(e.[$($cfg.Impagado)], 0) <> 0 then 1 else 0 end" } else { "0" }) as Impagado,
  $(Sql-Fecha "e" $cfg.FechaImpagado) as FechaImpagado
from CarteraEfectos e
where e.CodigoEmpresa not in ($excluidas)
  and e.Prevision in ('C', 'P')
  and isnull(e.ImportePendiente, 0) <> 0
  and e.FechaVencimiento >= dateadd(day, -365, getdate())
  and e.FechaVencimiento < dateadd(day, 400, getdate())
  $(Sql-NoBorrado $cfg);
"@
  $lista = New-Object System.Collections.Generic.List[object]
  foreach ($fila in $tabla.Rows) {
    $tercero = Texto $fila["Tercero"] 40
    if ($tercero -eq "") { continue }
    $lista.Add([PSCustomObject]@{
      companyCode      = [int]$fila["CodigoEmpresa"]
      kind             = $(if ((Texto $fila["Prevision"] 1) -eq "C") { "cobro" } else { "pago" })
      movementId       = (Texto-O-Nulo $fila["Mov"] 60)
      counterpartCode  = $tercero
      invoiceNumber    = (Texto-O-Nulo $fila["Factura"] 40)
      invoiceDate      = (Fecha-O-Nulo $fila["FechaFactura"])
      dueDate          = (Fecha-O-Nulo $fila["Vencimiento"])
      amount           = (Numero $fila["Importe"])
      pending          = (Numero $fila["Pendiente"])
      remittanceNumber = (Entero-O-Nulo $fila["Remesa"])
      bankCode         = (Texto-O-Nulo $fila["Banco"] 40)
      effectType       = (Texto-O-Nulo $fila["TipoEfecto"] 20)
      isReturned       = ([int]$fila["Impagado"] -eq 1)
      returnedOn       = (Fecha-O-Nulo $fila["FechaImpagado"])
    })
  }
  return ,$lista
}

# Cómo son las remesas en esta instalación, para ver en el Hub sin entrar en el
# servidor cuáles son de pagos. El 30/09/2026 llegaron remesas de pagos con
# cabecera de tipo "Cobro" o "Descuento" y muchas "Talones" sin ningún pago:
# parece que cobros y pagos comparten numeración. Va como aviso en el envío.
function Resumen-Remesas($cfg) {
  $notas = New-Object System.Collections.Generic.List[string]
  if (-not $cfg.RTipo -or -not $cfg.Remesa) { return ,$notas }
  # SQL Server no deja sumar un exists ni una subconsulta dentro de sum(): las
  # marcas se calculan fila a fila en una tabla derivada y se suman fuera.
  $tabla = Consultar $servidorBueno @"
select x.Tipo, count(*) as Remesas, sum(x.ConCobros) as ConCobros, sum(x.ConPagos) as ConPagos, sum(x.Repetido) as NumeroRepetido
from (
  select isnull(r.[$($cfg.RTipo)], '(sin tipo)') as Tipo,
    case when exists (select 1 from CarteraEfectos e where e.CodigoEmpresa = r.CodigoEmpresa and e.[$($cfg.Remesa)] = r.NumeroRemesa and e.Prevision = 'C') then 1 else 0 end as ConCobros,
    case when exists (select 1 from CarteraEfectos e where e.CodigoEmpresa = r.CodigoEmpresa and e.[$($cfg.Remesa)] = r.NumeroRemesa and e.Prevision = 'P') then 1 else 0 end as ConPagos,
    case when (select count(*) from Remesas r2 where r2.CodigoEmpresa = r.CodigoEmpresa and r2.NumeroRemesa = r.NumeroRemesa) > 1 then 1 else 0 end as Repetido
  from Remesas r
  where r.CodigoEmpresa not in ($excluidas) and r.FechaRemesa >= dateadd(day, -400, getdate())
) x
group by x.Tipo;
"@
  foreach ($f in $tabla.Rows) {
    $notas.Add("remesas tipo $([string]$f['Tipo']): $([int]$f['Remesas']) en 400 dias; $([int]$f['ConCobros']) con cobros, $([int]$f['ConPagos']) con pagos, $([int]$f['NumeroRepetido']) con numero repetido")
  }
  # De los efectos de pago remesados, cuántos están borrados, cuántos ya no
  # tienen nada pendiente y cuántos apuntan a una remesa que no está.
  $borrado = if ($cfg.Borrado) { "case when isnull(e.[$($cfg.Borrado)], 0) <> 0 then 1 else 0 end" } else { "0" }
  $sueltos = Consultar $servidorBueno @"
select count(*) as Efectos, isnull(sum(x.Borrado), 0) as Borrados, isnull(sum(x.Pagado), 0) as Pagados, isnull(sum(x.SinRemesa), 0) as SinRemesa
from (
  select $borrado as Borrado,
    case when isnull(e.ImportePendiente, 0) = 0 then 1 else 0 end as Pagado,
    case when not exists (select 1 from Remesas r where r.CodigoEmpresa = e.CodigoEmpresa and r.NumeroRemesa = e.[$($cfg.Remesa)]) then 1 else 0 end as SinRemesa
  from CarteraEfectos e
  where e.CodigoEmpresa not in ($excluidas) and e.Prevision = 'P' and isnull(e.[$($cfg.Remesa)], 0) > 0
    and e.FechaVencimiento >= dateadd(day, -400, getdate())
) x;
"@
  foreach ($f in $sueltos.Rows) {
    $notas.Add("efectos de pago remesados (400 dias): $([int]$f['Efectos']); borrados $([int]$f['Borrados']), sin nada pendiente $([int]$f['Pagados']), con una remesa que no esta $([int]$f['SinRemesa'])")
  }
  return ,$notas
}

# ---------------------------------------------------------------------------
# Administración: albaranes sin facturar y bancos
# ---------------------------------------------------------------------------
# Lo servido en el último año que sigue sin facturar: es dinero que no se cobra
# hasta que se factura. Los marcados en Sage como "no facturable" y los de
# importe cero no cuentan. La periodicidad dice si el cliente se factura a fin
# de mes: entonces lo de este mes es normal que espere.
function Leer-AlbaranesSinFacturar {
  $t = "CabeceraAlbaranCliente"
  $faltan = Faltan $t @("CodigoEmpresa", "EjercicioAlbaran", "SerieAlbaran", "NumeroAlbaran", "FechaAlbaran", "StatusFacturado")
  if ($faltan.Count -gt 0) { throw "faltan $($faltan -join ', ')" }
  $noFacturable = if (Tiene $t "NoFacturable") { "and isnull(a.NoFacturable, 0) = 0" } else { "" }
  $periodicidad = if (Tiene $t "PeriodicidadFacturas") { "cast(a.PeriodicidadFacturas as nvarchar(20))" } else { "cast(null as nvarchar(20))" }
  $tabla = Consultar $servidorBueno @"
select a.CodigoEmpresa, a.EjercicioAlbaran as Ejercicio, isnull(ltrim(rtrim(a.SerieAlbaran)), '') as Serie, a.NumeroAlbaran as Numero,
  cast(a.FechaAlbaran as date) as Fecha, ltrim(rtrim(cast(a.CodigoCliente as nvarchar(40)))) as Cliente,
  case when a.CodigoComisionista in (0, 9999) then null else a.CodigoComisionista end as Comercial,
  isnull(a.BaseImponible, 0) as Neto, $periodicidad as Periodicidad
from CabeceraAlbaranCliente a
where a.CodigoEmpresa not in ($excluidas)
  and isnull(a.StatusFacturado, 0) = 0
  $noFacturable
  and isnull(a.BaseImponible, 0) <> 0
  and a.FechaAlbaran >= dateadd(day, -365, getdate());
"@
  $lista = New-Object System.Collections.Generic.List[object]
  foreach ($fila in $tabla.Rows) {
    $lista.Add([PSCustomObject]@{
      companyCode   = [int]$fila["CodigoEmpresa"]
      year          = [int]$fila["Ejercicio"]
      series        = (Texto $fila["Serie"] 20)
      number        = [int]$fila["Numero"]
      noteDate      = ([datetime]$fila["Fecha"]).ToString("yyyy-MM-dd")
      customerCode  = (Texto-O-Nulo $fila["Cliente"] 40)
      repCode       = (Entero-O-Nulo $fila["Comercial"])
      netAmount     = (Numero $fila["Neto"])
      billingPeriod = (Texto-O-Nulo $fila["Periodicidad"] 20)
    })
  }
  return ,$lista
}

# Las cuentas de los bancos de cada sociedad: la cuenta contable (572...), que es
# la que usan las remesas, el nombre del banco y la línea de riesgo con lo
# dispuesto.
function Leer-CuentasBanco {
  $t = "BancosConta"
  $faltan = Faltan $t @("CodigoEmpresa", "CodigoCuenta")
  if ($faltan.Count -gt 0) { throw "faltan $($faltan -join ', ')" }
  $nombre = "cast(null as nvarchar(120))"
  if ((Tiene $t "CodigoBanco") -and (@(Faltan "Bancos" @("CodigoBanco", "Banco")).Count -eq 0)) {
    $nombre = "(select top 1 nullif(ltrim(rtrim(cast(b.Banco as nvarchar(120)))), '') from Bancos b where b.CodigoBanco = c.CodigoBanco)"
  }
  $descripcion = "cast(null as nvarchar(160))"
  if (@(Faltan "pwb_Bancos" @("EmpresaID", "CuentaID", "Descripcion")).Count -eq 0) {
    $descripcion = "(select top 1 nullif(ltrim(rtrim(cast(d.Descripcion as nvarchar(160)))), '') from pwb_Bancos d where ltrim(rtrim(d.CuentaID)) = ltrim(rtrim(c.CodigoCuenta)) and ltrim(rtrim(d.EmpresaID)) = cast(c.CodigoEmpresa as nvarchar(10)))"
  }
  $tabla = Consultar $servidorBueno @"
select c.CodigoEmpresa, ltrim(rtrim(cast(c.CodigoCuenta as nvarchar(40)))) as Cuenta,
  $(Sql-Texto "c" (Elegir $t @("CodigoBanco")) 20) as Banco,
  $nombre as NombreBanco,
  $descripcion as Descripcion,
  $(Sql-Texto "c" (Elegir $t @("IBAN")) 40) as Iban,
  $(if (Tiene $t "Riesgo") { "c.Riesgo" } else { "cast(null as decimal(14, 2))" }) as Riesgo,
  $(if (Tiene $t "RiesgoUtilizado") { "c.RiesgoUtilizado" } else { "cast(null as decimal(14, 2))" }) as Dispuesto
from BancosConta c
where c.CodigoEmpresa not in ($excluidas)
  and isnull(ltrim(rtrim(cast(c.CodigoCuenta as nvarchar(40)))), '') <> '';
"@
  $lista = New-Object System.Collections.Generic.List[object]
  foreach ($fila in $tabla.Rows) {
    $lista.Add([PSCustomObject]@{
      companyCode = [int]$fila["CodigoEmpresa"]
      accountCode = (Texto $fila["Cuenta"] 40)
      bankCode    = (Texto-O-Nulo $fila["Banco"] 20)
      bankName    = (Texto-O-Nulo $fila["NombreBanco"] 120)
      description = (Texto-O-Nulo $fila["Descripcion"] 160)
      iban        = (Texto-O-Nulo $fila["Iban"] 40)
      creditLimit = (Numero-O-Nulo $fila["Riesgo"])
      creditUsed  = (Numero-O-Nulo $fila["Dispuesto"])
    })
  }
  return ,$lista
}

# El saldo de cada cuenta de banco día a día (últimos 120 días), de la tabla de
# saldos que rellena Sage. De cada día se queda el último apunte. En la lectura
# larga se cuenta además qué tiene la tabla, para comprobar que está al día.
function Leer-SaldosBanco($avisos, [bool]$conResumen) {
  $t = "pwb_SaldoBanco"
  $faltan = Faltan $t @("EmpresaID", "CuentaContable", "Fecha", "Saldo")
  if ($faltan.Count -gt 0) { throw "faltan $($faltan -join ', ')" }
  $movimiento = if (Tiene $t "MovimientoSaldo") { "isnull(s.MovimientoSaldo, 0)" } else { "0" }
  $orden = if (Tiene $t "SaldoBancoID") { "s.SaldoBancoID desc" } else { "s.Fecha desc" }
  $tabla = Consultar $servidorBueno @"
with filas as (
  select try_cast(ltrim(rtrim(s.EmpresaID)) as smallint) as CodigoEmpresa, ltrim(rtrim(cast(s.CuentaContable as nvarchar(40)))) as Cuenta,
    cast(s.Fecha as date) as Dia, s.Saldo, $movimiento as Movimiento,
    row_number() over (partition by s.EmpresaID, s.CuentaContable, cast(s.Fecha as date) order by $orden) as Orden
  from pwb_SaldoBanco s
  where s.Fecha >= dateadd(day, -120, getdate())
)
select CodigoEmpresa, Cuenta, Dia, max(case when Orden = 1 then Saldo end) as Saldo, sum(Movimiento) as Movimiento
from filas
where CodigoEmpresa is not null and CodigoEmpresa not in ($excluidas) and isnull(Cuenta, '') <> ''
group by CodigoEmpresa, Cuenta, Dia;
"@
  $lista = New-Object System.Collections.Generic.List[object]
  foreach ($fila in $tabla.Rows) {
    $lista.Add([PSCustomObject]@{
      companyCode = [int]$fila["CodigoEmpresa"]
      accountCode = (Texto $fila["Cuenta"] 40)
      day         = ([datetime]$fila["Dia"]).ToString("yyyy-MM-dd")
      balance     = (Numero $fila["Saldo"])
      movement    = (Numero $fila["Movimiento"])
    })
  }
  if ($conResumen) {
    $tipo = if (Tiene $t "TipoDocumento") { "isnull(cast(TipoDocumento as nvarchar(40)), '(sin tipo)')" } else { "'(sin tipo)'" }
    $resumen = Consultar $servidorBueno "select top 6 $tipo as Tipo, count(*) as Filas, min(Fecha) as Desde, max(Fecha) as Hasta from pwb_SaldoBanco group by $tipo order by count(*) desc;"
    foreach ($f in $resumen.Rows) {
      Avisar $avisos "saldos de banco, tipo $([string]$f['Tipo']): $([int]$f['Filas']) filas del $(Fecha-O-Nulo $f['Desde']) al $(Fecha-O-Nulo $f['Hasta'])"
    }
  }
  return ,$lista
}

# ---------------------------------------------------------------------------
# Qué se puede leer en esta instalación
# ---------------------------------------------------------------------------
$cfgPagos = $null
$cfgOfertas = $null
$cfgPedidos = $null
$cfgFamilias = $null
$cfgArticulos = $null
$cfgClientes = $null
$cfgOfertasDetalle = $null
$cfgPedidosDetalle = $null
if (-not $SoloVentas) {
  try { $cfgOfertas = Preparar-Documentos "ofertas" "CabeceraOfertaCliente" "FechaOferta" @("SerieOferta") } catch { Avisar $avisosDeArranque "ofertas: $($_.Exception.Message)" }
  try { $cfgPedidos = Preparar-Documentos "pedidos" "CabeceraPedidoCliente" "FechaPedido" @("SeriePedido") } catch { Avisar $avisosDeArranque "pedidos: $($_.Exception.Message)" }
  try { $cfgFamilias = Preparar-Familias } catch { Avisar $avisosDeArranque "familias: $($_.Exception.Message)" }
  try { $cfgArticulos = Preparar-Articulos } catch { Avisar $avisosDeArranque "articulos: $($_.Exception.Message)" }
  try { $cfgClientes = Preparar-Clientes } catch { Avisar $avisosDeArranque "ficha de clientes: $($_.Exception.Message)" }
  if ($cfgOfertas) { try { $cfgOfertasDetalle = Preparar-OfertasDetalle } catch { Avisar $avisosDeArranque "ofertas una a una: $($_.Exception.Message)" } }
  if ($cfgPedidos) { try { $cfgPedidosDetalle = Preparar-PedidosDetalle } catch { Avisar $avisosDeArranque "pedidos uno a uno: $($_.Exception.Message)" } }
  if ($cfgFamilias -and -not $cfgFamilias.ConArticulo) { Avisar $avisosDeArranque "venta por articulo: las lineas no traen CodigoArticulo" }
  try { $cfgPagos = Preparar-Pagos } catch { Avisar $avisosDeArranque "pagos: $($_.Exception.Message)" }
}

# ---------------------------------------------------------------------------
# El envío. Todo va en bloques pequeños: con años de histórico, mandarlo junto
# no cabe ni en la ruta ni en el tamaño máximo del servidor. Cada envío lleva
# su ventana de fechas y el Hub reescribe justo esa, así que partirlo no cambia
# el resultado. Hay cuatro clases de envío:
#   1. por días: ventas, ofertas y pedidos, compras por cliente, incidencias;
#   2. por meses: lo que se cuenta por mes entero (clientes, artículos...);
#   3. de noche, un repaso de las ofertas y pedidos del último año;
#   4. un anexo: cartera, nombres, tablas de códigos y estructura.
# ---------------------------------------------------------------------------

$inicioVentana = (Get-Date).AddDays(-$Dias).Date
$finVentana = (Get-Date).AddDays(1).Date
$hoy = (Get-Date).ToString("yyyy-MM-dd")
$totalEnviado = 0
$envios = 0
$lecturaLarga = ($Dias -ge 30)

function Nuevo-Envio($desde, $hastaExclusivo) {
  return [ordered]@{
    coveredFrom = $desde.ToString("yyyy-MM-dd")
    coveredTo   = $hastaExclusivo.AddDays(-1).ToString("yyyy-MM-dd")
    takenOn     = $hoy
    companies   = $sociedades
    reps        = $vendedores
  }
}

function Enviar($envio, $etiqueta) {
  if ($SoloProbar) {
    $muestra = Join-Path (Split-Path -Parent $Registro) "agente-sage-muestra.json"
    $envio | ConvertTo-Json -Depth 6 | Set-Content -Path $muestra -Encoding UTF8
    Apuntar "prueba: no se ha enviado nada. Lo de $etiqueta esta en $muestra"
    Terminar 0 "Prueba sin enviar."
  }
  $json = $envio | ConvertTo-Json -Depth 6 -Compress
  # El cuerpo va como UTF-8 explícito: con acentos, dejarlo al azar rompe los
  # nombres de las sociedades.
  $cuerpo = [System.Text.Encoding]::UTF8.GetBytes($json)
  # A ratos el Hub no contesta a tiempo (504) aunque el envío sea pequeño. Cada
  # bloque entra entero o no entra, así que repetirlo no duplica nada: se
  # espera un poco y se vuelve a mandar. Un 4xx no se repite, daría lo mismo.
  $intentos = 4
  for ($intento = 1; $intento -le $intentos; $intento++) {
    try {
      $respuesta = Invoke-RestMethod -Uri $Destino -Method Post -Body $cuerpo `
        -ContentType "application/json; charset=utf-8" `
        -Headers @{ Authorization = "Bearer $Token" } `
        -TimeoutSec 300
      break
    } catch {
      $codigo = 0
      if ($_.Exception.Response) { try { $codigo = [int]$_.Exception.Response.StatusCode } catch { } }
      $repetible = ($codigo -eq 0 -or $codigo -eq 429 -or $codigo -ge 500)
      if (-not $repetible -or $intento -eq $intentos) {
        if ($codigo -eq 413) { Apuntar "ERROR: el envio de $etiqueta pesa $([Math]::Round($cuerpo.Length / 1024)) KB y el Hub admite como mucho unos 4.500 KB" }
        Apuntar "ERROR al enviar $etiqueta : $($_.Exception.Message)"
        if ($_.ErrorDetails -and $_.ErrorDetails.Message) { Apuntar "respuesta: $($_.ErrorDetails.Message)" }
        Terminar 1 "No se pudo enviar $etiqueta al Hub."
      }
      $espera = 20 * $intento
      Apuntar "  $etiqueta : el Hub no contesto ($($_.Exception.Message)). Se repite en $espera s (intento $($intento + 1) de $intentos)"
      Start-Sleep -Seconds $espera
    }
  }
  $script:totalEnviado += [int]$respuesta.rowsWritten
  $script:envios++
  $detalle = ""
  if ($respuesta.written) { $detalle = (($respuesta.written.PSObject.Properties | ForEach-Object { "$($_.Name)=$($_.Value)" }) -join " ") }
  Apuntar "  $etiqueta -> $detalle ($([Math]::Round($cuerpo.Length / 1024)) KB)"
}

# Cada parte va en su propio intento: si una falla, se queda fuera de ese envío
# (y el Hub no toca lo que ya tenía de ella) y las demás siguen.
# (La parte se llama $parte y no $clave: con $clave tapaba la contraseña de Sage.)
function Intentar($envio, $parte, $avisos, $nombre, [scriptblock]$leer) {
  $reloj = [Diagnostics.Stopwatch]::StartNew()
  try { $envio[$parte] = (& $leer) }
  catch { Avisar $avisos "${nombre}: $($_.Exception.Message)" }
  # Lo normal es que cada parte tarde uno o dos segundos. Si una tarda mucho,
  # queda dicho cuál, para no tener que adivinarlo.
  $segundos = [Math]::Round($reloj.Elapsed.TotalSeconds)
  if ($segundos -ge 20) { Apuntar "  $nombre tardo $segundos s" }
}

$avisosPendientes = $true
# Los avisos que salen después (por ejemplo al leer la cartera en el anexo) se
# mandan en el anexo: se recuerda cuántos se enviaron ya.
$avisosEnviados = 0

# ----- 1. Por días -----
$cursor = $inicioVentana
while ($cursor -lt $finVentana) {
  $corte = $cursor.AddDays($DiasPorEnvio)
  if ($corte -gt $finVentana) { $corte = $finVentana }
  # Dos formatos para las mismas fechas. El de SQL Server va sin guiones y se
  # convierte con el estilo 112: con guiones, un servidor configurado en español
  # lee "2026-09-17" como día 2026 y revienta. El otro, con guiones, es el que
  # entiende el Hub.
  $desdeSql = $cursor.ToString("yyyyMMdd")
  $hastaSql = $corte.ToString("yyyyMMdd")
  $etiqueta = "dias $($cursor.ToString('yyyy-MM-dd')) a $($corte.AddDays(-1).ToString('yyyy-MM-dd'))"

  $porAlbaran = Consultar $servidorBueno (Sql-Ventas "FechaAlbaran" "" $desdeSql $hastaSql)
  # Solo los albaranes ya facturados tienen fecha de factura. En Sage el sí/no
  # se guarda como -1, no como 1.
  $porFactura = Consultar $servidorBueno (Sql-Ventas "FechaFactura" "and a.StatusFacturado = -1" $desdeSql $hastaSql)
  $ventas = New-Object System.Collections.Generic.List[object]
  $ventas.AddRange((Filas-Venta $porAlbaran "albaran"))
  $ventas.AddRange((Filas-Venta $porFactura "factura"))

  $envio = Nuevo-Envio $cursor $corte
  $envio.sales = $ventas
  $avisos = New-Object System.Collections.Generic.List[string]
  if ($avisosPendientes) { foreach ($a in $avisosDeArranque) { $avisos.Add($a) }; $avisosPendientes = $false; $avisosEnviados = $avisosDeArranque.Count }

  if ($cfgOfertas) { Intentar $envio "offers" $avisos "ofertas ($etiqueta)" { Filas-Documentos (Consultar $servidorBueno (Sql-Documentos $cfgOfertas $desdeSql $hastaSql)) } }
  if ($cfgPedidos) { Intentar $envio "orders" $avisos "pedidos ($etiqueta)" { Filas-Documentos (Consultar $servidorBueno (Sql-Documentos $cfgPedidos $desdeSql $hastaSql)) } }
  if ($cfgFamilias) { Intentar $envio "familySales" $avisos "familias ($etiqueta)" { Filas-Familias (Consultar $servidorBueno (Sql-Familias $cfgFamilias $desdeSql $hastaSql)) } }
  if ($clientesListos) { Intentar $envio "customerDays" $avisos "compras por cliente ($etiqueta)" { Filas-ClientesDia (Consultar $servidorBueno (Sql-ClientesDia $desdeSql $hastaSql)) } }
  if ($cfgOfertasDetalle) { Intentar $envio "offerDocuments" $avisos "ofertas una a una ($etiqueta)" { Filas-OfertasDetalle (Consultar $servidorBueno (Sql-OfertasDetalle $cfgOfertasDetalle $desdeSql $hastaSql)) } }
  if ($cfgPedidosDetalle) { Intentar $envio "orderDocuments" $avisos "pedidos uno a uno ($etiqueta)" { Filas-PedidosDetalle (Consultar $servidorBueno (Sql-PedidosDetalle $cfgPedidosDetalle $desdeSql $hastaSql)) } }
  if (-not $SoloVentas) { Intentar $envio "incidents" $avisos "abonos e incidencias ($etiqueta)" { Filas-Incidencias (Consultar $servidorBueno (Sql-Incidencias $desdeSql $hastaSql)) } }

  if ($avisos.Count -gt 0) { $envio.notes = $avisos }
  Enviar $envio $etiqueta
  $cursor = $corte
}

# ----- 2. Por meses: los meses que toca la ventana, enteros -----
if (-not $SoloVentas) {
  $mes = (Get-Date -Year $inicioVentana.Year -Month $inicioVentana.Month -Day 1).Date
  $ultimoMes = (Get-Date).Date
  while ($mes -le $ultimoMes) {
    $siguiente = $mes.AddMonths(1)
    $desdeSql = $mes.ToString("yyyyMMdd")
    $hastaSql = $siguiente.ToString("yyyyMMdd")
    $etiqueta = "mes $($mes.ToString('yyyy-MM'))"
    $envio = Nuevo-Envio $mes $siguiente
    $avisos = New-Object System.Collections.Generic.List[string]

    if ($clientesListos) {
      Intentar $envio "customers" $avisos "clientes ($etiqueta)" {
        $tablaClientes = Consultar $servidorBueno (Sql-Clientes $desdeSql $hastaSql)
        $clientes = New-Object System.Collections.Generic.List[object]
        foreach ($fila in $tablaClientes.Rows) {
          $clientes.Add([PSCustomObject]@{
            companyCode     = [int]$fila["CodigoEmpresa"]
            month           = "$([string]$fila["Mes"])-01"
            activeCustomers = [int]$fila["Activos"]
            newCustomers    = [int]$fila["Nuevos"]
          })
        }
        ,$clientes
      }
    }
    if ($cfgFamilias) {
      Intentar $envio "customerFamilies" $avisos "familias por cliente ($etiqueta)" {
        $tabla = Consultar $servidorBueno (Sql-ClientesFamilia $cfgFamilias $desdeSql $hastaSql)
        $lista = New-Object System.Collections.Generic.List[object]
        foreach ($fila in $tabla.Rows) {
          $lista.Add([PSCustomObject]@{
            companyCode    = [int]$fila["CodigoEmpresa"]
            customerCode   = (Texto $fila["Cliente"] 40)
            month          = "$([string]$fila["Mes"])-01"
            familyCode     = (Texto $fila["Familia"] 40)
            netAmount      = (Numero $fila["Neto"])
            costAmount     = (Numero $fila["Coste"])
            netWithoutCost = (Numero $fila["NetoSinCoste"])
            grossAmount    = (Numero-O-Nulo $fila["Bruto"])
          })
        }
        ,$lista
      }
    }
    if ($cfgFamilias -and $cfgFamilias.ConArticulo) {
      Intentar $envio "articleSales" $avisos "venta por articulo ($etiqueta)" {
        $tabla = Consultar $servidorBueno (Sql-ArticulosVenta $cfgFamilias $desdeSql $hastaSql)
        $lista = New-Object System.Collections.Generic.List[object]
        foreach ($fila in $tabla.Rows) {
          $lista.Add([PSCustomObject]@{
            companyCode    = [int]$fila["CodigoEmpresa"]
            month          = "$([string]$fila["Mes"])-01"
            articleCode    = (Texto $fila["Articulo"] 40)
            familyCode     = (Texto $fila["Familia"] 40)
            subfamilyCode  = (Texto $fila["Subfamilia"] 40)
            units          = (Numero $fila["Unidades"])
            documents      = [int]$fila["Documentos"]
            netAmount      = (Numero $fila["Neto"])
            costAmount     = (Numero $fila["Coste"])
            netWithoutCost = (Numero $fila["NetoSinCoste"])
            grossAmount    = (Numero-O-Nulo $fila["Bruto"])
          })
        }
        ,$lista
      }
    }
    if ($cfgArticulos -and $cfgFamilias) {
      Intentar $envio "articleList" $avisos "ficha de articulos ($etiqueta)" {
        $tabla = Consultar $servidorBueno (Sql-ArticulosLista $cfgArticulos $cfgFamilias $desdeSql $hastaSql)
        $lista = New-Object System.Collections.Generic.List[object]
        foreach ($fila in $tabla.Rows) {
          $codigo = Texto $fila["Codigo"] 40
          if ($codigo -eq "") { continue }
          $nombre = Texto $fila["Nombre"] 200
          if ($nombre -eq "") { $nombre = "Articulo $codigo" }
          $lista.Add([PSCustomObject]@{
            companyCode   = [int]$fila["CodigoEmpresa"]
            code          = $codigo
            name          = $nombre
            familyCode    = (Texto-O-Nulo $fila["Familia"] 40)
            subfamilyCode = (Texto-O-Nulo $fila["Subfamilia"] 40)
            brand         = (Texto-O-Nulo $fila["Marca"] 80)
            supplierCode  = (Texto-O-Nulo $fila["Proveedor"] 40)
            manufacturer  = (Texto-O-Nulo $fila["Fabricante"] 80)
            abc           = (Texto-O-Nulo $fila["Abc"] 10)
            createdOn     = (Fecha-O-Nulo $fila["Alta"])
            obsolete      = ([int]$fila["Obsoleto"] -eq 1)
          })
        }
        ,$lista
      }
    }
    if ($cfgClientes) {
      Intentar $envio "customerList" $avisos "ficha de clientes ($etiqueta)" { Filas-ClientesLista (Consultar $servidorBueno (Sql-ClientesLista $cfgClientes $desdeSql $hastaSql)) }
    }

    # Las fichas de artículos y de clientes van aparte y por trozos. En diciembre
    # de 2024 se dieron de alta 12.050 artículos de golpe y el envío del mes pasó
    # de los 4,5 MB que admite el Hub (413): la carga se paraba ahí. Trocearlas es
    # seguro porque el Hub las añade o actualiza, nunca las borra. Lo demás del
    # mes sí va junto: se reescribe entero con lo que llega.
    $fichas = New-Object System.Collections.Generic.List[object]
    foreach ($parte in @("articleList", "customerList")) {
      if ($envio.Contains($parte) -and $null -ne $envio[$parte]) {
        $fichas.Add([PSCustomObject]@{ Parte = $parte; Filas = $envio[$parte] })
        $envio.Remove($parte)
      }
    }
    if ($avisos.Count -gt 0) { $envio.notes = $avisos }
    Enviar $envio $etiqueta
    foreach ($ficha in $fichas) {
      $parte = $ficha.Parte
      $filas = $ficha.Filas
      for ($inicio = 0; $inicio -lt $filas.Count; $inicio += 2000) {
        $fin = [Math]::Min($inicio + 2000, $filas.Count)
        $trozo = New-Object System.Collections.Generic.List[object]
        for ($k = $inicio; $k -lt $fin; $k++) { $trozo.Add($filas[$k]) }
        $envioFichas = Nuevo-Envio $mes $siguiente
        $envioFichas[$parte] = $trozo
        Enviar $envioFichas "$etiqueta, $(if ($parte -eq 'articleList') { 'fichas de articulos' } else { 'fichas de clientes' }) $fin de $($filas.Count)"
      }
    }
    $mes = $siguiente
  }
}

# ----- 3. De noche: repaso de ofertas y pedidos del último año -----
# Una oferta de hace cinco meses puede ganarse hoy. La lectura de cada hora no
# la vería, así que por la noche se repasa todo el año, sin tocar las ventas.
if ($lecturaLarga -and -not $SoloVentas -and ($cfgOfertasDetalle -or $cfgPedidosDetalle) -and $DiasDocumentos -gt $Dias) {
  $cursor = (Get-Date).AddDays(-$DiasDocumentos).Date
  while ($cursor -lt $inicioVentana) {
    $corte = $cursor.AddDays($DiasPorEnvio)
    if ($corte -gt $inicioVentana) { $corte = $inicioVentana }
    $desdeSql = $cursor.ToString("yyyyMMdd")
    $hastaSql = $corte.ToString("yyyyMMdd")
    $etiqueta = "repaso de ofertas y pedidos $($cursor.ToString('yyyy-MM-dd')) a $($corte.AddDays(-1).ToString('yyyy-MM-dd'))"
    $envio = Nuevo-Envio $cursor $corte
    $avisos = New-Object System.Collections.Generic.List[string]
    if ($cfgOfertasDetalle) { Intentar $envio "offerDocuments" $avisos "ofertas una a una ($etiqueta)" { Filas-OfertasDetalle (Consultar $servidorBueno (Sql-OfertasDetalle $cfgOfertasDetalle $desdeSql $hastaSql)) } }
    if ($cfgPedidosDetalle) { Intentar $envio "orderDocuments" $avisos "pedidos uno a uno ($etiqueta)" { Filas-PedidosDetalle (Consultar $servidorBueno (Sql-PedidosDetalle $cfgPedidosDetalle $desdeSql $hastaSql)) } }
    if ($avisos.Count -gt 0) { $envio.notes = $avisos }
    Enviar $envio $etiqueta
    $cursor = $corte
  }
}

# ----- 4. El anexo: fotos del día, nombres y, de noche, códigos y estructura -----
if (-not $SoloVentas) {
  $envio = Nuevo-Envio (Get-Date).Date (Get-Date).Date.AddDays(1)
  $avisos = New-Object System.Collections.Generic.List[string]
  if ($cfgFamilias) {
    Intentar $envio "families" $avisos "nombres de familia" { Leer-NombresFamilia $false }
    Intentar $envio "subfamilies" $avisos "nombres de subfamilia" { Leer-NombresFamilia $true }
    if ($null -eq $envio["subfamilies"]) { $envio.Remove("subfamilies") }
  }
  Intentar $envio "backlog" $avisos "cartera de pedidos" { Leer-Cartera }
  if ($null -eq $envio["backlog"]) { $envio.Remove("backlog") }
  if ($clientesListos) { Intentar $envio "dormant" $avisos "clientes dormidos" { Leer-Dormidos } }
  # Los contactos de los clientes, de noche. Se leen aquí para que, si fallan, el
  # aviso vaya en el anexo; se mandan aparte porque son miles.
  $contactos = $null
  if ($lecturaLarga -or $Reconocer) {
    Intentar $envio "lookups" $avisos "tablas de codigos" { Leer-Codigos }
    Intentar $envio "schema" $avisos "estructura" { Leer-Estructura }
    try { $contactos = Leer-ContactosClientes $avisos } catch { Avisar $avisos "contactos de clientes: $($_.Exception.Message)" }
  }
  if ($null -eq $envio["families"]) { $envio.Remove("families") }
  for ($k = $avisosEnviados; $k -lt $avisosDeArranque.Count; $k++) { if ($avisos.Count -lt 30) { $avisos.Add($avisosDeArranque[$k]) } }
  if ($avisos.Count -gt 0) { $envio.notes = $avisos }
  Enviar $envio "anexo"

  # Por trozos; el primero sustituye a los contactos que había.
  if ($null -ne $contactos) {
    $primero = $true
    for ($inicio = 0; $inicio -lt [Math]::Max($contactos.Count, 1); $inicio += 4000) {
      $envio = Nuevo-Envio (Get-Date).Date (Get-Date).Date.AddDays(1)
      $fin = [Math]::Min($inicio + 4000, $contactos.Count)
      $trozoContactos = New-Object System.Collections.Generic.List[object]
      for ($k = $inicio; $k -lt $fin; $k++) { $trozoContactos.Add($contactos[$k]) }
      $envio.customerContacts = $trozoContactos
      $envio.customerContactsReplace = $primero
      $primero = $false
      Enviar $envio "contactos de clientes ($fin de $($contactos.Count))"
    }
  }
}

# ----- 5. Pagos: remesas de pagos, proveedores y, de noche, la cartera pendiente -----
# Las remesas y los proveedores van en cada lectura (son pocos y así una remesa
# recién hecha en Sage sale enseguida en el Hub). Cada remesa va entera en un
# mismo envío, con todos sus efectos: el Hub la reescribe con lo que llega.
if (-not $SoloVentas -and $cfgPagos) {
  $envio = Nuevo-Envio (Get-Date).Date (Get-Date).Date.AddDays(1)
  $avisos = New-Object System.Collections.Generic.List[string]
  Intentar $envio "companyDetails" $avisos "datos de las sociedades" { Leer-EmpresasDetalle }
  if ($cfgPagos.Proveedores) { Intentar $envio "suppliers" $avisos "proveedores" { Leer-Proveedores $cfgPagos } }
  $remesasPagos = $null
  if ($cfgPagos.ConRemesas -and $cfgPagos.Remesa) {
    try { $remesasPagos = Leer-RemesasPagos $cfgPagos } catch { Avisar $avisos "remesas de pagos: $($_.Exception.Message)" }
  }
  # La cartera pendiente, solo en las lecturas largas (la de la noche): es una
  # foto del día y para la previsión de tesorería basta con una al día. Se lee
  # antes de mandar las remesas para que, si falla, el aviso llegue al Hub con
  # ellas: el 29 y el 30/09 falló y solo quedó dicho en el registro del servidor.
  $cartera = $null
  if ($lecturaLarga -or $Reconocer) {
    Avisar $avisos "agente $VersionAgente"
    try { $cartera = Leer-CarteraPendiente $cfgPagos } catch { Avisar $avisos "cartera pendiente: $($_.Exception.Message)" }
    try { foreach ($nota in (Resumen-Remesas $cfgPagos)) { Avisar $avisos $nota } } catch { Avisar $avisos "resumen de remesas: $($_.Exception.Message)" }
  }
  foreach ($parte in @("companyDetails", "suppliers")) { if ($null -eq $envio[$parte]) { $envio.Remove($parte) } }
  if ($avisos.Count -gt 0) { $envio.notes = $avisos }

  if ($remesasPagos -and $remesasPagos.Remesas.Count -gt 0) {
    # Por trozos de hasta 3000 efectos, sin partir ninguna remesa.
    $porRemesa = @{}
    foreach ($linea in $remesasPagos.Efectos) {
      # Se llama $idRemesa y no $clave: $clave es la contraseña de Sage.
      $idRemesa = "$($linea.companyCode)-$($linea.remittanceNumber)"
      if (-not $porRemesa.ContainsKey($idRemesa)) { $porRemesa[$idRemesa] = New-Object System.Collections.Generic.List[object] }
      $porRemesa[$idRemesa].Add($linea)
    }
    $cabeceras = New-Object System.Collections.Generic.List[object]
    $lineas = New-Object System.Collections.Generic.List[object]
    $trozo = 0
    foreach ($remesa in $remesasPagos.Remesas) {
      $idRemesa = "$($remesa.companyCode)-$($remesa.number)"
      $suyas = if ($porRemesa.ContainsKey($idRemesa)) { $porRemesa[$idRemesa] } else { @() }
      if ($cabeceras.Count -gt 0 -and ($lineas.Count + $suyas.Count) -gt 3000) {
        $envio.paymentRemittances = $cabeceras
        $envio.paymentItems = $lineas
        $trozo++
        Enviar $envio "remesas de pagos ($trozo)"
        $envio = Nuevo-Envio (Get-Date).Date (Get-Date).Date.AddDays(1)
        $cabeceras = New-Object System.Collections.Generic.List[object]
        $lineas = New-Object System.Collections.Generic.List[object]
      }
      $cabeceras.Add($remesa)
      foreach ($l in $suyas) { $lineas.Add($l) }
    }
    $envio.paymentRemittances = $cabeceras
    $envio.paymentItems = $lineas
    $trozo++
    Enviar $envio "remesas de pagos ($trozo)"
  } else {
    Enviar $envio "proveedores y sociedades"
  }

  # La cartera leída arriba, por trozos. Aunque venga vacía se manda: la foto
  # anterior se tiene que borrar igual.
  if ($null -ne $cartera) {
    $primero = $true
    for ($inicio = 0; $inicio -lt [Math]::Max($cartera.Count, 1); $inicio += 4000) {
      $envio = Nuevo-Envio (Get-Date).Date (Get-Date).Date.AddDays(1)
      $fin = [Math]::Min($inicio + 4000, $cartera.Count)
      $trozoCartera = New-Object System.Collections.Generic.List[object]
      for ($k = $inicio; $k -lt $fin; $k++) { $trozoCartera.Add($cartera[$k]) }
      $envio.openItems = $trozoCartera
      # El primer trozo borra la foto anterior; los demás se suman.
      $envio.openItemsReplace = $primero
      $primero = $false
      Enviar $envio "cartera pendiente ($fin de $($cartera.Count))"
    }
  }
}

# ----- 6. Administración: bancos y albaranes sin facturar -----
# En cada lectura: son pocos y así lo que se factura durante el día desaparece
# pronto de la lista. Cada cosa en su intento: si una falla, las demás siguen y
# el aviso llega al Hub.
if (-not $SoloVentas) {
  $envio = Nuevo-Envio (Get-Date).Date (Get-Date).Date.AddDays(1)
  $avisos = New-Object System.Collections.Generic.List[string]
  Intentar $envio "bankAccounts" $avisos "cuentas de banco" { Leer-CuentasBanco }
  if ($null -eq $envio["bankAccounts"]) { $envio.Remove("bankAccounts") }
  $saldos = $null
  try { $saldos = Leer-SaldosBanco $avisos ($lecturaLarga -or $Reconocer) } catch { Avisar $avisos "saldos de banco: $($_.Exception.Message)" }
  if ($null -ne $saldos) {
    $envio.bankBalances = $saldos
    $envio.bankBalancesReplace = $true
  }
  $sinFacturar = $null
  try { $sinFacturar = Leer-AlbaranesSinFacturar } catch { Avisar $avisos "albaranes sin facturar: $($_.Exception.Message)" }
  if ($avisos.Count -gt 0) { $envio.notes = $avisos }
  Enviar $envio "bancos"

  # Los albaranes, por trozos; el primero sustituye a los que había.
  if ($null -ne $sinFacturar) {
    $primero = $true
    for ($inicio = 0; $inicio -lt [Math]::Max($sinFacturar.Count, 1); $inicio += 3000) {
      $envio = Nuevo-Envio (Get-Date).Date (Get-Date).Date.AddDays(1)
      $fin = [Math]::Min($inicio + 3000, $sinFacturar.Count)
      $trozoAlbaranes = New-Object System.Collections.Generic.List[object]
      for ($k = $inicio; $k -lt $fin; $k++) { $trozoAlbaranes.Add($sinFacturar[$k]) }
      $envio.uninvoicedNotes = $trozoAlbaranes
      $envio.uninvoicedNotesReplace = $primero
      $primero = $false
      Enviar $envio "albaranes sin facturar ($fin de $($sinFacturar.Count))"
    }
  }
}

Apuntar "enviado correctamente: $totalEnviado filas de venta en $envios envio(s)"
Terminar 0 "Sage leido: $envios envio(s)."
