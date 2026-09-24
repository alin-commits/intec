/*
  USUARIO DE SOLO LECTURA PARA EL AGENTE
  ======================================

  Crea la cuenta con la que el agente entra en Sage. Solo puede leer: no puede
  modificar ni borrar nada, ni cambiar la estructura de la base de datos.

  Lo ejecuta informática, una vez, desde SQL Server Management Studio conectado
  como administrador del motor.

  ANTES DE EJECUTAR
  -----------------
  Cambia PON_AQUI_UNA_CLAVE_LARGA por una contraseña larga y aleatoria. Esa
  misma contraseña se guarda después en una variable del sistema del servidor
  (INTEC_SAGE_DB_PASSWORD) y en el gestor de contraseñas del Hub.

  No la escribas en un correo ni en un chat.
*/

-- ---------------------------------------------------------------------------
-- 1. La cuenta, a nivel de servidor
-- ---------------------------------------------------------------------------
use master;
go

if not exists (select 1 from sys.server_principals where name = 'intec_lectura')
begin
  create login intec_lectura
    with password = 'PON_AQUI_UNA_CLAVE_LARGA',
         check_policy = on,
         default_database = Sage;
end
go

-- ---------------------------------------------------------------------------
-- 2. Su permiso dentro de la base de datos de Sage
--
-- db_datareader es "puede leer cualquier tabla". No se le añade db_datawriter
-- ni db_ddladmin a propósito: aunque el agente tuviera un fallo, no podría
-- tocar nada.
-- ---------------------------------------------------------------------------
use Sage;
go

if not exists (select 1 from sys.database_principals where name = 'intec_lectura')
begin
  create user intec_lectura for login intec_lectura;
end
go

alter role db_datareader add member intec_lectura;
go

-- El agente pregunta al catálogo cómo se llaman las columnas antes de leerlas,
-- así que necesita verlo. Es información de estructura, no datos.
grant view definition to intec_lectura;
go

-- ---------------------------------------------------------------------------
-- 3. Comprobar que ha quedado como toca
--
-- Debe aparecer en db_datareader y en ningún rol de escritura.
-- ---------------------------------------------------------------------------
select
  usuario.name  as usuario,
  rol.name      as rol
from sys.database_role_members m
join sys.database_principals rol on rol.principal_id = m.role_principal_id
join sys.database_principals usuario on usuario.principal_id = m.member_principal_id
where usuario.name = 'intec_lectura';
go

/*
  DESPUÉS, EN EL SERVIDOR (como administrador, en una consola)
  -----------------------------------------------------------
  Guardar el usuario y la contraseña donde el agente los va a buscar, para que
  no queden escritos en la tarea programada:

    setx /M INTEC_SAGE_DB_USER "intec_lectura"
    setx /M INTEC_SAGE_DB_PASSWORD "la-misma-clave-de-arriba"

  Hay que cerrar y volver a abrir la consola para que las variables existan.

  PARA DESHACERLO
  ---------------
    use Sage;  drop user intec_lectura;
    use master; drop login intec_lectura;
*/
