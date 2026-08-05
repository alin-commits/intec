# Intec Commercial Hub

MVP interno para centralizar consultas web y telefónicas, leads, campañas y estadísticas de las unidades de negocio de Suministros Intec.

## Estado actual

La primera versión incluye una interfaz navegable con datos ficticios:

- Dashboard con KPI, tablas y gráficos.
- Registro rápido de consultas web y telefónicas.
- Listado y filtros de leads.
- Comparativa de campañas.
- Resumen por unidad de negocio.
- Modelo SQL y políticas RLS para Supabase.

Mientras no se configuren las variables de Supabase, la aplicación funciona en modo demostración y no persiste cambios.

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
```

## Supabase

1. Crear un proyecto de Supabase.
2. Ejecutar `supabase/migrations/202608050001_initial_schema.sql` en el SQL Editor.
3. Crear el primer usuario en Authentication.
4. Promover el usuario inicial a administrador desde SQL siguiendo las notas de la migración.
5. Añadir las variables de entorno en Vercel.

No uses la clave `service_role` en el navegador.

## Documentación

- `docs/project-plan.md`
- `docs/database-design.md`
- `docs/analytics-definitions.md`
