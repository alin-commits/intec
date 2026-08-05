# Definiciones estadísticas

## Consultas web

Número de filas de `inquiries` cuyo `inquiry_type` es `web` dentro del periodo y filtro de unidad seleccionado.

## Consultas telefónicas

Número de filas cuyo `inquiry_type` es `phone`.

## Consultas totales

Consultas web + consultas telefónicas.

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
