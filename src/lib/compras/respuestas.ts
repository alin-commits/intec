/*
  Qué correos del buzón son respuestas a una reclamación nuestra, y a qué
  pedidos afectan.

  Sin red, sin base de datos y sin IA: son decisiones sobre datos que ya
  tenemos. La IA entra después, y solo para entender el texto.

  Equivocarse aquí tiene dos formas, y ninguna es inocente: dar por contestado
  un pedido que nadie ha contestado —y dejar de reclamárselo— o no reconocer
  una respuesta y seguir dando la lata a quien ya te ha contestado.
*/

/** Una reclamación que mandamos, como la necesita este módulo. */
export type ReclamacionMandada = {
  conversationId: string | null;
  companyCode: number;
  supplierCode: string;
  sentAt: string;
  orders: { year: number; series: string; number: number }[];
};

/** Un correo recibido en el buzón. */
export type CorreoRecibido = {
  id: string;
  conversationId: string | null;
  from: string | null;
  subject: string;
  receivedAt: string;
};

export type RespuestaReconocida = {
  correo: CorreoRecibido;
  companyCode: number;
  supplierCode: string;
  orders: { year: number; series: string; number: number }[];
};

/**
 * Las respuestas automáticas más comunes, por si el correo no trae las
 * cabeceras que las delatan.
 *
 * Es una red de apoyo, no el filtro principal: lo que manda son las cabeceras
 * de Microsoft y, después, lo que entienda la IA. Esto solo evita gastar una
 * llamada en un "estoy de vacaciones" evidente.
 */
const ASUNTOS_AUTOMATICOS = [
  /fuera de la oficina/i,
  /out of office/i,
  /automatic reply/i,
  /respuesta autom[áa]tica/i,
  /no (?:responda|conteste|responder) a este (?:correo|mensaje)/i,
  /undeliverable|no se ha podido entregar|mensaje no entregado/i,
  /vacaciones/i,
];

export function pareceAutomatico(correo: { subject: string }, cabeceras: Record<string, string> = {}): boolean {
  // Lo que dice el propio correo de sí mismo manda sobre cualquier lista.
  const auto = (cabeceras["auto-submitted"] ?? "").toLowerCase();
  if (auto && auto !== "no") return true;
  if (cabeceras["x-autoreply"] || cabeceras["x-autorespond"]) return true;
  if ((cabeceras["precedence"] ?? "").toLowerCase() === "auto_reply") return true;
  return ASUNTOS_AUTOMATICOS.some((patron) => patron.test(correo.subject ?? ""));
}

/**
 * Empareja los correos recibidos con las reclamaciones que mandamos.
 *
 * Se empareja por el hilo, que es exacto: la reclamación salió sobre el correo
 * del pedido y la respuesta vuelve a esa conversación. No se intenta adivinar
 * por el remitente ni por el número de pedido en el texto, porque eso falla
 * justo cuando más daño hace: un proveedor que contesta desde otra dirección,
 * o un número de pedido mencionado de pasada en un correo que no viene a
 * cuento.
 */
export function reconocerRespuestas(input: {
  correos: CorreoRecibido[];
  reclamaciones: ReclamacionMandada[];
  /** Los que ya se leyeron en pasadas anteriores. */
  yaLeidos: Set<string>;
  /** Nuestro propio buzón: lo que sale de él no es una respuesta. */
  buzonPropio: string;
}): RespuestaReconocida[] {
  const porHilo = new Map<string, ReclamacionMandada[]>();
  for (const reclamacion of input.reclamaciones) {
    if (!reclamacion.conversationId) continue;
    const suyas = porHilo.get(reclamacion.conversationId) ?? [];
    suyas.push(reclamacion);
    porHilo.set(reclamacion.conversationId, suyas);
  }

  const nuestro = input.buzonPropio.toLowerCase();
  const reconocidas: RespuestaReconocida[] = [];

  for (const correo of input.correos) {
    if (input.yaLeidos.has(correo.id)) continue;
    if (!correo.conversationId) continue;
    if ((correo.from ?? "").toLowerCase() === nuestro) continue;

    const enEseHilo = porHilo.get(correo.conversationId);
    if (!enEseHilo?.length) continue;

    // Solo cuentan las reclamaciones anteriores al correo: si llegó antes de
    // que le escribiéramos, no está contestando a esto.
    const anteriores = enEseHilo.filter((r) => r.sentAt <= correo.receivedAt);
    if (anteriores.length === 0) continue;

    // Los pedidos de todas las reclamaciones de ese hilo, sin repetir.
    const vistos = new Set<string>();
    const orders: { year: number; series: string; number: number }[] = [];
    for (const reclamacion of anteriores) {
      for (const pedido of reclamacion.orders) {
        const llave = `${pedido.year}-${pedido.series}-${pedido.number}`;
        if (vistos.has(llave)) continue;
        vistos.add(llave);
        orders.push(pedido);
      }
    }

    const ultima = anteriores[anteriores.length - 1];
    reconocidas.push({ correo, companyCode: ultima.companyCode, supplierCode: ultima.supplierCode, orders });
  }

  return reconocidas;
}
