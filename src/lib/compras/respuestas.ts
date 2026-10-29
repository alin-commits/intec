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
 * Las conversaciones que hay que mirar: las de las reclamaciones de los
 * últimos días, sin repetir. Un proveedor puede contestar una semana después,
 * o contestar primero «lo miro» y la fecha más tarde, así que no basta con lo
 * de ayer. Lo más viejo ya no se mira: a esas alturas se sigue a mano.
 */
export function hilosALeer(reclamaciones: { conversationId: string | null; sentAt: string }[], desdeIso: string): string[] {
  const hilos = new Set<string>();
  for (const reclamacion of reclamaciones) {
    if (reclamacion.conversationId && reclamacion.sentAt >= desdeIso) hilos.add(reclamacion.conversationId);
  }
  return [...hilos];
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
  /**
   * Nuestro propio buzón. Ni lo que sale de él ni lo que escribe cualquier otra
   * persona de la casa cuenta como respuesta del proveedor.
   */
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
  /*
    Nadie de casa es un proveedor.

    Mirar solo el buzón de compras no bastaba: probando el circuito se contestó
    a una reclamación desde el correo de una persona de la empresa, llegó al
    hilo igual que una respuesta de verdad y el pedido se dio por contestado
    con fecha y todo. Un proveedor nunca escribe desde nuestro dominio, así que
    se descarta entero.
  */
  const nuestroDominio = nuestro.includes("@") ? nuestro.slice(nuestro.indexOf("@")) : "";
  /*
    Y un remitente sin @ tampoco. Es la dirección interna de Exchange
    («/O=EXCHANGELABS/…»), con la que aparecen en el hilo nuestros propios
    correos: la primera vez que se leyeron los hilos enteros, 17 reclamaciones
    nuestras pasaron por respuestas del proveedor y dejaron sus pedidos como
    contestados sin que nadie hubiera contestado. Un proveedor siempre escribe
    desde una dirección con @.
  */
  const deCasa = (quien: string) =>
    !quien.includes("@") || quien === nuestro || (nuestroDominio !== "" && quien.endsWith(nuestroDominio));
  const reconocidas: RespuestaReconocida[] = [];

  for (const correo of input.correos) {
    if (input.yaLeidos.has(correo.id)) continue;
    if (!correo.conversationId) continue;
    if (deCasa((correo.from ?? "").toLowerCase())) continue;

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

  // De la más vieja a la más nueva: si en un hilo hay dos, lo último que se
  // apunta es lo último que dijo el proveedor.
  return reconocidas.sort((a, b) => a.correo.receivedAt.localeCompare(b.correo.receivedAt));
}

/** Lo que ya hay apuntado de un pedido, para no pisarlo con algo más viejo. */
export type SeguimientoApuntado = {
  year: number;
  series: string;
  number: number;
  confirmed_at: string | null;
  replied_at: string | null;
};

/**
 * A qué pedidos de una respuesta se les apunta lo que ha dicho el proveedor.
 *
 * Leyendo los hilos de varias semanas pueden aparecer correos viejos que no se
 * vieron en su día. Uno así no puede deshacer lo que vino después: si alguien
 * confirmó la fecha cuando ese correo ya había llegado, o si ya hay apuntada
 * una respuesta más nueva, ese pedido se deja como está. El correo se guarda
 * igual, para que se vea; solo no cambia el pedido.
 */
export function pedidosQueCambia<P extends { year: number; series: string; number: number }>(
  pedidos: P[],
  apuntado: SeguimientoApuntado[],
  recibido: string,
): P[] {
  const llave = (p: { year: number; series: string; number: number }) => `${p.year}-${p.series}-${p.number}`;
  const porPedido = new Map(apuntado.map((fila) => [llave(fila), fila]));
  const instante = (iso: string | null) => (iso ? Date.parse(iso) : Number.NEGATIVE_INFINITY);
  const llegada = Date.parse(recibido);
  return pedidos.filter((pedido) => {
    const fila = porPedido.get(llave(pedido));
    if (!fila) return true;
    return instante(fila.confirmed_at) <= llegada && instante(fila.replied_at) <= llegada;
  });
}

/**
 * Si lo que ha dicho el proveedor no cuadra con lo que hay en Sage.
 *
 * Pasa más de lo que parece: Sage tiene una fecha de recepción puesta al
 * hacer el pedido, el proveedor escribe después diciendo otra, y como el
 * pedido «ya tiene fecha» se da por bueno, deja de reclamarse y nadie vuelve
 * a mirarlo. La fecha de Sage es la que manda —es la que ve el resto de la
 * casa—, pero cuando el proveedor dice otra cosa hay que enterarse.
 *
 * Se compara contra todas las fechas de las líneas y no solo contra la del
 * pedido, que es la más lejana: si el proveedor confirma la fecha de una de
 * las líneas, no hay nada que discutir.
 *
 * Devuelve la fecha dicha por el proveedor cuando discrepa, y null cuando no
 * hay nada que avisar. El aviso se apaga solo: en cuanto alguien pone esa
 * fecha en Sage, las dos coinciden y desaparece.
 */
export function fechaEnDisputa(input: {
  /** Lo que dijo el proveedor: la aceptada, y si no, la que se le leyó. */
  dicha: string | null | undefined;
  /** Las fechas que hay en Sage para las líneas pendientes. */
  enSage: (string | null | undefined)[];
  /** Cuántas líneas pendientes siguen sin fecha en Sage. */
  sinFecha: number;
}): string | null {
  const dicha = input.dicha?.slice(0, 10);
  if (!dicha) return null;
  // Si todavía faltan fechas en Sage no es una discrepancia, es lo de siempre:
  // el pedido está sin confirmar y ya lo dice la pantalla por otro lado.
  if (input.sinFecha > 0) return null;
  const enSage = input.enSage.filter(Boolean).map((fecha) => String(fecha).slice(0, 10));
  if (enSage.length === 0) return null;
  return enSage.includes(dicha) ? null : dicha;
}
