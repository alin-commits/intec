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

    6. El cruce con nombres a partir de _TS_SysUsuario, que la primera
       pasada encontró como la columna del autor: quién hizo cada albarán
       (su nombre en Sage) y a qué comercial se le apuntó.
    7. Los usuarios de Sage, con su código, su nombre y si están activos,
       para apuntar en el Hub qué usuario es cada comercial.

  De lsysUsuarios solo se leen el código, el nombre, el apodo y si está
  activo: esa tabla guarda también contraseñas y tokens, y esas columnas no se
  tocan. No lee importes de clientes. No escribe nada.

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
# La fecha va como yyyyMMdd y con el estilo 112, igual que en el agente: con
# el servidor en español, '2026-07-31' se lee como día 7 del mes 31 y la
# consulta entera falla. Fue lo que dejó sin datos los pasos 2 y 3 la primera vez.
$desde = (Get-Date).AddDays(-$Dias).ToString("yyyyMMdd")
$desdeSql = "convert(datetime, '$desde', 112)"
foreach ($fila in $columnas.Rows) {
  $col = $fila["Columna"]
  Titulo "2. VALORES DE [$col] EN LOS ÚLTIMOS $Dias DÍAS"
  try {
    $valores = Consultar $servidorBueno @"
select top 20 cast([$col] as nvarchar(100)) as Valor, count(*) as Albaranes
from CabeceraAlbaranCliente
where FechaAlbaran >= $desdeSql
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
where FechaAlbaran >= $desdeSql
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

# --- 6. Quién hizo el albarán y a quién se le apuntó, con nombres ---------
function Existe-Tabla($tabla) { return (Consultar $servidorBueno "select count(*) as n from sys.tables where name = '$tabla';").Rows[0]["n"] -gt 0 }
function Existe-Columna($tabla, $columna) { return (Consultar $servidorBueno "select count(*) as n from sys.columns c join sys.tables t on t.object_id = c.object_id where t.name = '$tabla' and c.name = '$columna';").Rows[0]["n"] -gt 0 }

# El nombre del comercial: la primera columna de texto con algo escrito, igual
# que hacen el agente y nombres.ps1, porque en cada instalación se llama distinto.
$columnasComercial = Consultar $servidorBueno @"
select c.name from sys.columns c join sys.tables t on t.object_id = c.object_id
join sys.types ty on ty.user_type_id = c.user_type_id
where t.name = 'Comisionistas' and ty.name in ('varchar', 'nvarchar', 'char', 'nchar') and c.max_length >= 10
order by c.column_id;
"@
$trozos = @()
foreach ($fila in $columnasComercial.Rows) {
  $trozos += "nullif(ltrim(rtrim(cast(c.[$($fila["name"])] as nvarchar(200)))), '')"
  if ($trozos.Count -ge 8) { break }
}
$nombreComercial = if ($trozos.Count -gt 0) { "coalesce(" + ($trozos -join ", ") + ", 'Sin nombre')" } else { "'Sin nombre'" }

if ((Existe-Columna "CabeceraAlbaranCliente" "_TS_SysUsuario") -and $tieneComisionista) {
  $hayUsuarios = Existe-Tabla "lsysUsuarios"
  $nombreUsuario = if ($hayUsuarios) { "coalesce(nullif(ltrim(rtrim(u.sysNickName)), ''), nullif(ltrim(rtrim(u.sysUserName)), ''), 'Sin nombre')" } else { "'Sin nombre'" }
  $joinUsuarios = if ($hayUsuarios) { "left join lsysUsuarios u on u.sysUsuario = a._TS_SysUsuario" } else { "" }

  Titulo "6. QUIÉN HIZO EL ALBARÁN (_TS_SysUsuario) Y A QUIÉN SE LE APUNTÓ — ÚLTIMOS $Dias DÍAS"
  try {
    $cobertura = Consultar $servidorBueno @"
select count(*) as Total,
  sum(case when a._TS_SysUsuario is null or a._TS_SysUsuario = 0 then 1 else 0 end) as SinAutor
from CabeceraAlbaranCliente a
where a.FechaAlbaran >= $desdeSql;
"@
    $fila = $cobertura.Rows[0]
    Write-Host ("  {0} albaranes, {1} sin autor apuntado" -f $fila["Total"], $fila["SinAutor"]) -ForegroundColor White
    $cruceNombres = Consultar $servidorBueno @"
select top 80
  a.CodigoEmpresa as Empresa,
  a._TS_SysUsuario as Usuario,
  $nombreUsuario as QuienLoHizo,
  a.CodigoComisionista as Comercial,
  $nombreComercial as SeLeApuntaA,
  count(*) as Albaranes
from CabeceraAlbaranCliente a
$joinUsuarios
left join Comisionistas c on c.CodigoEmpresa = a.CodigoEmpresa and c.CodigoComisionista = a.CodigoComisionista
where a.FechaAlbaran >= $desdeSql
group by a.CodigoEmpresa, a._TS_SysUsuario, $nombreUsuario, a.CodigoComisionista, $nombreComercial
order by count(*) desc;
"@
    foreach ($c in $cruceNombres.Rows) {
      Write-Host ("  empresa {0,-2} {1,-22} -> {2,-26} {3,6} albaranes" -f $c["Empresa"], ("{0} ({1})" -f $c["QuienLoHizo"], $c["Usuario"]), ("{0} ({1})" -f $c["SeLeApuntaA"], $c["Comercial"]), $c["Albaranes"])
    }
    Guardar $cruceNombres "cruce-con-nombres.csv"
  } catch { Write-Host "  no se pudo: $($_.Exception.Message)" -ForegroundColor Yellow }

  # --- 7. Los usuarios de Sage, para apuntar quién es cada comercial ---------
  if ($hayUsuarios) {
    Titulo "7. USUARIOS DE SAGE (solo código, nombre y si está activo)"
    try {
      $usuarios = Consultar $servidorBueno "select sysUsuario as Usuario, sysUserName as Nombre, sysNickName as Apodo, sysActivo as Activo from lsysUsuarios order by sysUsuario;"
      foreach ($u in $usuarios.Rows) { Write-Host ("  {0,-6} {1,-30} {2,-20} activo={3}" -f $u["Usuario"], $u["Nombre"], $u["Apodo"], $u["Activo"]) }
      Guardar $usuarios "usuarios-sage.csv"
    } catch { Write-Host "  no se pudo: $($_.Exception.Message)" -ForegroundColor Yellow }
  }
} else {
  Titulo "6. NO HAY _TS_SysUsuario: el autor habrá que buscarlo en las columnas del paso 1"
}

Write-Host ""
Write-Host "=======================================================" -ForegroundColor Green
Write-Host " Guardado en: $Salida" -ForegroundColor Green
Write-Host " No se ha escrito nada en Sage." -ForegroundColor Green
Write-Host "=======================================================" -ForegroundColor Green
Write-Host ""
Read-Host "Pulsa Intro para cerrar"
