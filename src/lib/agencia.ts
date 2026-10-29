/*
  Agencia: lo que se gasta con ella frente a lo que venden las consultas.

  Todo el gasto de una marca es una sola inversión y todas sus consultas
  —menos las de Portales/RRSS— cuentan contra ella. El reparto por concepto
  (SEO, SEM...) solo dice en qué se va el dinero; las consultas no se reparten.

  Los meses van como "2026-10".
*/

/**
 * A qué va una partida. La inversión se ve por separado —cuánto a SEO y
 * cuánto a SEM—, pero las consultas y el retorno cuentan todo junto: una
 * consulta no dice si llegó por el SEO o por el SEM.
 */
export type Servicio = "seo" | "sem" | "otro";
export const SERVICIOS: Servicio[] = ["seo", "sem", "otro"];
export const NOMBRE_DEL_SERVICIO: Record<Servicio, string> = { seo: "SEO", sem: "SEM", otro: "Otros" };

/**
 * El servicio que le corresponde a un concepto, para proponerlo al apuntar
 * una partida: lo mismo que hace la migración con las que ya había.
 */
export function servicioSugerido(concepto: string): Servicio {
  if (/\bseo\b|posicionamiento/i.test(concepto)) return "seo";
  if (/\bsem\b|google ads|\bads\b|adwords|campañ|anuncio/i.test(concepto)) return "sem";
  return "otro";
}

/** Una partida del presupuesto: tanto al mes, de un mes a otro (o sin final). */
export type PartidaDeAgencia = {
  id: string;
  /** null: de todas las marcas sin repartir. Cuenta en el total, no en ninguna marca. */
  businessUnitId: string | null;
  concept: string;
  service: Servicio;
  monthlyAmount: number;
  startMonth: string;
  /** null: sigue. Igual que el inicio: un gasto de una sola vez. */
  endMonth: string | null;
  notes: string | null;
};

/** Lo que devuelve agency_inquiry_summary: consultas y ventas por mes y marca. */
export type FilaDeConsultas = {
  month: string;
  business_unit_id: string;
  inquiries: number;
  won: number;
  won_amount: number;
  offered: number;
  offered_amount: number;
};

export type CifrasDeAgencia = {
  invertido: number;
  consultas: number;
  ganadas: number;
  vendido: number;
  ofertas: number;
  ofertado: number;
};

/** Qué marca se mira: una concreta, o todas (con lo que no es de ninguna). */
export type MarcaElegida = string | "todas";

export const CONCEPTOS_SUGERIDOS = ["SEO", "SEM (gestión)", "Google Ads (inversión)", "Contenidos", "Web", "Informes y consultoría"];

/** Los meses de `desde` a `hasta`, los dos incluidos. */
export function mesesDe(desde: string, hasta: string): string[] {
  const meses: string[] = [];
  let [anio, mes] = desde.split("-").map(Number);
  const [anioFin, mesFin] = hasta.split("-").map(Number);
  while (anio < anioFin || (anio === anioFin && mes <= mesFin)) {
    meses.push(`${anio}-${String(mes).padStart(2, "0")}`);
    mes += 1;
    if (mes > 12) { mes = 1; anio += 1; }
  }
  return meses;
}

/**
 * Los meses con los que se calcula un año: hasta el mes en curso si es este
 * año —lo que aún no se ha gastado no puede restar retorno—, el año entero si
 * ya pasó, y entero también si es uno que viene, que entonces es un plan.
 */
export function mesesDelAnio(anio: number, hoy: string): string[] {
  const actual = hoy.slice(0, 7);
  const hasta = Number(actual.slice(0, 4)) === anio ? actual : `${anio}-12`;
  return mesesDe(`${anio}-01`, hasta);
}

/** Lo que una partida cuesta en un mes. */
export function gastoDelMes(partida: PartidaDeAgencia, mes: string): number {
  if (mes < partida.startMonth) return 0;
  if (partida.endMonth !== null && mes > partida.endMonth) return 0;
  return partida.monthlyAmount;
}

const deLaMarca = (marca: MarcaElegida) => (partida: PartidaDeAgencia) => marca === "todas" || partida.businessUnitId === marca;

/** Lo invertido en esos meses. Con «todas», también lo que no es de ninguna marca. */
export function invertidoEn(partidas: PartidaDeAgencia[], meses: string[], marca: MarcaElegida): number {
  return partidas.filter(deLaMarca(marca)).reduce((suma, partida) => suma + meses.reduce((enMes, mes) => enMes + gastoDelMes(partida, mes), 0), 0);
}

/** Lo invertido en esos meses y esa marca, por servicio. */
export function invertidoPorServicio(partidas: PartidaDeAgencia[], meses: string[], marca: MarcaElegida): Record<Servicio, number> {
  const reparto: Record<Servicio, number> = { seo: 0, sem: 0, otro: 0 };
  for (const servicio of SERVICIOS) reparto[servicio] = invertidoEn(partidas.filter((partida) => partida.service === servicio), meses, marca);
  return reparto;
}

