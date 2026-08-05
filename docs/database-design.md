# Diseño de base de datos

## Entidades

### profiles

Amplía `auth.users` con nombre, rol y estado activo.

### business_units

Representa marcas internas: Intec, BlizzCool, Sumifluid, Jender, CST Ibérica y Blizztherm.

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
