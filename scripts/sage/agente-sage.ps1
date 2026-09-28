<#
  AGENTE DE SAGE → COMMERCIAL HUB
  ===============================

  Lee Sage, calcula totales y los envía al Hub.
  Pensado para correr en el propio servidor de Sage como tarea programada.

  Qué envía, siempre en totales:
    - ventas por sociedad, día, serie y comercial (como siempre);
    - ofertas y pedidos por sociedad, día, serie y comercial;
    - venta por familia de artículo y día;
    - clientes activos y nuevos por mes (cuántos, no quiénes);
    - la cartera de pedidos pendientes de servir y cuántos clientes han dejado
      de comprar (una foto al día);
    - los nombres de las columnas de las tablas de Sage que interesan, para
      poder ampliar la lectura sin tener que entrar en el servidor.
  NO envía nombres de clientes, ni artículos, ni documentos, ni precios.

  Qué NO hace: escribir en Sage. Todas las consultas son de solo lectura.

  Si alguna tabla o columna no existe en esta instalación de Sage, esa parte se
  salta, queda apuntado por qué, y las ventas siguen llegando igual.

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
  [string]$Destino = "https://app.suministrointec.com/api/sage/ingest",
  [string]$Token = $env:INTEC_SAGE_TOKEN,
  [string]$Registro = "",
  [switch]$SoloProbar,
  # Manda también la estructura de las tablas aunque sea una lectura corta.
  [switch]$Reconocer,
  # Por si algo de lo nuevo diera guerra: solo ventas, como la versión anterior.
  [switch]$SoloVentas
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

# Un valor de SQL que puede venir vacío (DBNull) pasado a número o a nulo.
function Entero-O-Nulo($valor) {
  if ($valor -eq [DBNull]::Value -or $null -eq $valor) { return $null }
  return [int]$valor
}
function Numero($valor) {
  if ($valor -eq [DBNull]::Value -or $null -eq $valor) { return [double]0 }
  return [double]$valor
}
function Texto($valor, [int]$maximo) {
  if ($valor -eq [DBNull]::Value -or $null -eq $valor) { return "" }
  $limpio = ([string]$valor).Trim()
  if ($limpio.Length -gt $maximo) { $limpio = $limpio.Substring(0, $maximo) }
  return $limpio
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
  sum(case when isnull(a.ImporteCoste, 0) = 0 then isnull(a.BaseImponible, 0) else 0 end) as NetoSinCoste
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
    })
  }
  # La coma evita que PowerShell desenrolle la lista: una lista vacía llegaría
  # como nada y una de un elemento, como un objeto suelto.
  return ,$lista
}

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

# ---------------------------------------------------------------------------
# Lo nuevo. Antes de leer una tabla se mira qué columnas tiene: cada
# instalación de Sage nombra alguna a su manera. Lo que no está se salta, se
# apunta el porqué (llega al Hub como aviso) y las ventas no se enteran.
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
  $unirArticulos = ""
  if ((Columnas "LineasAlbaranCliente").Contains("CodigoFamilia")) {
    $familia = "l.[CodigoFamilia]"
  } elseif ((Columnas "LineasAlbaranCliente").Contains("CodigoArticulo") -and (@(Faltan "Articulos" @("CodigoEmpresa", "CodigoArticulo", "CodigoFamilia")).Count -eq 0)) {
    $familia = "ar.[CodigoFamilia]"
    $unirArticulos = "left join Articulos ar on ar.CodigoEmpresa = l.CodigoEmpresa and ar.CodigoArticulo = l.CodigoArticulo"
  } else {
    Avisar $avisosDeArranque "familias: no se encuentra CodigoFamilia ni en las lineas ni en Articulos"
    return $null
  }

  $unidades = Elegir "LineasAlbaranCliente" @("Unidades", "UnidadesServidas")
  $expUnidades = if ($unidades) { "l.[$unidades]" } else { "0" }
  $expCoste = "0"
  if ((Columnas "LineasAlbaranCliente").Contains("ImporteCoste")) { $expCoste = "l.[ImporteCoste]" }
  elseif ($unidades -and (Columnas "LineasAlbaranCliente").Contains("PrecioCoste")) { $expCoste = "l.[PrecioCoste] * l.[$unidades]" }
  else { Avisar $avisosDeArranque "familias: las lineas no traen coste; se envia la venta sin margen" }

  return @{ Importe = $importe; Familia = $familia; Unir = $unirArticulos; Unidades = $expUnidades; Coste = $expCoste }
}

