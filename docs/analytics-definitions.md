# Definiciones estadísticas

## Consultas por canal

Número de filas de `inquiries` cuyo `inquiry_type` coincide con el canal, dentro del periodo y filtro de unidad seleccionado. Los 5 canales activos son `phone` (Teléfono), `chat` (Chat), `email_form` (Email/Formulario), `whatsapp` (Whatsapp) y `portal_rrss` (Portales/RRSS).

## Consultas web (resumen)

En las vistas que solo distinguen web/teléfono (p. ej. el dashboard general), "web" es la suma de `chat` + `email_form` + `whatsapp` + `portal_rrss`, y "telefónicas" es `phone`.

## Consultas totales

Suma de las consultas de los 5 canales.

## Semana comercial

Agrupación semanal usada en `/consultas`, alineada con el criterio manual del control histórico en Excel: ninguna semana cruza el límite de un mes.

- Los días anteriores al primer lunes del mes se unen siempre a la primera semana completa (lunes-domingo) de ese mes.
- Los días posteriores al último domingo completo del mes forman su propia semana solo si son 5 o más; si son entre 1 y 4, se suman a la última semana completa anterior.

Implementado en `monthWeekBuckets` (`src/lib/dates.ts`).

## Lead creado

Fila de `leads` cuya `created_at` se encuentra dentro del periodo.

## Lead ganado

En el MVP, lead cuyo estado actual es `won` y cuya fecha de creación está en el periodo. Esta definición es provisional.

En producción, el cierre debe calcularse con la primera entrada de `lead_status_history` cuyo `new_status` sea `won`, usando `changed_at`.

## Conversión

`leads ganados / leads totales * 100`.

Cuando el total es cero, se muestra `Sin datos` o 0 %, sin división.

## Valor ganado

Suma de `sale_value` de leads ganados. En producción se debe atribuir al periodo de cierre real, no necesariamente al de creación.

## Variación porcentual

`((valor actual - valor anterior) / valor anterior) * 100`.

Si el valor anterior es cero, la interfaz debe mostrar `Nuevo` o `Sin comparación`.

## Zona horaria

Las fechas se almacenan en UTC y se muestran y agrupan para el usuario en `Europe/Madrid`.

## Dashboard mensual de consultas

El periodo se define por el mes seleccionado en zona horaria `Europe/Madrid`. La vista compara el total del mes con el mes natural inmediatamente anterior. La media diaria usa los días transcurridos cuando se analiza el mes actual y todos los días naturales cuando se analiza un mes cerrado.
