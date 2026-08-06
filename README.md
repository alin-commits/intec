# Intec Commercial Hub

Plataforma interna de Suministros Intec. Vive bajo un solo dominio con dos accesos desde `/`:

- **Panel comercial** (con login): consultas, leads, campañas, unidades de negocio, usuarios y el panel de tickets informáticos.
- **Ticket informático** (`/soporte`, sin login): cualquier trabajador reporta una incidencia técnica; el admin la gestiona desde `/tickets`.

## Funcionalidad incluida

**Comercial**
- Dashboard general con KPI, tablas y gráficos, vista mensual/anual con comparativas.
- Registro de consultas (5 canales) con dashboard propio mensual/anual.
- Leads con separación por unidad de negocio, estados con historial.
- Campañas (crear/editar/archivar, sin borrado físico).
- Gestión de usuarios, roles (`admin`/`commercial`/`viewer`) y activación.
- Recuperación de contraseña (`/forgot-password`, `/reset-password`).

**Ticket informático**
- Formulario público sin registro (`/soporte`) con adjunto opcional (JPG/PNG/PDF, 5 MB), validado con Zod en servidor, honeypot y límite de envíos por IP.
- Numeración automática `TIC-0001`, prioridad automática según nivel de bloqueo.
- Panel admin (`/tickets`): tarjetas de resumen, filtros, tabla ordenable.
- Ficha de ticket (`/tickets/[id]`): botón de WhatsApp, adjunto vía URL firmada, notas y cambios de estado/prioridad/categoría con historial cronológico, archivar/eliminar.
- Aviso por email al admin cuando llega un ticket nuevo (vía Resend).

**Base**
- Login real con Supabase Auth, RLS por rol en todas las tablas.
- Invitaciones y recuperación de contraseña con emails de marca propia vía Resend (con fallback al email por defecto de Supabase si Resend no está configurado).
- Modelo SQL, RLS y seeds para Supabase.
- Modo demostración cuando Supabase no está configurado (el módulo de tickets requiere Supabase real).

## Desarrollo local

```bash
cp .env.example .env.local
npm install
npm run dev
```

Abrir `http://localhost:3000`.

## Variables de entorno

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
# Solo servidor. Nunca uses NEXT_PUBLIC_ con esta clave.
SUPABASE_SERVICE_ROLE_KEY=

# Envío de correos (invitaciones, restablecer contraseña, avisos de ticket) vía Resend.
RESEND_API_KEY=
EMAIL_FROM="Intec Commercial Hub <no-reply@tudominio.com>"

# Ticket informático: a quién se avisa cuando llega una incidencia nueva.
ADMIN_EMAIL=

# Opcional — si no se define, las rutas de servidor usan el origin de cada request.
NEXT_PUBLIC_APP_URL=
```

Sin `RESEND_API_KEY`/`EMAIL_FROM`: las invitaciones caen al email por defecto de Supabase, "olvidé mi contraseña" queda deshabilitado, y los tickets se siguen creando con normalidad, solo sin aviso por correo.

## Supabase

1. Crear un proyecto de Supabase.
2. Ejecutar por orden las migraciones de `supabase/migrations/` (incluye el bucket privado `ticket-attachments`).
3. Ejecutar `supabase/seed.sql`.
4. Crear el primer usuario en Authentication.
5. Promoverlo a administrador:

```sql
update public.profiles set role = 'admin' where email = 'tu-email@empresa.com';
```

6. Añadir las variables de entorno en Vercel.
7. (Opcional) Verificar un dominio en Resend y configurar `RESEND_API_KEY`/`EMAIL_FROM`/`ADMIN_EMAIL` para activar los emails.

## Validación

```bash
npm run lint
npm run typecheck
npm run build
```
