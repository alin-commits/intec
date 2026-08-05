# Intec Commercial Hub

Plataforma interna para centralizar consultas web y telefónicas, leads, campañas, usuarios y estadísticas de las unidades de negocio de Suministros Intec.

## Funcionalidad incluida

- Dashboard general con KPI, tablas y gráficos.
- Registro de consultas web y telefónicas con confirmación previa.
- Dashboard mensual propio de consultas, filtros y ordenación.
- Creación y edición de leads.
- Cambios de estado con confirmación e historial.
- Gestión de usuarios, roles y activación.
- Login real preparado para Supabase Auth.
- Modelo SQL, RLS y seeds para Supabase.
- Modo demostración cuando Supabase no está configurado.

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
SUPABASE_SERVICE_ROLE_KEY=
```

`SUPABASE_SERVICE_ROLE_KEY` se utiliza únicamente en el servidor para invitar usuarios. Nunca debe exponerse con el prefijo `NEXT_PUBLIC_`.

## Supabase

1. Crear un proyecto de Supabase.
2. Ejecutar por orden las migraciones de `supabase/migrations/`.
3. Ejecutar `supabase/seed.sql`.
4. Crear el primer usuario en Authentication.
5. Promoverlo a administrador:

```sql
update public.profiles set role = 'admin' where email = 'tu-email@empresa.com';
```

6. Añadir las tres variables de entorno en Vercel.

## Validación

```bash
npm run lint
npm run typecheck
npm run build
```
