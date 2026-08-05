# Diseño de base de datos

## Entidades

### profiles

Amplía `auth.users` con nombre, rol y estado activo.

### business_units

Representa marcas internas: Intec, BlizzCool, Sumifluid, Jender, CST Ibérica y Blizztherm. `logo_url` guarda la ruta del logotipo (servido desde `public/`). CST Ibérica y Blizztherm están sembradas con `is_active = false`: no tienen actividad comercial actual, así que no aparecen en el registro de consultas ni en las comparativas activas, pero se conservan para no perder su histórico de leads y campañas.

### inquiries

Cada fila es una consulta individual. El canal (`inquiry_type`) es uno de `phone`, `chat`, `email_form`, `whatsapp` o `portal_rrss`. El valor histórico `web` sigue existiendo en el enum por compatibilidad pero ya no se escribe: el desglose "web" del dashboard general se calcula como chat + email_form + whatsapp + portal_rrss. `created_at` y `created_by` se asignan automáticamente.

### campaigns

Campañas manuales asociadas a una sola unidad de negocio.

### leads

Registro comercial normalizado. Permite conservar el nombre de la empresa cliente sin confundirlo con la unidad interna.

### lead_status_history

Auditoría de cada cambio de estado y base para medir tiempos de contacto, oferta y cierre.

## Relaciones

- Una unidad tiene muchas consultas.
- Una unidad tiene muchas campañas.
- Una unidad tiene muchos leads.
- Una campaña tiene muchos leads.
- Un lead tiene muchos cambios de estado.
- Un usuario crea consultas, campañas y leads.

## Borrado

- Unidades: archivado lógico mediante `is_active`.
- Campañas: estado `archived`.
- Leads: borrado físico solo para administradores; se recomienda añadir `deleted_at` antes del uso en producción si se necesita auditoría completa.
- Consultas: un comercial solo puede deshacer registros propios recientes.

## Usuarios operativos

La segunda migración añade `profiles.email` para facilitar la administración interna. Las invitaciones utilizan `SUPABASE_SERVICE_ROLE_KEY` únicamente desde una ruta de servidor. Los cambios de rol y activación siguen protegidos por RLS y requieren rol `admin`.

## Seguridad reforzada (cuarta migración)

Revisando las políticas RLS existentes se detectaron dos huecos, cerrados de forma aditiva:

- **Fechas falsificables**: `created_at` solo tenía `default now()`, que Postgres ignora si el cliente lo incluye explícitamente en el insert (a diferencia de `updated_at`, que ya iba protegido por trigger). Ahora `inquiries`, `leads`, `campaigns` y `business_units` fuerzan `created_at = now()` mediante un trigger `before insert`, sin depender del valor que llegue del cliente.
- **Auto-promoción de rol**: la política `profiles_update_admin` permitía a un administrador actualizar cualquier fila de `profiles`, incluida la suya propia. Un trigger (`prevent_self_role_change`) bloquea que un usuario cambie su propio `role` o `is_active`, incluso siendo admin; los cambios sobre el resto de usuarios no se ven afectados.