function Sql-Familias($cfg, $desdeBloque, $hastaBloque) {
  $codigo = "isnull(ltrim(rtrim(cast($($cfg.Familia) as nvarchar(40)))), '')"
  return @"
select a.CodigoEmpresa, cast(a.FechaAlbaran as date) as Dia, $codigo as Familia,
  sum(isnull($($cfg.Unidades), 0)) as Unidades,
  sum(isnull(l.[$($cfg.Importe)], 0)) as Neto,
  sum(isnull($($cfg.Coste), 0)) as Coste,
  -- Lo vendido sin coste grabado: el margen de la familia lo deja fuera.
  sum(case when isnull($($cfg.Coste), 0) = 0 then isnull(l.[$($cfg.Importe)], 0) else 0 end) as NetoSinCoste
from LineasAlbaranCliente l
join CabeceraAlbaranCliente a
  on a.CodigoEmpresa = l.CodigoEmpresa and a.EjercicioAlbaran = l.EjercicioAlbaran
 and a.SerieAlbaran = l.SerieAlbaran and a.NumeroAlbaran = l.NumeroAlbaran
$($cfg.Unir)
where a.FechaAlbaran >= convert(datetime, '$desdeBloque', 112) and a.FechaAlbaran < convert(datetime, '$hastaBloque', 112)
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
    })
  }
  return ,$lista
}

