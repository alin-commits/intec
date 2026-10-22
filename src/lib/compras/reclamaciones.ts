/*
  A quién toca reclamarle la fecha, y cuándo.

  La regla la puso compras: a las 48 horas del pedido se le escribe una vez, y
  a las 120 horas otra. Nada más; si después de dos no contesta, es un problema
  de personas y no de recordatorios, y lo sigue quien lleva compras con el
  botón de la pantalla.

  Esto vive aparte de la ruta y del cron a propósito: decidir a quién se le
  escribe es lo único que puede equivocarse de verdad —un correo de más va a
  un proveedor real—, así que se decide en una función sin base de datos ni
  red, y se prueba sola.
*/

/*
  El estado que manda Sage en la cabecera del pedido.

  Un pedido servido puede quedarse con unidades pendientes de sobra —se cierra
  con un resto— y por eso no basta con mirar las unidades: de 533 pedidos con
  algo pendiente, 197 estaban servidos, y entre todos ellos sumaban 11.204 €
  frente a los 705.171 € de los que sí están pendientes. Eran restos, y se les
  estaba reclamando como si faltara el material entero.

  El 1 (parcialmente servido) sí se reclama: falta parte de la mercancía.
  Si el agente no encontró la columna el estado llega vacío, y entonces se
  enseña: no saberlo no es razón para esconder un pedido.
*/
export const ESTADO_SERVIDO = 2;

export function estaServido(status: number | null | undefined): boolean {
  return status === ESTADO_SERVIDO;
}

/** Los dos avisos: a los 2 y a los 5 días de hacer el pedido. */
export const ESCALONES = [
  { nivel: 1 as const, dias: 2 },
  { nivel: 2 as const, dias: 5 },
];

/**
 * Desde cuándo entra el automático.
 *
 * Solo pedidos hechos a partir de aquí. Cuando esto se encendió había 275
 * pedidos sin fecha con una antigüedad mediana de 271 días: dejarlos entrar
 * habría sido mandar 112 correos de golpe, algunos con 19 pedidos de hace más
 * de un año. Esos se reclaman a mano, mirándolos.
 */
export const RECLAMAR_DESDE = "2026-10-22";

/** Un pedido con algo pendiente de que el proveedor diga cuándo llega. */
export type PedidoReclamable = {
  companyCode: number;
  year: number;
  series: string;
  number: number;
  supplierCode: string | null;
  /** yyyy-mm-dd */
  orderDate: string;
  /** Cuántas de sus líneas pendientes siguen sin fecha. Si es 0, no se reclama. */
  lineasSinFecha: number;
  /** El estado de Sage: un pedido servido no se reclama aunque le sobren unidades. */
  status?: number | null;
  pendingAmount: number;
};

/** Lo que ya se ha hecho con ese pedido. Sin fila, es que no se ha tocado. */
export type Seguimiento = {
  state: string;
  level: number;
  /** Hasta cuándo no se le vuelve a escribir (ISO). */
  quietUntil: string | null;
};

/**
 * Un pedido con el escalón que le toca a él.
 *
 * Cada uno lleva el suyo aunque viajen en el mismo correo: si a un pedido que
 * va por el primer aviso se le apuntara el segundo solo por acompañar a otro,
 * se quedaría sin su recordatorio de los cinco días.
 */
export type PedidoAReclamar = PedidoReclamable & { nivel: 1 | 2 };

export type GrupoAReclamar = {
  companyCode: number;
  supplierCode: string;
  /** El escalón más alto de los que van en el correo: es el tono del mensaje. */
  nivel: 1 | 2;
  pedidos: PedidoAReclamar[];
};

/** Estados en los que no se escribe: o ya está resuelto, o alguien lo paró. */
const NO_SE_TOCA = new Set(["confirmado", "contestado", "pausado", "sin_reclamar"]);

