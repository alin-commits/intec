<#
  CREAR EL USUARIO DE SOLO LECTURA, DESDE POWERSHELL
  ==================================================

  Hace lo mismo que usuario-solo-lectura.sql, pero sin necesitar Management
  Studio. Crea la cuenta con la que el agente entra en Sage: solo puede leer.

  LA CONTRASEÑA NO SE ESCRIBE AQUÍ. El script la coge de las variables del
  sistema que ya pusiste con setx:

    INTEC_SAGE_DB_USER       (por ejemplo, intec_lectura)
    INTEC_SAGE_DB_PASSWORD

  Así no queda escrita en ningún archivo ni en el historial de la consola.

  CÓMO SE USA
  -----------
  En el servidor de Sage, en una consola de PowerShell COMO ADMINISTRADOR
  (la de tu usuario de Windows tiene que ser administrador de SQL Server):

    powershell -ExecutionPolicy Bypass -File C:\intec\crear-usuario-lectura.ps1

  Si la cuenta ya existe, le cambia la contraseña por la de la variable en vez
  de fallar, así que se puede volver a lanzar sin miedo.
#>

param(
  [string]$Servidor = "",
  [string]$BaseDeDatos = "Sage",
  [string]$Cuenta = $env:INTEC_SAGE_DB_USER,
  [string]$Contrasena = $env:INTEC_SAGE_DB_PASSWORD
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Data

if ([string]::IsNullOrWhiteSpace($Cuenta) -or [string]::IsNullOrWhiteSpace($Contrasena)) {
  Write-Host ""
  Write-Host "Faltan las variables del sistema. Ponlas primero, como administrador:" -ForegroundColor Red
  Write-Host '  setx /M INTEC_SAGE_DB_USER "intec_lectura"'
  Write-Host '  setx /M INTEC_SAGE_DB_PASSWORD "la-contrasena"'
  Write-Host "Y cierra y abre la consola para que existan." -ForegroundColor Yellow
  Read-Host "Pulsa Intro para cerrar"
  exit 1
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

# Se entra con la cuenta de Windows: para crear usuarios hay que ser
# administrador de SQL Server, y el agente todavía no existe.
function Ejecutar($servidor, $baseDeDatos, $sql) {
  $conexion = New-Object System.Data.SqlClient.SqlConnection "Server=$servidor;Database=$baseDeDatos;Integrated Security=SSPI;Connect Timeout=10;Application Name=Alta Intec;"
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

Write-Host ""
$candidatos = @()
if ($Servidor -ne "") { $candidatos = @($Servidor) } else { $candidatos = Buscar-Instancias }
$servidorBueno = ""
foreach ($candidato in $candidatos) {
  try { [void](Ejecutar $candidato "master" "select 1"); $servidorBueno = $candidato; break } catch { }
}
if ($servidorBueno -eq "") {
  Write-Host "No se pudo conectar a SQL Server. Pasa el nombre con -Servidor ""NOMBRE\INSTANCIA""" -ForegroundColor Red
  Read-Host "Pulsa Intro para cerrar"
  exit 1
}
Write-Host "Conectado a $servidorBueno" -ForegroundColor Green

# Una comilla dentro de la contraseña rompería la sentencia; se duplica, que es
# como se escapa en SQL Server.
$claveSql = $Contrasena.Replace("'", "''")
$cuentaSql = $Cuenta.Replace("]", "]]")

try {
  Write-Host "Creando la cuenta..." -NoNewline
  Ejecutar $servidorBueno "master" @"
if not exists (select 1 from sys.server_principals where name = N'$($Cuenta.Replace("'", "''"))')
  create login [$cuentaSql] with password = N'$claveSql', check_policy = on, default_database = [$BaseDeDatos];
else
  alter login [$cuentaSql] with password = N'$claveSql';
"@ | Out-Null
  Write-Host " hecha" -ForegroundColor Green

  Write-Host "Dandole permiso de lectura en $BaseDeDatos..." -NoNewline
  Ejecutar $servidorBueno $BaseDeDatos @"
if not exists (select 1 from sys.database_principals where name = N'$($Cuenta.Replace("'", "''"))')
  create user [$cuentaSql] for login [$cuentaSql];
alter role db_datareader add member [$cuentaSql];
grant view definition to [$cuentaSql];
"@ | Out-Null
  Write-Host " hecho" -ForegroundColor Green
} catch {
  Write-Host ""
  Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "Si dice que no tienes permiso, tu usuario de Windows no es administrador de SQL Server." -ForegroundColor Yellow
  Read-Host "Pulsa Intro para cerrar"
  exit 1
}

# ---------------------------------------------------------------------------
# Comprobar que ha quedado solo con lectura
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "=== ROLES DE LA CUENTA ===" -ForegroundColor Cyan
$roles = Ejecutar $servidorBueno $BaseDeDatos @"
select rol.name as rol
from sys.database_role_members m
join sys.database_principals rol on rol.principal_id = m.role_principal_id
join sys.database_principals usuario on usuario.principal_id = m.member_principal_id
where usuario.name = N'$($Cuenta.Replace("'", "''"))';
"@
$peligrosos = @()
foreach ($fila in $roles.Rows) {
  $nombre = [string]$fila["rol"]
  Write-Host "  $nombre"
  if ($nombre -match "datawriter|ddladmin|owner|securityadmin|accessadmin") { $peligrosos += $nombre }
}
if ($roles.Rows.Count -eq 0) { Write-Host "  (ninguno: algo ha fallado)" -ForegroundColor Yellow }

Write-Host ""
if ($peligrosos.Count -gt 0) {
  Write-Host "CUIDADO: la cuenta tiene permisos de escritura ($($peligrosos -join ', '))." -ForegroundColor Red
  Write-Host "Deberia tener solo db_datareader." -ForegroundColor Red
} else {
  Write-Host "Correcto: la cuenta solo puede leer." -ForegroundColor Green
}

# Y que de verdad entra con su contraseña.
Write-Host ""
Write-Host "Probando a entrar con ella..." -NoNewline
try {
  $prueba = New-Object System.Data.SqlClient.SqlConnection "Server=$servidorBueno;Database=$BaseDeDatos;User ID=$Cuenta;Password=$Contrasena;Connect Timeout=10;"
  $prueba.Open()
  $prueba.Close()
  Write-Host " entra correctamente" -ForegroundColor Green
} catch {
  Write-Host " NO entra: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""
Read-Host "Pulsa Intro para cerrar"