/** Lo invertido y lo que han dado las consultas, en esos meses y esa marca. */
export function cifrasDe(partidas: PartidaDeAgencia[], filas: FilaDeConsultas[], meses: string[], marca: MarcaElegida): CifrasDeAgencia {
  const enMeses = new Set(meses);
  const cifras: CifrasDeAgencia = { invertido: invertidoEn(partidas, meses, marca), consultas: 0, ganadas: 0, vendido: 0, ofertas: 0, ofertado: 0 };
  for (const fila of filas) {
    if (!enMeses.has(fila.month) || (marca !== "todas" && fila.business_unit_id !== marca)) continue;
    cifras.consultas += Number(fila.inquiries);
    cifras.ganadas += Number(fila.won);
    cifras.vendido += Number(fila.won_amount);
    cifras.ofertas += Number(fila.offered);
    cifras.ofertado += Number(fila.offered_amount);
  }
  return cifras;
}

export type Retorno = {
  /** Euros vendidos por cada euro invertido. Sin inversión no hay. */
  porEuro: number | null;
  /** (vendido − invertido) / invertido, en tanto por uno. */
  roi: number | null;
  /** Vendido menos invertido, en euros: lo que dice el ROI, en dinero. */
  diferencia: number;
  costePorConsulta: number | null;
  /** Ganadas sobre consultas, en tanto por uno. */
  conversion: number | null;
};

/**
 * El retorno, sobre la venta y no sobre el beneficio: la consulta guarda el
 * importe vendido, no su margen.
 */
export function retornoDe(cifras: CifrasDeAgencia): Retorno {
  const { invertido, vendido, consultas, ganadas } = cifras;
  return {
    porEuro: invertido > 0 ? vendido / invertido : null,
    roi: invertido > 0 ? (vendido - invertido) / invertido : null,
    diferencia: vendido - invertido,
    costePorConsulta: invertido > 0 && consultas > 0 ? invertido / consultas : null,
    conversion: consultas > 0 ? ganadas / consultas : null,
  };
}

export type PuntoDelMes = { mes: string; invertido: number; vendido: number; invertidoAcumulado: number; vendidoAcumulado: number };

/** Mes a mes, con lo acumulado: donde lo vendido cruza lo invertido, la agencia se ha pagado. */
export function mesAMes(partidas: PartidaDeAgencia[], filas: FilaDeConsultas[], meses: string[], marca: MarcaElegida): PuntoDelMes[] {
  let invertidoAcumulado = 0;
  let vendidoAcumulado = 0;
  return meses.map((mes) => {
    const cifras = cifrasDe(partidas, filas, [mes], marca);
    invertidoAcumulado += cifras.invertido;
    vendidoAcumulado += cifras.vendido;
    return { mes, invertido: cifras.invertido, vendido: cifras.vendido, invertidoAcumulado, vendidoAcumulado };
  });
}

/** "SEO", "seo " y "Seo" son el mismo concepto. */
const claveDeConcepto = (concepto: string) => concepto.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Las partidas que ya hay de la misma marca y el mismo concepto con algún mes
 * en común. Cargar dos veces el mismo presupuesto duplicaría el gasto, y el
 * retorno saldría a la mitad sin que nada lo dijera.
 */
export function partidasQueSeSolapan(
  nueva: Pick<PartidaDeAgencia, "businessUnitId" | "concept" | "startMonth" | "endMonth">,
  partidas: PartidaDeAgencia[],
): PartidaDeAgencia[] {
  const clave = claveDeConcepto(nueva.concept);
  return partidas.filter((partida) =>
    partida.businessUnitId === nueva.businessUnitId
    && claveDeConcepto(partida.concept) === clave
    && (nueva.endMonth === null || partida.startMonth <= nueva.endMonth)
    && (partida.endMonth === null || nueva.startMonth <= partida.endMonth));
}

/**
 * En qué se va el dinero, por concepto. "SEO" y "seo " son el mismo: se juntan
 * sin mayúsculas ni espacios de más, con el nombre como se escribió primero.
 */
export function porConcepto(partidas: PartidaDeAgencia[], meses: string[], marca: MarcaElegida): { concepto: string; importe: number }[] {
  const conceptos = new Map<string, { concepto: string; importe: number }>();
  for (const partida of partidas.filter(deLaMarca(marca))) {
    const importe = meses.reduce((suma, mes) => suma + gastoDelMes(partida, mes), 0);
    if (importe === 0) continue;
    const clave = claveDeConcepto(partida.concept);
    const entrada = conceptos.get(clave) ?? { concepto: partida.concept.trim(), importe: 0 };
    entrada.importe += importe;
    conceptos.set(clave, entrada);
  }
  return [...conceptos.values()].sort((a, b) => b.importe - a.importe);
}

/** "Cada mes desde oct 2026", "Solo en oct 2026" o "De ene a jun 2026", para la lista de partidas. */
export function cuandoEs(partida: PartidaDeAgencia, nombreDelMes: (mes: string) => string): string {
  if (partida.endMonth === partida.startMonth) return `Solo en ${nombreDelMes(partida.startMonth)}`;
  if (partida.endMonth === null) return `Cada mes desde ${nombreDelMes(partida.startMonth)}`;
  return `Cada mes de ${nombreDelMes(partida.startMonth)} a ${nombreDelMes(partida.endMonth)}`;
}
