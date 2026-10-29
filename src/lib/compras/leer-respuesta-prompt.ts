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

/*
  Lo que dice el correo de cada pedido.

  Desde que un solo correo reclama todos los pedidos de un proveedor, la
  respuesta suele traer una cosa distinta para cada uno: «el 7328 sale hoy, el
  7329 está en espera». Con una sola fecha para el correo, la de uno se ponía a
  todos, y un pedido en espera aparecía con fecha de llegada.
*/
export const LecturaDePedido = z.object({
  /** El pedido, tal como viene en la lista que se le pasa. */
  pedido: z.string(),
  /** Si el correo dice algo de este pedido, aunque sea de todos a la vez. */
  contesta: z.boolean(),
  fechaPrevista: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().catch(null),
  fechaSegura: z.boolean(),
  /** Lo que dicen de este pedido, en pocas palabras. */
  resumen: z.string(),
});

export const Lectura = z.object({
  tipo: z.enum(TIPOS),
  /** La fecha de entrega que dan, en yyyy-mm-dd, o null si no dan ninguna. */
  fechaPrevista: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().catch(null),
  /** Si esa fecha está dicha sin condiciones y no es una conjetura. */
  fechaSegura: z.boolean(),
  /** Qué han dicho, en una línea. */
  resumen: z.string(),
  /** Pedido a pedido. Si falta, vale lo de arriba para todos, como antes. */
  porPedido: z.array(LecturaDePedido).catch([]),
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
    porPedido: {
      type: "array",
      items: {
        type: "object",
        properties: {
          pedido: { type: "string" },
          contesta: { type: "boolean" },
          fechaPrevista: { type: "string", nullable: true, description: "yyyy-mm-dd, o null si no dan fecha para este pedido" },
          fechaSegura: { type: "boolean" },
          resumen: { type: "string" },
        },
        required: ["pedido", "contesta", "fechaSegura", "resumen"],
      },
    },
  },
  required: ["tipo", "fechaSegura", "resumen", "porPedido"],
};

export const INSTRUCCIONES = `Lees un correo que ha llegado al buzón de compras de una empresa de suministro industrial, en respuesta a una reclamación de la fecha de entrega de un pedido a proveedor. Tu trabajo es solo entenderlo; no decides nada.

Reglas:
- tipo es una de estas cuatro:
  · "respuesta": alguien del proveedor contesta sobre el pedido, dé fecha o no ("lo tenemos para el 4", "se nos ha retrasado", "¿qué referencia es?").
  · "expedicion": aviso de que el material ha salido o está en camino, normalmente automático: albaranes, confirmaciones de envío, números de seguimiento, preavisos de llegada de la agencia. Dice algo que importa aunque no sea una respuesta escrita por nadie.
  · "automatico": fuera de la oficina, vacaciones, acuses de recibo, avisos de que el buzón no se lee, mensajes de no entrega.
  · "otro": publicidad, newsletters, tarifas, facturas y cualquier cosa que no tenga que ver con este pedido.
- fechaPrevista es la fecha en la que dicen que llegará o saldrá el material, en formato yyyy-mm-dd. Si dan fechas distintas para líneas o pedidos distintos, pon la más tardía, que es cuando estará todo. Si no dan ninguna, null.
- Si la dan aproximada ("esta semana", "en una semana", "la semana que viene", "a finales de mes"), conviértela en el último día que encaje —el viernes de esa semana, hoy más siete días, el último día laborable del mes— y pon fechaSegura falso.
- Una fecha que ya ha pasado cuando escriben no es una fecha prevista. Si cuentan que el material salió el día 22, eso va en el resumen, y fechaPrevista es la de llegada si la dicen o se deduce ("salió ayer, os llega mañana"), y null si no. Hoy no ha pasado: "sale hoy" es la fecha de hoy.
- fechaSegura es verdadero SOLO si la fecha está dicha sin condiciones ("sale el 4 de noviembre", "entrega el 12/11"). Es falso si va condicionada o es aproximada ("sobre el 15", "si nos llega el material", "la semana que viene", "a finales de mes"), aunque hayas podido convertirla en una fecha concreta.
- resumen es una línea corta en español de España que valga para que alguien de compras entienda el correo sin abrirlo. Ve al grano, nada de "el proveedor dice que". Si avisan de algo que importa —que falta material, que sube el precio, que envían parte del pedido— dilo.
- porPedido lleva una entrada por cada pedido de la lista "Pedidos por los que se le reclamó", con el pedido escrito tal cual viene en la lista. Es lo que dice el correo de ESE pedido:
  · contesta: verdadero si el correo dice algo de ese pedido, también cuando lo dice de todos a la vez ("os llega todo el lunes", "lo tenemos todo preparado") y cuando no queda claro de cuál habla ("el pedido del 22/10 está preparado" y hay varios del 22/10: cuenta para todos los que encajen). Falso solo cuando queda claro que habla de otros pedidos y de este no dice nada.
  · fechaPrevista y fechaSegura: con las mismas reglas de arriba, pero solo lo que digan de ese pedido. Si dan una fecha para todos, esa vale para cada uno. Si de ese pedido no dan fecha, null aunque la den para otro.
  · resumen: lo que dicen de ese pedido, en pocas palabras ("sale hoy", "en espera de que confirméis el cambio"). Vacío si no dicen nada de él.
- Ignora el correo citado debajo de la respuesta: es la reclamación que mandamos nosotros.
- Si viene un documento adjunto, léelo: muchos proveedores confirman ahí y no en el texto. Si el adjunto y el correo dicen fechas distintas, manda el adjunto, que es el documento formal.`;