# Los nombres de las familias. En Sage la tabla Familias guarda también las
# subfamilias; la fila de la familia es la que no tiene subfamilia.
function Leer-NombresFamilia {
  $faltan = Faltan "Familias" @("CodigoEmpresa", "CodigoFamilia")
  if ($faltan.Count -gt 0) { Avisar $avisosDeArranque "nombres de familia: faltan $($faltan -join ', ')"; return $null }
  $descripcion = Elegir "Familias" @("Descripcion", "DescripcionFamilia", "Familia", "Nombre")
  if (-not $descripcion) { Avisar $avisosDeArranque "nombres de familia: no hay columna de descripcion"; return $null }
  $filtro = ""
  if ((Columnas "Familias").Contains("CodigoSubfamilia")) { $filtro = "and isnull(ltrim(rtrim(CodigoSubfamilia)), '') in ('', '**********')" }
  $tabla = Consultar $servidorBueno @"
select CodigoEmpresa, ltrim(rtrim(cast(CodigoFamilia as nvarchar(40)))) as Codigo, max(ltrim(rtrim(cast([$descripcion] as nvarchar(160))))) as Nombre
from Familias
where CodigoEmpresa not in ($excluidas) $filtro
group by CodigoEmpresa, ltrim(rtrim(cast(CodigoFamilia as nvarchar(40))));
"@
  $lista = New-Object System.Collections.Generic.List[object]
  foreach ($fila in $tabla.Rows) {
    $nombre = Texto $fila["Nombre"] 160
    if ($nombre -eq "") { continue }
    $lista.Add([PSCustomObject]@{ companyCode = [int]$fila["CodigoEmpresa"]; code = (Texto $fila["Codigo"] 40); name = $nombre })
  }
  return ,$lista
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
# desde entonces nada. Solo cuántos y cuánto compraban, sin nombres.
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
  if ((Columnas "CabeceraPedidoCliente").Contains("CodigoComisionista")) {
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

# --- Estructura: nombres de columnas, para ampliar la lectura sin adivinar ---
# Incluye las tablas de cartera y cobros, que todavía no se leen: con sus
# columnas a la vista se puede preparar esa parte sin entrar en el servidor.
function Leer-Estructura {
  $tabla = Consultar $servidorBueno @"
select top 5000 t.name as Tabla, c.name as Columna, ty.name as Tipo
from sys.tables t
join sys.columns c on c.object_id = t.object_id
join sys.types ty on ty.user_type_id = c.user_type_id
where t.name in ('CabeceraAlbaranCliente', 'LineasAlbaranCliente', 'CabeceraOfertaCliente', 'LineasOfertaCliente',
                 'CabeceraPedidoCliente', 'LineasPedidoCliente', 'Articulos', 'Familias', 'Clientes', 'Comisionistas')
   or t.name like '%Efecto%' or t.name like '%Cartera%' or t.name like '%Cobro%' or t.name like '%Remesa%'
order by t.name, c.column_id;
"@
  $lista = New-Object System.Collections.Generic.List[object]
  foreach ($fila in $tabla.Rows) {
    $lista.Add([PSCustomObject]@{ table = (Texto $fila["Tabla"] 128); column = (Texto $fila["Columna"] 128); type = (Texto $fila["Tipo"] 64) })
  }
  return ,$lista
}

$cfgOfertas = $null
$cfgPedidos = $null
$cfgFamilias = $null
if (-not $SoloVentas) {
  try { $cfgOfertas = Preparar-Documentos "ofertas" "CabeceraOfertaCliente" "FechaOferta" @("SerieOferta") } catch { Avisar $avisosDeArranque "ofertas: $($_.Exception.Message)" }
  try { $cfgPedidos = Preparar-Documentos "pedidos" "CabeceraPedidoCliente" "FechaPedido" @("SeriePedido") } catch { Avisar $avisosDeArranque "pedidos: $($_.Exception.Message)" }
  try { $cfgFamilias = Preparar-Familias } catch { Avisar $avisosDeArranque "familias: $($_.Exception.Message)" }
}

# Lo que se manda una sola vez por ejecución, en el primer bloque.
$nombresFamilia = $null
$cartera = $null
$dormidos = $null
$estructura = $null
if (-not $SoloVentas) {
  if ($cfgFamilias) { try { $nombresFamilia = Leer-NombresFamilia } catch { Avisar $avisosDeArranque "nombres de familia: $($_.Exception.Message)" } }
  try { $cartera = Leer-Cartera } catch { Avisar $avisosDeArranque "cartera de pedidos: $($_.Exception.Message)" }
  if ($clientesListos) { try { $dormidos = Leer-Dormidos } catch { Avisar $avisosDeArranque "clientes dormidos: $($_.Exception.Message)" } }
  # La estructura solo hace falta de vez en cuando: en la lectura de la noche o
  # cuando se pide.
  if ($Reconocer -or $Dias -ge 30) {
    try { $estructura = Leer-Estructura } catch { Avisar $avisosDeArranque "estructura: $($_.Exception.Message)" }
  }
}

# ---------------------------------------------------------------------------
# Se envía por bloques de días, no todo de una vez.
#
# Con años de histórico son decenas de miles de filas, y un envío así no cabe:
# ni en el tope de la ruta ni en el tamaño máximo que admite el servidor. Cada
# bloque lleva su propia ventana de fechas, y el Hub reescribe justo esa, así
# que partirlo no cambia el resultado.
# ---------------------------------------------------------------------------
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$inicioVentana = (Get-Date).AddDays(-$Dias).Date
$finVentana = (Get-Date).AddDays(1).Date
$hoy = (Get-Date).ToString("yyyy-MM-dd")
$totalEnviado = 0
$bloques = 0

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

  $porAlbaran = Consultar $servidorBueno (Sql-Ventas "FechaAlbaran" "" $desdeSql $hastaSql)
  # Solo los albaranes ya facturados tienen fecha de factura. En Sage el sí/no
  # se guarda como -1, no como 1.
  $porFactura = Consultar $servidorBueno (Sql-Ventas "FechaFactura" "and a.StatusFacturado = -1" $desdeSql $hastaSql)

  $ventas = New-Object System.Collections.Generic.List[object]
  $ventas.AddRange((Filas-Venta $porAlbaran "albaran"))
  $ventas.AddRange((Filas-Venta $porFactura "factura"))

  $etiqueta = "$($cursor.ToString('yyyy-MM-dd')) a $($corte.AddDays(-1).ToString('yyyy-MM-dd'))"
  $bloques++

  $envio = [ordered]@{
    coveredFrom = $cursor.ToString("yyyy-MM-dd")
    coveredTo   = $corte.AddDays(-1).ToString("yyyy-MM-dd")
    takenOn     = $hoy
    companies   = $sociedades
    reps        = $vendedores
    sales       = $ventas
  }

  # Cada parte nueva va en su propio intento: si una falla, se queda fuera de
  # este envío (y el Hub no toca lo que ya tenía de ella) y las demás siguen.
  $avisos = New-Object System.Collections.Generic.List[string]
  if ($bloques -eq 1) { foreach ($a in $avisosDeArranque) { $avisos.Add($a) } }

  if ($cfgOfertas) {
    try { $envio.offers = Filas-Documentos (Consultar $servidorBueno (Sql-Documentos $cfgOfertas $desdeSql $hastaSql)) }
    catch { Avisar $avisos "ofertas ($etiqueta): $($_.Exception.Message)" }
  }
  if ($cfgPedidos) {
    try { $envio.orders = Filas-Documentos (Consultar $servidorBueno (Sql-Documentos $cfgPedidos $desdeSql $hastaSql)) }
    catch { Avisar $avisos "pedidos ($etiqueta): $($_.Exception.Message)" }
  }
  if ($cfgFamilias) {
    try { $envio.familySales = Filas-Familias (Consultar $servidorBueno (Sql-Familias $cfgFamilias $desdeSql $hastaSql)) }
    catch { Avisar $avisos "familias ($etiqueta): $($_.Exception.Message)" }
  }
  if ($clientesListos) {
    # Los clientes se cuentan por mes entero, así que se recalculan completos
    # los meses que toca el bloque.
    $mesDesde = (Get-Date -Year $cursor.Year -Month $cursor.Month -Day 1).Date
    $ultimoDia = $corte.AddDays(-1)
    $mesHasta = (Get-Date -Year $ultimoDia.Year -Month $ultimoDia.Month -Day 1).Date.AddMonths(1)
    try {
      $tablaClientes = Consultar $servidorBueno (Sql-Clientes $mesDesde.ToString("yyyyMMdd") $mesHasta.ToString("yyyyMMdd"))
      $clientes = New-Object System.Collections.Generic.List[object]
      foreach ($fila in $tablaClientes.Rows) {
        $clientes.Add([PSCustomObject]@{
          companyCode     = [int]$fila["CodigoEmpresa"]
          month           = "$([string]$fila["Mes"])-01"
          activeCustomers = [int]$fila["Activos"]
          newCustomers    = [int]$fila["Nuevos"]
        })
      }
      $envio.customers = $clientes
    } catch { Avisar $avisos "clientes ($etiqueta): $($_.Exception.Message)" }
  }

  if ($bloques -eq 1) {
    if ($null -ne $nombresFamilia) { $envio.families = $nombresFamilia }
    if ($null -ne $cartera) { $envio.backlog = $cartera }
    if ($null -ne $dormidos) { $envio.dormant = $dormidos }
    if ($null -ne $estructura) { $envio.schema = $estructura }
  }
  if ($avisos.Count -gt 0) { $envio.notes = $avisos }

  if ($SoloProbar) {
    $muestra = Join-Path (Split-Path -Parent $Registro) "agente-sage-muestra.json"
    $envio | ConvertTo-Json -Depth 6 | Set-Content -Path $muestra -Encoding UTF8
    Apuntar "prueba: no se ha enviado nada. Lo del bloque $etiqueta esta en $muestra"
    exit 0
  }

  try {
    $json = $envio | ConvertTo-Json -Depth 6 -Compress
    # El cuerpo va como UTF-8 explícito: con acentos, dejarlo al azar rompe los
    # nombres de las sociedades.
    $cuerpo = [System.Text.Encoding]::UTF8.GetBytes($json)
    $respuesta = Invoke-RestMethod -Uri $Destino -Method Post -Body $cuerpo `
      -ContentType "application/json; charset=utf-8" `
      -Headers @{ Authorization = "Bearer $Token" } `
      -TimeoutSec 300
    $totalEnviado += [int]$respuesta.rowsWritten
    $detalle = ""
    if ($respuesta.written) { $detalle = " | " + (($respuesta.written.PSObject.Properties | ForEach-Object { "$($_.Name)=$($_.Value)" }) -join " ") }
    Apuntar "  $etiqueta -> $($respuesta.rowsWritten) filas de venta ($($ventas.Count) enviadas)$detalle"
  } catch {
    Apuntar "ERROR al enviar el bloque $etiqueta : $($_.Exception.Message)"
    if ($_.ErrorDetails -and $_.ErrorDetails.Message) { Apuntar "respuesta: $($_.ErrorDetails.Message)" }
    exit 1
  }

  $cursor = $corte
}

Apuntar "enviado correctamente: $totalEnviado filas de venta guardadas en $bloques bloque(s)"
exit 0
