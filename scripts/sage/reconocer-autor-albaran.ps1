<#
  SAGE 200 — QUIÉN HACE EL ALBARÁN Y A QUIÉN SE LE CUENTA
  ========================================================

  Un albarán lo hace una persona, pero la venta se le apunta al comercial que
  tiene asignado el cliente (CodigoComisionista). Para ver cuántos albaranes
  hace alguien que se le cuentan a otro hace falta saber quién lo hizo, y esa
  columna no se lee todavía: hay que averiguar cómo se llama en esta
  instalación y qué guarda dentro.

  Esto lo averigua. Enseña en pantalla, y guarda en CSV en el Escritorio:

    1. Las columnas de la cabecera de albarán que tienen pinta de autor
       (usuario, autor, alta, operador...), con su tipo.
    2. Para cada una, los valores más repetidos en los últimos 90 días.
    3. Para cada una, el cruce autor × comercial asignado: cuántos albaranes
       hizo cada autor y a qué comercial se le contaron.
    4. Las tablas de la base que parecen de usuarios, con sus columnas, para
       poder poner nombre a cada autor.
    5. Si la ficha del comercial (Comisionistas) guarda algún usuario, que es
       lo que permitiría saber de quién es cada autor sin apuntarlo a mano.

  No lee importes de clientes ni datos personales de nadie más allá del código
  de usuario que ya va en cada albarán. No escribe nada.

  CÓMO SE USA
  -----------
  En el servidor de Sage, con las mismas variables que el agente (si no las
  hay, entra con la cuenta de Windows):

    powershell -ExecutionPolicy Bypass -File C:\intec\reconocer-autor-albaran.ps1

  Y pásame lo que salga en pantalla, o los CSV de la carpeta del Escritorio.
#>

