/*
  El texto que se le manda a la IA y la forma de lo que tiene que devolver.

  Aparte de leer-respuesta.ts, que lleva "server-only", porque esto no necesita
  ni clave ni red: es texto y un esquema. Así se puede ejecutar contra correos
  de verdad para ver qué entiende, sin levantar la aplicación.
*/
import { z } from "zod";

/*
  Qué clase de correo es. No es "persona o máquina": un aviso de expedición lo
  manda una máquina pero dice algo que a compras le importa —que el material ha
  salido—, y tirarlo a la basura con las newsletters sería perder información.
*/
export const TIPOS = ["respuesta", "expedicion", "automatico", "otro"] as const;
export type TipoDeCorreo = (typeof TIPOS)[number];

export const Lectura = z.object({
  tipo: z.enum(TIPOS),
  /** La fecha de entrega que dan, en yyyy-mm-dd, o null si no dan ninguna. */
  fechaPrevista: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().catch(null),
  /** Si esa fecha está dicha sin condiciones y no es una conjetura. */
  fechaSegura: z.boolean(),
  /** Qué han dicho, en una línea. */
  resumen: z.string(),
});

export type LecturaDeRespuesta = z.infer<typeof Lectura>;

/** Un aviso de expedición no se reclama, pero tampoco se tira: se enseña. */
export function cuentaComoRespuesta(tipo: TipoDeCorreo): boolean {
  return tipo === "respuesta";
}

/** Lo que Gemini tiene que devolver, en su formato de esquema. */
export const ESQUEMA = {
  type: "object",
  properties: {
    tipo: { type: "string", enum: ["respuesta", "expedicion", "automatico", "otro"] },
    fechaPrevista: { type: "string", nullable: true, description: "yyyy-mm-dd, o null si no dan fecha" },
    fechaSegura: { type: "boolean" },
    resumen: { type: "string" },
  },
  required: ["tipo", "fechaSegura", "resumen"],
};

export const INSTRUCCIONES = `Lees un correo que ha llegado al buzón de compras de una empresa de suministro industrial, en respuesta a una reclamación de la fecha de entrega de un pedido a proveedor. Tu trabajo es solo entenderlo; no decides nada.

Reglas:
- tipo es una de estas cuatro:
  · "respuesta": alguien del proveedor contesta sobre el pedido, dé fecha o no ("lo tenemos para el 4", "se nos ha retrasado", "¿qué referencia es?").
  · "expedicion": aviso de que el material ha salido o está en camino, normalmente automático: albaranes, confirmaciones de envío, números de seguimiento, preavisos de llegada de la agencia. Dice algo que importa aunque no sea una respuesta escrita por nadie.
  · "automatico": fuera de la oficina, vacaciones, acuses de recibo, avisos de que el buzón no se lee, mensajes de no entrega.
  · "otro": publicidad, newsletters, tarifas, facturas y cualquier cosa que no tenga que ver con este pedido.
- fechaPrevista es la fecha en la que dicen que llegará o saldrá el material, en formato yyyy-mm-dd. Si dan fechas distintas para líneas distintas, pon la más tardía, que es cuando el pedido estará completo. Si no dan ninguna, null.
- fechaSegura es verdadero SOLO si la fecha está dicha sin condiciones ("sale el 4 de noviembre", "entrega el 12/11"). Es falso si va condicionada o es aproximada ("sobre el 15", "si nos llega el material", "la semana que viene", "a finales de mes"), aunque hayas podido convertirla en una fecha concreta.
- resumen es una línea corta en español de España que valga para que alguien de compras entienda el correo sin abrirlo. Ve al grano, nada de "el proveedor dice que". Si avisan de algo que importa —que falta material, que sube el precio, que envían parte del pedido— dilo.
- Ignora el correo citado debajo de la respuesta: es la reclamación que mandamos nosotros.
- Si viene un documento adjunto, léelo: muchos proveedores confirman ahí y no en el texto. Si el adjunto y el correo dicen fechas distintas, manda el adjunto, que es el documento formal.`;


/** La pregunta completa, tal como se la mandamos. */
export function construirPregunta(input: { proveedor: string; pedidos: string[]; asunto: string; cuerpo: string; hoy: string }): string {
  // El cuerpo llega con el hilo citado debajo: con el principio basta y evita
  // que se lea a sí misma la reclamación que mandamos nosotros.
  return `${INSTRUCCIONES}

Hoy es ${input.hoy}.
Proveedor: ${input.proveedor}
Pedidos por los que se le reclamó: ${input.pedidos.join(", ")}
Asunto: ${input.asunto}

Correo:
${input.cuerpo.slice(0, 6000)}`;
}

/** Lo que devuelve la IA, comprobado. Null si no encaja con lo que se le pidió. */
export function interpretar(bruto: unknown): LecturaDeRespuesta | null {
  const leido = Lectura.safeParse(bruto);
  if (!leido.success) {
    console.error("Compras: la IA devolvió algo que no encaja", leido.error.issues.slice(0, 2));
    return null;
  }
  return leido.data;
}