/** La pregunta completa, tal como se la mandamos. */
export function construirPregunta(input: {
  proveedor: string;
  pedidos: string[];
  asunto: string;
  cuerpo: string;
  /** El día en que escribieron: desde ahí se cuentan «hoy», «mañana» y «el lunes». */
  hoy: string;
}): string {
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

/** Lo que se apunta de un pedido a partir de un correo. */
export type LoQueDiceDelPedido = {
  /** Si el correo contesta sobre este pedido. Si no, se le sigue reclamando. */
  contesta: boolean;
  fechaPrevista: string | null;
  /** Solo es verdadero con fecha: sin fecha no hay nada que sea seguro. */
  fechaSegura: boolean;
  /** Lo que dicen de él; si no lo distinguen, el resumen del correo. */
  resumen: string | null;
};

/**
 * Lo que dice el correo de cada pedido de la reclamación.
 *
 * Con un solo pedido no hay nada que repartir: todo lo que digan va por él.
 * Con varios, cada uno se queda con lo suyo. Si la IA no los distinguió —no
 * devolvió nada pedido a pedido, o nada que case con la lista—, se hace como
 * antes: lo del correo vale para todos. Y uno de la lista del que no devuelve
 * nada es que el correo no habla de él: no se da por contestado.
 */
export function loQueDiceDeCadaPedido<P extends { series: string; number: number }>(
  pedidos: P[],
  lectura: LecturaDeRespuesta | null,
): (P & LoQueDiceDelPedido)[] {
  const delCorreo = (pedido: P): P & LoQueDiceDelPedido => ({
    ...pedido,
    contesta: true,
    fechaPrevista: lectura?.fechaPrevista ?? null,
    fechaSegura: Boolean(lectura?.fechaSegura && lectura.fechaPrevista),
    resumen: lectura?.resumen ?? null,
  });
  if (!lectura || pedidos.length === 0) return pedidos.map(delCorreo);

  // La IA escribe el pedido como se le pasó, pero se acepta también solo el
  // número: «PC7328» y «7328» son el mismo si no hay otro con ese número.
  const llano = (texto: string) => texto.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const casar = (dicho: string) => {
    const exacto = pedidos.find((pedido) => llano(`${pedido.series}${pedido.number}`) === llano(dicho));
    if (exacto) return exacto;
    const cifras = dicho.match(/\d+/g)?.at(-1);
    const porNumero = pedidos.filter((pedido) => String(pedido.number) === cifras);
    return porNumero.length === 1 ? porNumero[0] : null;
  };
  const dichos = new Map<P, (typeof lectura.porPedido)[number]>();
  for (const entrada of lectura.porPedido) {
    const pedido = casar(entrada.pedido);
    if (pedido && !dichos.has(pedido)) dichos.set(pedido, entrada);
  }

  if (pedidos.length === 1) {
    // Todo lo que llega en su hilo va por él. Si la IA dio fecha solo pedido a
    // pedido y no arriba, se aprovecha.
    const entrada = dichos.get(pedidos[0]);
    const fecha = lectura.fechaPrevista ?? entrada?.fechaPrevista ?? null;
    const segura = lectura.fechaPrevista ? lectura.fechaSegura : Boolean(entrada?.fechaSegura);
    return [{ ...delCorreo(pedidos[0]), fechaPrevista: fecha, fechaSegura: Boolean(fecha && segura) }];
  }
  if (dichos.size === 0) return pedidos.map(delCorreo);

  return pedidos.map((pedido) => {
    const entrada = dichos.get(pedido);
    if (!entrada) return { ...pedido, contesta: false, fechaPrevista: null, fechaSegura: false, resumen: null };
    return {
      ...pedido,
      contesta: entrada.contesta,
      fechaPrevista: entrada.fechaPrevista,
      fechaSegura: Boolean(entrada.fechaSegura && entrada.fechaPrevista),
      resumen: entrada.resumen.trim() || (entrada.contesta ? lectura.resumen : null),
    };
  });
}

/**
 * Quita las fechas anteriores al día en que escribieron.
 *
 * «Se envió el 22» no es una fecha de llegada, y apuntada como propuesta
 * enseñaba un pedido pendiente con fecha ya pasada y un botón para aceptarla.
 * Se compara con el día del correo y no con hoy: un «llega el 28» escrito el
 * 26 sigue siendo lo que dijeron aunque se lea el 29.
 */
export function sinFechasPasadas(lectura: LecturaDeRespuesta | null, diaDelCorreo: string): LecturaDeRespuesta | null {
  if (!lectura) return null;
  const vale = (fecha: string | null) => (fecha && fecha >= diaDelCorreo ? fecha : null);
  return {
    ...lectura,
    fechaPrevista: vale(lectura.fechaPrevista),
    porPedido: lectura.porPedido.map((entrada) => ({ ...entrada, fechaPrevista: vale(entrada.fechaPrevista) })),
  };
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
