<#
  RECONOCIMIENTO DE SAGE 200 desde PowerShell
  ===========================================

  Qué hace: se conecta al SQL Server donde vive Sage y apunta cómo se llaman
  las tablas, qué columnas tienen y cuántas filas hay en cada una. Deja cuatro
  CSV en el Escritorio.

  Qué NO hace: no lee ni un dato de cliente, de venta o de precio, y no escribe
  nada. Son consultas de solo lectura contra el catálogo de la base de datos,
  las mismas que enseña Management Studio en el panel de la izquierda.

  No hace falta instalar nada: usa las librerías que ya trae Windows.

  CÓMO SE USA
  -----------
  1. Copia este archivo al servidor de Sage (por escritorio remoto).
  2. Botón derecho sobre el archivo > "Ejecutar con PowerShell".

     Si Windows se queja de que los scripts están bloqueados, abre PowerShell
     y lanza esto otro, que salta el bloqueo solo para esta vez:

       powershell -ExecutionPolicy Bypass -File C:\ruta\reconocimiento-sage.ps1

  3. Al terminar, en el Escritorio aparece la carpeta "reconocimiento-sage"
     con los CSV. Esos son los que hay que enviar.

  SI NO ENCUENTRA EL SERVIDOR
  ---------------------------
  Míralo en Power BI, que ya está conectado:
  Inicio > Transformar datos > Configuración del origen de datos. Ahí aparece
  el nombre del servidor. Luego lánzalo así:

    powershell -ExecutionPolicy Bypass -File C:\ruta\reconocimiento-sage.ps1 -Servidor "NOMBRE\INSTANCIA"

  Si Power BI entra con usuario y contraseña de SQL Server en vez de con la
  cuenta de Windows, añade también:  -Usuario "nombre" -Clave "la clave"
#>

