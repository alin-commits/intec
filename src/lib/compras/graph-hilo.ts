/*
  Sobre qué correo se responde, y dónde se mete el texto.

  Está aparte de graph.ts porque aquello lleva "server-only" —secretos y red—
  y esto no necesita ninguna de las dos cosas: son decisiones sobre texto. Así
  se puede probar, que falta hace: equivocarse aquí es escribirle a un
  proveedor sobre el pedido de otro.
*/

export type CorreoDelPedido = {
  id: string;
  /** El hilo. Por aquí se reconoce después la respuesta del proveedor. */
  conversationId?: string | null;
  subject: string;
  /** A quién se lo mandó Sage: es la dirección buena, no la genérica de la ficha. */
  destinatarios: string[];
  sentDateTime: string;
};

/**
 * De entre lo que devuelve la búsqueda, el correo con el que se mandó el pedido.
 *
 * Dos cuidados que no son evidentes:
 *
 * · El asunto tiene que terminar ahí. Buscando "Pedidos de compra Intec 123"
 *   Microsoft devuelve también el del 1234, y acabaríamos reclamando sobre el
 *   hilo de otro pedido, a un proveedor que no toca.
 * · De los que queden vale el MÁS ANTIGUO, que es el envío original. Los
 *   posteriores con ese asunto son nuestras propias reclamaciones, y responder
 *   sobre una respuesta deja el pedido cada vez más abajo.
 *
 * Va sin red a propósito, para poder probarlo.
 */
export function elegirCorreoDelPedido(correos: CorreoDelPedido[], asunto: string): CorreoDelPedido | null {
  const escapado = asunto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const exacto = new RegExp(`${escapado}(?!\\d)`, "i");
  const candidatos = correos.filter((correo) => exacto.test(correo.subject ?? ""));
  if (candidatos.length === 0) return null;
  return [...candidatos].sort((a, b) => (a.sentDateTime ?? "").localeCompare(b.sentDateTime ?? ""))[0];
}

/**
 * Mete el texto dentro del cuerpo del borrador, delante de lo que ya traía.
 *
 * Pegarlo antes del documento deja un HTML inválido que cada programa de
 * correo pinta como quiere, y hay quien se come el texto entero.
 */
export function meterEnElCuerpo(original: string, html: string): string {
  const abre = /<body[^>]*>/i.exec(original);
  if (!abre) return html + original;
  const corte = abre.index + abre[0].length;
  return original.slice(0, corte) + html + original.slice(corte);
}

/**
 * Las direcciones que hay en un campo de correo de Sage.
 *
 * En la ficha del proveedor caben varias y cada uno las separa como quiere:
 * punto y coma, coma o un espacio. Mandarlas como una sola cadena no falla a
 * medias —el servidor la rechaza entera—, así que el proveedor no recibiría
 * nada y el registro diría que sí se intentó.
 */
export function direccionesDe(campo: string | null | undefined): string[] {
  if (!campo) return [];
  const vistas = new Set<string>();
  const salida: string[] = [];
  for (const trozo of campo.split(/[;,\s]+/)) {
    const limpio = trozo.trim().replace(/^<|>$/g, "");
    // Lo que no parezca una dirección se deja fuera: un nombre suelto o una
    // nota ("preguntar por Marta") colaría y tiraría el envío entero.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(limpio)) continue;
    const clave = limpio.toLowerCase();
    if (vistas.has(clave)) continue;
    vistas.add(clave);
    salida.push(limpio);
  }
  return salida;
}
