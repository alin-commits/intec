# Plan del proyecto

## Objetivo

Sustituir hojas de cálculo dispersas por una plataforma interna única para registrar consultas web y telefónicas, gestionar leads manuales, organizar campañas y analizar el rendimiento mensual por unidad de negocio.

## Alcance del MVP

1. Dashboard con KPI, tablas y gráficos.
2. Registro rápido de consultas por unidad y canal.
3. Listado filtrable de leads.
4. Gestión de campañas.
5. Comparativa entre unidades de negocio.
6. Supabase Auth, esquema, RLS e historial de estados.

## Hallazgos del Excel de BlizzCool

El archivo contiene cuatro hojas: `GENERAL`, `DISTRIBUIDORES`, `CROSSFIT` y `SERV.COMPLETO`.

Estados recurrentes:

- Nuevo lead.
- Intento de contacto.
- Contactado.
- Oferta enviada.
- Interesado.
- Ganado.
- Perdido.

Canales encontrados:

- Email.
- Llamada.
- WhatsApp.
- Web.
- RRSS.
- Landing.
- Meta Ads.
- Evento CrossFit.

Las columnas no son idénticas entre hojas. El modelo normalizado utiliza una sola tabla de leads y conserva campaña, origen, tipo, producto/interés, observaciones y valor de venta.

## Fases

### Fase 1 — Base visual

- App Router y TypeScript.
- Navegación lateral.
- Dashboard demostrable.
- Registro de consultas en modo demo.
- Leads, campañas y unidades con datos ficticios.

### Fase 2 — Persistencia

- Crear proyecto Supabase.
- Ejecutar migración y seed.
- Login real.
- Sustituir datos de demostración por consultas Supabase.
- Aplicar RLS y roles.

### Fase 3 — Operativa

- CRUD de leads.
- CRUD de campañas.
- Deshacer consultas recientes.
- Historial de estados.
- Filtros persistentes en URL.

### Fase 4 — Análisis

- Consultas SQL agregadas por mes.
- Comparación con periodo anterior.
- Cierre real mediante historial de estados.
- Exportación CSV.

### Fase 5 — Migración histórica

- Importador del Excel actual.
- Mapeo por hoja/campaña.
- Normalización y detección de duplicados.
- Vista previa antes de confirmar.

## Riesgos controlados

- El MVP no se conecta a Sage ni a APIs publicitarias.
- Los datos ficticios no contienen información real de clientes.
- No se incluye `service_role` en el frontend.
- Los cálculos de cierre deben migrar a `lead_status_history` antes de considerarse métricas definitivas.