param(
  [string]$Servidor = "",
  [string]$Usuario = "",
  [string]$Clave = "",
  [string]$Salida = "$env:USERPROFILE\Desktop\reconocimiento-sage"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Data

# ---------------------------------------------------------------------------
# Instancias de SQL Server instaladas en esta máquina, según el registro.
# ---------------------------------------------------------------------------
function Buscar-Instancias {
  $encontradas = @()
  $ruta = "HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\Instance Names\SQL"
  if (Test-Path $ruta) {
    $propiedades = (Get-ItemProperty $ruta).PSObject.Properties
    foreach ($propiedad in $propiedades) {
      if ($propiedad.Name -like "PS*") { continue }
      if ($propiedad.Name -eq "MSSQLSERVER") {
        $encontradas += $env:COMPUTERNAME
      } else {
        $encontradas += "$env:COMPUTERNAME\$($propiedad.Name)"
      }
    }
  }
  if ($encontradas.Count -eq 0) { $encontradas = @("localhost", ".\SQLEXPRESS") }
  return $encontradas
}

function Nueva-Cadena($servidor, $baseDeDatos) {
  $cadena = "Server=$servidor;Database=$baseDeDatos;Connect Timeout=8;Application Name=Reconocimiento Intec;"
  if ($Usuario -ne "") {
    return $cadena + "User ID=$Usuario;Password=$Clave;"
  }
  return $cadena + "Integrated Security=SSPI;"
}

# Devuelve una DataTable. La coma delante evita que PowerShell la desmonte en filas.
function Consultar($servidor, $baseDeDatos, $sql) {
  $conexion = New-Object System.Data.SqlClient.SqlConnection (Nueva-Cadena $servidor $baseDeDatos)
  try {
    $conexion.Open()
    $comando = $conexion.CreateCommand()
    $comando.CommandText = $sql
    $comando.CommandTimeout = 180
    $adaptador = New-Object System.Data.SqlClient.SqlDataAdapter $comando
    $tabla = New-Object System.Data.DataTable
    [void]$adaptador.Fill($tabla)
    return ,$tabla
  } finally {
    $conexion.Close()
  }
}

# ---------------------------------------------------------------------------
# 1. Encontrar un servidor al que se pueda entrar
# ---------------------------------------------------------------------------
$candidatos = @()
if ($Servidor -ne "") { $candidatos = @($Servidor) } else { $candidatos = Buscar-Instancias }

Write-Host ""
Write-Host "Buscando el servidor de Sage..." -ForegroundColor Cyan

$servidorBueno = ""
foreach ($candidato in $candidatos) {
  try {
    [void](Consultar $candidato "master" "select 1")
    $servidorBueno = $candidato
    Write-Host "  Conectado a: $candidato" -ForegroundColor Green
    break
  } catch {
    Write-Host "  $candidato -> no responde" -ForegroundColor DarkGray
  }
}

if ($servidorBueno -eq "") {
  Write-Host ""
  Write-Host "No se ha podido conectar con ningun servidor." -ForegroundColor Red
  Write-Host "Mira el nombre en Power BI (Transformar datos > Configuracion del origen de datos)"
  Write-Host "y vuelve a lanzarlo con:  -Servidor ""NOMBRE\INSTANCIA""" -ForegroundColor Yellow
  exit 1
}

# ---------------------------------------------------------------------------
# 2. Las bases de datos de las empresas
# ---------------------------------------------------------------------------
$sqlBases = @"
select name
from sys.databases
where database_id > 4 and state = 0 and has_dbaccess(name) = 1
order by name;
"@

$bases = Consultar $servidorBueno "master" $sqlBases
Write-Host "  Bases de datos accesibles: $($bases.Rows.Count)" -ForegroundColor Green

$sqlTablas = @"
select s.name as esquema, t.name as tabla, sum(p.rows) as filas
from sys.tables t
join sys.schemas s on s.schema_id = t.schema_id
join sys.partitions p on p.object_id = t.object_id and p.index_id in (0, 1)
where t.name like '%Pedido%' or t.name like '%Albaran%' or t.name like '%Factura%'
   or t.name like '%Client%'  or t.name like '%Articulo%' or t.name like '%Presupuesto%'
   or t.name like '%Oferta%'  or t.name like '%Vendedor%' or t.name like '%Comercial%'
   or t.name like '%Familia%' or t.name like '%Serie%'    or t.name like '%Almacen%'
group by s.name, t.name
having sum(p.rows) > 0
order by sum(p.rows) desc;
"@

$sqlColumnas = @"
with grandes as (
  select top (10) t.object_id, t.name
  from sys.tables t
  join sys.partitions p on p.object_id = t.object_id and p.index_id in (0, 1)
  where t.name like '%Pedido%' or t.name like '%Albaran%' or t.name like '%Factura%'
     or t.name like '%Client%'  or t.name like '%Articulo%'
  group by t.object_id, t.name
  order by sum(p.rows) desc
)
select g.name as tabla, c.column_id as orden, c.name as columna, ty.name as tipo
from grandes g
join sys.columns c on c.object_id = g.object_id
join sys.types ty on ty.user_type_id = c.user_type_id
order by g.name, c.column_id;
"@

$resumen = @()
$tablas = @()
$columnas = @()
$fallos = @()

foreach ($fila in $bases.Rows) {
  $base = $fila["name"]
  Write-Host "  Mirando $base..." -NoNewline
  try {
    $t = Consultar $servidorBueno $base $sqlTablas
    foreach ($r in $t.Rows) {
      $tablas += [PSCustomObject]@{ base_de_datos = $base; esquema = $r["esquema"]; tabla = $r["tabla"]; filas = $r["filas"] }
    }
    $c = Consultar $servidorBueno $base $sqlColumnas
    foreach ($r in $c.Rows) {
      $columnas += [PSCustomObject]@{ base_de_datos = $base; tabla = $r["tabla"]; orden = $r["orden"]; columna = $r["columna"]; tipo = $r["tipo"] }
    }
    $totalFilas = 0
    foreach ($r in $t.Rows) { $totalFilas += [int64]$r["filas"] }
    $resumen += [PSCustomObject]@{ base_de_datos = $base; tablas_de_interes = $t.Rows.Count; filas_en_total = $totalFilas; estado = "ok" }
    Write-Host " $($t.Rows.Count) tablas" -ForegroundColor Green
  } catch {
    $fallos += [PSCustomObject]@{ base_de_datos = $base; motivo = $_.Exception.Message }
    $resumen += [PSCustomObject]@{ base_de_datos = $base; tablas_de_interes = 0; filas_en_total = 0; estado = "NO SE PUDO LEER" }
    Write-Host " no se pudo leer" -ForegroundColor Yellow
  }
}

# ---------------------------------------------------------------------------
# 3. Dejar los CSV donde se puedan encontrar
# ---------------------------------------------------------------------------
if (-not (Test-Path $Salida)) { New-Item -ItemType Directory -Path $Salida -Force | Out-Null }

# Punto y coma y UTF-8 para que Excel en español los abra bien de un doble clic.
$resumen  | Export-Csv -Path (Join-Path $Salida "1-bases.csv")    -NoTypeInformation -Delimiter ";" -Encoding UTF8
$tablas   | Export-Csv -Path (Join-Path $Salida "2-tablas.csv")   -NoTypeInformation -Delimiter ";" -Encoding UTF8
$columnas | Export-Csv -Path (Join-Path $Salida "3-columnas.csv") -NoTypeInformation -Delimiter ";" -Encoding UTF8
if ($fallos.Count -gt 0) {
  $fallos | Export-Csv -Path (Join-Path $Salida "4-fallos.csv") -NoTypeInformation -Delimiter ";" -Encoding UTF8
}

Write-Host ""
Write-Host "Listo." -ForegroundColor Cyan
Write-Host "  Servidor:   $servidorBueno"
Write-Host "  Empresas:   $($resumen.Count)"
Write-Host "  Tablas:     $($tablas.Count)"
Write-Host "  Columnas:   $($columnas.Count)"
Write-Host ""
Write-Host "Los CSV estan en: $Salida" -ForegroundColor Green
Write-Host "Envia esa carpeta entera."
Write-Host ""
Read-Host "Pulsa Intro para cerrar"
