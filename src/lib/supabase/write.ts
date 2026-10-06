/**
 * Un guardado que no toca ninguna fila no es un guardado correcto.
 *
 * PostgREST no da error cuando la RLS deja la fila fuera: responde 200 y cero
 * filas cambiadas. La pantalla, que solo mira `error`, dice "guardado
 * correctamente" y la persona sigue viendo el dato de antes. Ha pasado ya dos
 * veces —atar una campaña de Meta, el registro mensual de redes sociales— así
 * que la comprobación vive aquí y no repetida en cada pantalla.
 *
 * Lo mismo con los borrados: hay tablas donde solo un admin, o quien lo creó
 * durante los diez minutos siguientes, puede borrar. Sin esto, el resto ve
 * "eliminado" y la fila sigue en la lista al recargar.
 */
import { WriteBlockedError } from "@/lib/errors";

type WriteResult = { data: unknown[] | null; error: { message: string } | null };

/** Lo que devuelven `.update()`, `.delete()` e `.upsert()` antes de pedirles las filas. */
type WriteBuilder = { select: (columns?: string) => PromiseLike<WriteResult> };

/**
 * Ejecuta la escritura pidiendo de vuelta las filas afectadas y se queja si no
 * hay ninguna. `blockedMessage` es lo que leerá la persona en ese caso: tiene
 * que explicar qué hacer, no decir "error".
 *
 * Devuelve cuántas filas cambiaron, por si quien llama quiere matizar el aviso.
 */
export async function writeRows(builder: WriteBuilder, blockedMessage: string, columns = "*"): Promise<number> {
  const { data, error } = await builder.select(columns);
  if (error) throw error;
  const rows = data?.length ?? 0;
  if (rows === 0) throw new WriteBlockedError(blockedMessage);
  return rows;
}