export function diasDesde(dia: string, hoy: string): number {
  const desde = new Date(`${dia}T00:00:00Z`).getTime();
  const hasta = new Date(`${hoy}T00:00:00Z`).getTime();
  if (Number.isNaN(desde) || Number.isNaN(hasta)) return 0;
  return Math.max(0, Math.round((hasta - desde) / 86_400_000));
}

/** La clave con la que se mira el seguimiento de un pedido. */
export function clavePedido(p: { companyCode: number; year: number; series: string; number: number }): string {
  return `${p.companyCode}|${p.year}|${p.series}|${p.number}`;
}

/**
 * Qué escalón le toca a un pedido hoy, o null si todavía no toca ninguno.
 *
 * Va por el escalón que ya lleva, no por la edad sola: un pedido de 10 días al
 * que no se le ha escrito nunca recibe el primero, no el segundo. Así, si el
 * cron no corrió un día, al siguiente recupera en vez de saltarse un aviso.
 */
export function escalonQueToca(pedido: PedidoReclamable, seguimiento: Seguimiento | undefined, hoy: string): 1 | 2 | null {
  if (estaServido(pedido.status)) return null;
  if (pedido.lineasSinFecha <= 0) return null;
  if (!pedido.supplierCode) return null;
  if (seguimiento && NO_SE_TOCA.has(seguimiento.state)) return null;
  if (seguimiento?.quietUntil && seguimiento.quietUntil.slice(0, 10) > hoy) return null;

  const hechos = seguimiento?.level ?? 0;
  const siguiente = ESCALONES.find((e) => e.nivel > hechos);
  if (!siguiente) return null;
  return diasDesde(pedido.orderDate, hoy) >= siguiente.dias ? siguiente.nivel : null;
}

/**
 * Los correos que habría que mandar hoy, uno por proveedor.
 *
 * Se agrupa por proveedor y no por pedido porque si no, al que tiene 19
 * pedidos atascados le llegan 19 correos el mismo día y deja de leerlos. En el
 * correo van todos sus pedidos juntos y el registro guarda el escalón más alto.
 */
/**
 * El escalón de una reclamación a mano. Sube igual que la automática y se
 * queda en el segundo: así, si alguien acaba de escribirle, el cron no le
 * vuelve a escribir al día siguiente por su cuenta.
 */
export function escalonAMano(seguimiento: Seguimiento | undefined): 1 | 2 {
  return (seguimiento?.level ?? 0) >= 1 ? 2 : 1;
}

export function reclamacionesDeHoy(input: {
  pedidos: PedidoReclamable[];
  seguimiento: Map<string, Seguimiento>;
  hoy: string;
  /** Pedidos anteriores a esta fecha no entran en el automático. */
  desde?: string;
}): GrupoAReclamar[] {
  const desde = input.desde ?? RECLAMAR_DESDE;
  const grupos = new Map<string, GrupoAReclamar>();

  for (const pedido of input.pedidos) {
    if (pedido.orderDate < desde) continue;
    const nivel = escalonQueToca(pedido, input.seguimiento.get(clavePedido(pedido)), input.hoy);
    if (!nivel) continue;

    const llave = `${pedido.companyCode}-${pedido.supplierCode}`;
    const grupo = grupos.get(llave);
    if (grupo) {
      grupo.pedidos.push({ ...pedido, nivel });
      if (nivel > grupo.nivel) grupo.nivel = nivel;
    } else {
      grupos.set(llave, { companyCode: pedido.companyCode, supplierCode: pedido.supplierCode!, nivel, pedidos: [{ ...pedido, nivel }] });
    }
  }

  // Primero el que más lleva esperando: si un día hay que cortar por donde sea,
  // que se queden fuera los nuevos y no los que llevan desde la semana pasada.
  for (const grupo of grupos.values()) grupo.pedidos.sort((a, b) => a.orderDate.localeCompare(b.orderDate));
  return [...grupos.values()].sort((a, b) => a.pedidos[0].orderDate.localeCompare(b.pedidos[0].orderDate));
}