param(
  [string]$Servidor = "",
  [string]$BaseDeDatos = "Sage",
  [int]$Dias = 90,
  [string]$Salida = ""
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Data

# Las mismas credenciales que el agente, sin pedirlas por pantalla: así la
# contraseña no se teclea ni queda en el historial de la consola.
$UsuarioBD = [Environment]::GetEnvironmentVariable("INTEC_SAGE_DB_USER", "Machine")
$ClaveBD = [Environment]::GetEnvironmentVariable("INTEC_SAGE_DB_PASSWORD", "Machine")

if ($Salida -eq "") {
  $escritorio = [Environment]::GetFolderPath('Desktop')
  if ($escritorio -eq "" -or -not (Test-Path $escritorio)) { $escritorio = Split-Path -Parent $MyInvocation.MyCommand.Path }
  $Salida = Join-Path $escritorio "sage-autor-albaran"
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
  if (-not [string]::IsNullOrWhiteSpace($UsuarioBD)) { return $cadena + "User ID=$UsuarioBD;Password=$ClaveBD;" }
  return $cadena + "Integrated Security=SSPI;"
}

function Consultar($servidor, $sql) {
  $conexion = New-Object System.Data.SqlClient.SqlConnection (Nueva-Cadena $servidor)
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

function Guardar($tabla, $nombre) {
  try { $tabla | Export-Csv -Path (Join-Path $Salida $nombre) -NoTypeInformation -Delimiter ";" -Encoding UTF8 } catch { }
}

function Titulo($texto) {
  Write-Host ""
  Write-Host "=== $texto ===" -ForegroundColor Cyan
}

# ---------------------------------------------------------------------------
$candidatos = if ($Servidor -ne "") { @($Servidor) } else { Buscar-Instancias }
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

# Las palabras que suelen llevar las columnas de autor en Sage.
$patrones = @("%usu%", "%autor%", "%alta%", "%crea%", "%operad%", "%grab%", "%user%", "%modific%")
$filtro = ($patrones | ForEach-Object { "c.name like '$_'" }) -join " or "

# --- 1. Columnas con pinta de autor ---------------------------------------
Titulo "1. COLUMNAS DE CabeceraAlbaranCliente CON PINTA DE AUTOR"
$columnas = Consultar $servidorBueno @"
select c.name as Columna, ty.name as Tipo, c.max_length as Largo
from sys.columns c
join sys.tables t on t.object_id = c.object_id
join sys.types ty on ty.user_type_id = c.user_type_id
where t.name = 'CabeceraAlbaranCliente' and ($filtro)
order by c.column_id;
"@
if ($columnas.Rows.Count -eq 0) {
  Write-Host "  Ninguna. Se listan todas las columnas para buscarla a ojo." -ForegroundColor Yellow
  $todas = Consultar $servidorBueno "select c.name as Columna, ty.name as Tipo from sys.columns c join sys.tables t on t.object_id = c.object_id join sys.types ty on ty.user_type_id = c.user_type_id where t.name = 'CabeceraAlbaranCliente' order by c.column_id;"
  foreach ($fila in $todas.Rows) { Write-Host ("  {0,-40} {1}" -f $fila["Columna"], $fila["Tipo"]) }
  Guardar $todas "columnas-albaran-todas.csv"
} else {
  foreach ($fila in $columnas.Rows) { Write-Host ("  {0,-40} {1,-12} {2}" -f $fila["Columna"], $fila["Tipo"], $fila["Largo"]) }
  Guardar $columnas "columnas-autor.csv"
}

# --- 2 y 3. Valores y cruce con el comercial asignado ---------------------
$tieneComisionista = (Consultar $servidorBueno "select count(*) as n from sys.columns c join sys.tables t on t.object_id = c.object_id where t.name = 'CabeceraAlbaranCliente' and c.name = 'CodigoComisionista';").Rows[0]["n"] -gt 0
$desde = (Get-Date).AddDays(-$Dias).ToString("yyyy-MM-dd")
foreach ($fila in $columnas.Rows) {
  $col = $fila["Columna"]
  Titulo "2. VALORES DE [$col] EN LOS ÚLTIMOS $Dias DÍAS"
  try {
    $valores = Consultar $servidorBueno @"
select top 20 cast([$col] as nvarchar(100)) as Valor, count(*) as Albaranes
from CabeceraAlbaranCliente
where FechaAlbaran >= '$desde'
group by cast([$col] as nvarchar(100))
order by count(*) desc;
"@
    foreach ($v in $valores.Rows) { Write-Host ("  {0,-30} {1,8}" -f $v["Valor"], $v["Albaranes"]) }
    Guardar $valores "valores-$col.csv"
  } catch { Write-Host "  no se pudo: $($_.Exception.Message)" -ForegroundColor Yellow }

  if ($tieneComisionista) {
    Titulo "3. [$col] × COMERCIAL ASIGNADO (CodigoComisionista)"
    try {
      $cruce = Consultar $servidorBueno @"
select top 40
  CodigoEmpresa,
  cast([$col] as nvarchar(100)) as Autor,
  CodigoComisionista as ComercialAsignado,
  count(*) as Albaranes
from CabeceraAlbaranCliente
where FechaAlbaran >= '$desde'
group by CodigoEmpresa, cast([$col] as nvarchar(100)), CodigoComisionista
order by count(*) desc;
"@
      foreach ($c in $cruce.Rows) { Write-Host ("  empresa {0,-3} autor {1,-25} -> comercial {2,-6} {3,6} albaranes" -f $c["CodigoEmpresa"], $c["Autor"], $c["ComercialAsignado"], $c["Albaranes"]) }
      Guardar $cruce "cruce-$col.csv"
    } catch { Write-Host "  no se pudo: $($_.Exception.Message)" -ForegroundColor Yellow }
  }
}

# --- 4. Tablas que parecen de usuarios ------------------------------------
Titulo "4. TABLAS QUE PARECEN DE USUARIOS"
$tablasUsuarios = Consultar $servidorBueno @"
select t.name as Tabla, c.name as Columna, ty.name as Tipo
from sys.tables t
join sys.columns c on c.object_id = t.object_id
join sys.types ty on ty.user_type_id = c.user_type_id
where t.name like '%usuario%' or t.name like '%user%' or t.name like '%operador%'
order by t.name, c.column_id;
"@
if ($tablasUsuarios.Rows.Count -eq 0) { Write-Host "  Ninguna en esta base: puede que los usuarios vivan en la base del sistema de Sage." -ForegroundColor Yellow }
$ultima = ""
foreach ($fila in $tablasUsuarios.Rows) {
  if ($fila["Tabla"] -ne $ultima) { Write-Host "  [$($fila["Tabla"])]" -ForegroundColor White; $ultima = $fila["Tabla"] }
  Write-Host ("      {0,-36} {1}" -f $fila["Columna"], $fila["Tipo"])
}
Guardar $tablasUsuarios "tablas-de-usuarios.csv"

# --- 5. ¿La ficha del comercial guarda un usuario? ------------------------
Titulo "5. COLUMNAS DE Comisionistas QUE PUEDEN SER UN USUARIO"
$enComisionistas = Consultar $servidorBueno @"
select c.name as Columna, ty.name as Tipo
from sys.columns c
join sys.tables t on t.object_id = c.object_id
join sys.types ty on ty.user_type_id = c.user_type_id
where t.name = 'Comisionistas' and ($filtro)
order by c.column_id;
"@
if ($enComisionistas.Rows.Count -eq 0) { Write-Host "  Ninguna: el enlace autor -> comercial habrá que apuntarlo en el Hub." -ForegroundColor Yellow }
foreach ($fila in $enComisionistas.Rows) { Write-Host ("  {0,-40} {1}" -f $fila["Columna"], $fila["Tipo"]) }
Guardar $enComisionistas "comisionistas-usuario.csv"

Write-Host ""
Write-Host "=======================================================" -ForegroundColor Green
Write-Host " Guardado en: $Salida" -ForegroundColor Green
Write-Host " No se ha escrito nada en Sage." -ForegroundColor Green
Write-Host "=======================================================" -ForegroundColor Green
Write-Host ""
Read-Host "Pulsa Intro para cerrar"
