// Los cálculos del cuadro de mando de ventas, sin React: los comparten todas
// las páginas y se pueden probar sin navegador. Sin imports, para que los tests
// de node lo carguen tal cual.

const numberFormatter = new Intl.NumberFormat("es-ES");
/** Igual que formatPercent de lib/format. */
const formatPercent = (value: number) => `${value.toFixed(1).replace(".", ",")} %`;

/** Una fila del resumen mensual que devuelve la base de datos. */
export type SummaryRow = {
  month: string;
  company_code: number;
  series: string;
  rep_code: number | null;
  documents: number;
  net_amount: number;
  cost_amount: number;
  net_without_cost: number;
  /**
   * El bruto antes de descuentos y la venta neta de las filas que lo traen: lo
   * cargado antes de que el agente leyera el bruto no lo tiene, y el descuento se
   * mide con los dos sobre las mismas filas. Opcionales porque la venta día a día
   * no los pide.
   */
  gross_amount?: number;
  gross_net?: number;
  /** El descuento de línea: el que pone el comercial en el albarán. */
  line_discount_amount?: number;
  /** La comisión que calcula Sage (cero si allí no se usan comisiones). */
  commission_amount?: number;
};
export type Company = { code: number; name: string; is_active: boolean };
export type Rep = { company_code: number; code: number; name: string; is_person: boolean };
export type SyncRun = { started_at: string; ok: boolean; covered_from: string | null; covered_to: string | null };

/**
 * Lo que se filtra pulsando, como en Power BI.
 *
 * Todos son listas y todos funcionan igual: vacía quiere decir "todas", que es
 * lo que espera cualquiera de un filtro y evita la pantalla en blanco al
 * desmarcar lo último. Marcar varias cosas suma, no resta.
 */
export type SalesFilters = {
  /** Las sociedades marcadas. Vacío: todas. */
  companies: number[];
  /** Los canales marcados. Vacío: todos. */
  channels: string[];
  /** Los comerciales marcados. Vacío: todos. */
  repKeys: string[];
  /** Los meses marcados ("YYYY-MM") dentro del periodo. Vacío: todos. */
  months: string[];
  /** Las familias marcadas. Vacío: todas. */
  families: string[];
  /**
   * Las subfamilias marcadas, como «familia:subfamilia» ("11:003"). Vacío: todas.
   *
   * Con la familia delante porque el código de subfamilia es correlativo
   * dentro de cada familia y se repite entre ellas: suelto no identifica nada.
   */
  subfamilies: string[];
  /** Los proveedores marcados, por su código de Sage. Vacío: todos. */
  suppliers: string[];
};
export const noFilters: SalesFilters = { companies: [], channels: [], repKeys: [], months: [], families: [], subfamilies: [], suppliers: [] };

/**
 * El único valor marcado, o null si no hay ninguno o hay varios.
 *
 * Hay sitios que solo tienen sentido con uno —resaltar su fila, el desglose de
 * una familia en subfamilias, "las ventas de agosto frente a agosto"— y con
 * varios no dicen nada: ahí se pregunta por esto y, si viene vacío, se enseña
 * lo del periodo entero.
 */
export const soloUno = <T>(marcados: T[]): T | null => (marcados.length === 1 ? marcados[0] : null);

/**
 * Quita las subfamilias marcadas que ya no caen dentro de ninguna familia.
 *
 * Una subfamilia solo tiene sentido dentro de su familia: al cambiar las
 * familias marcadas, las que se quedan fuera se van con ellas, y sin ninguna
 * familia marcada no queda ninguna. Se aplica donde se cambia el filtro y no
 * en la pantalla de productos: las familias también se marcan desde la barra
 * de arriba y desde el comparador, y una subfamilia huérfana filtrando por
 * detrás no la entendería nadie.
 */
export function sinSubfamiliasHuerfanas(next: SalesFilters): SalesFilters {
  if (next.subfamilies.length === 0) return next;
  if (next.families.length === 0) return { ...next, subfamilies: [] };
  const suyas = next.subfamilies.filter((key) => next.families.includes(key.slice(0, key.indexOf(":"))));
  return suyas.length === next.subfamilies.length ? next : { ...next, subfamilies: suyas };
}

/** Si algo pasa el filtro. Sin nada marcado pasan todos. */
export const marcado = <T>(marcados: T[], valor: T) => marcados.length === 0 || marcados.includes(valor);

/**
 * Las series de Sage son el canal de venta. Se nombran para que el panel no
 * enseñe códigos; las que no estén aquí salen con su código tal cual.
 */
export const channelNames: Record<string, string> = {
  CRE: "Crédito",
  TK: "Tienda",
  B2C: "Web",
  B2B: "B2B",
  POS: "Punto de venta",
  SAT: "Servicio técnico",
  CON: "Contado",
  ABO: "Abonos",
  CONSUMOS: "Consumos",
  FACREC: "Facturación recurrente",
};
export const channelColors = ["#4f46e5", "#0ea5e9", "#10b981", "#f59e0b", "#ec4899", "#8b5cf6", "#14b8a6", "#f43f5e", "#64748b", "#a16207"];
export const channelLabel = (series: string) => channelNames[series] ?? (series || "Sin serie");

/** Días que tarda un día en dejar de moverse: se corrigen albaranes y se factura. */
export const PROVISIONAL_DAYS = 7;

export const monthNames = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
export const monthLongNames = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
export const monthName = (month: string) => monthLongNames[Number(month.slice(5, 7)) - 1] ?? month;

/**
 * El 16 de octubre de 2025 se cambió el sistema de series en Sage: las series
 * viejas (IM0, IM2, IM5, IM75...) acaban el día 15 y las nuevas (CRE, B2C, POS,
 * B2B, TK, SAT, CON...) arrancan el 16.
 *
 * En las viejas el coste no vale: suma más que la propia venta, con un coste de
 * entre 1,1 y 1,9 veces la base imponible, lo que daría a la empresa un margen
 * negativo del -45 % en 2024 y del -85 % en 2023. En las nuevas sale entre el
 * 25 % y el 35 % todos los meses, que es lo que se espera de una distribuidora.
 *
 * Así que la venta de los años anteriores se enseña —esa sí es buena— y el
 * margen se calcula solo desde el primer mes completo con las series nuevas.
 */
export const COST_TRUSTED_FROM_MONTH = "2025-11";

/**
 * Lo que se suma de un grupo de filas: la venta siempre, el coste solo si vale.
 * El bruto y los descuentos sí valen de todos los años: el cambio de series de
 * 2025 estropeó el coste, no los precios (el descuento sale entre el 18 y el
 * 22 % todos los meses, antes y después).
 */
export type Bucket = {
  net: number;
  documents: number;
  costNet: number;
  cost: number;
  withoutCost: number;
  gross: number;
  grossNet: number;
  lineDiscount: number;
  commission: number;
};
export const emptyBucket = (): Bucket => ({
  net: 0, documents: 0, costNet: 0, cost: 0, withoutCost: 0, gross: 0, grossNet: 0, lineDiscount: 0, commission: 0,
});

export function addRow(bucket: Bucket, row: SummaryRow): void {
  bucket.net += Number(row.net_amount);
  bucket.documents += Number(row.documents);
  bucket.gross += Number(row.gross_amount ?? 0);
  bucket.grossNet += Number(row.gross_net ?? 0);
  bucket.lineDiscount += Number(row.line_discount_amount ?? 0);
  bucket.commission += Number(row.commission_amount ?? 0);
  if (row.month < COST_TRUSTED_FROM_MONTH) return;
  bucket.costNet += Number(row.net_amount);
  bucket.cost += Number(row.cost_amount);
  bucket.withoutCost += Number(row.net_without_cost);
}

/** Suma un grupo ya sumado a otro (los totales de las tablas). */
export function mergeBucket(target: Bucket, source: Bucket): Bucket {
  for (const key of Object.keys(target) as (keyof Bucket)[]) target[key] += source[key];
  return target;
}

/** El bucket de un montón de filas, para la fila de Total de una tabla. */
export function sumBuckets<T>(rows: T[], pick: (row: T) => Bucket): Bucket {
  const bucket = emptyBucket();
  for (const row of rows) mergeBucket(bucket, pick(row));
  return bucket;
}

export function sumRows(list: SummaryRow[]): Bucket {
  const bucket = emptyBucket();
  for (const row of list) addRow(bucket, row);
  return bucket;
}

/**
 * Lo rebajado sobre el precio de tarifa (el bruto), o null si no hay con qué
 * medirlo. `linePercent` es la parte que pone el comercial en la línea; el
 * resto hasta el total son el descuento de la ficha del cliente y el pronto
 * pago. Solo cuenta lo que trae bruto: lo cargado antes de leerlo no está ni en
 * el bruto ni en el neto de la cuenta.
 */
export function bucketDiscount(bucket: Pick<Bucket, "gross" | "grossNet" | "lineDiscount">): { amount: number; percent: number; linePercent: number } | null {
  if (bucket.gross <= 0 || bucket.grossNet <= 0) return null;
  const amount = bucket.gross - bucket.grossNet;
  return { amount, percent: (amount / bucket.gross) * 100, linePercent: (bucket.lineDiscount / bucket.gross) * 100 };
}

/** El descuento de una fila de familia, artículo o grupo de clientes (bruto y neto con bruto). */
export function discountPercent(gross: number | null | undefined, grossNet: number | null | undefined): number | null {
  return bucketDiscount({ gross: Number(gross ?? 0), grossNet: Number(grossNet ?? 0), lineDiscount: 0 })?.percent ?? null;
}

/**
 * El margen sobre la venta que tiene coste fiable, o null cuando no hay nada
 * que medir. Deja fuera dos cosas: lo anterior al cambio de series y la venta
 * sin coste grabado, que si se contara subiría el margen artificialmente.
 */
export function bucketMargin(bucket: Bucket): { amount: number; percent: number } | null {
  const base = bucket.costNet - bucket.withoutCost;
  if (base <= 0) return null;
  return { amount: base - bucket.cost, percent: ((base - bucket.cost) / base) * 100 };
}

/**
 * Euros sin céntimos. En un panel de dirección los decimales son ruido: nadie
 * decide nada por setenta céntimos sobre cinco millones, y encima se comen el
 * ancho que necesitan los nombres de los comerciales. La cifra al céntimo está
 * en Sage, y el pie de la página ya avisa de que manda Sage.
 */
export const euros = (value: number) => `${numberFormatter.format(Math.round(value))} €`;
/** El ticket medio son dos o tres dígitos: ahí el céntimo sí dice algo. */
export const ticketFormatter = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });

const pad = (value: number) => String(value).padStart(2, "0");

/** "2024-03" + n meses. */
export function shiftMonth(month: string, count: number): string {
  const [year, number] = month.split("-").map(Number);
  const index = year * 12 + (number - 1) + count;
  return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}`;
}
/** La pareja de un mes en la comparación ("2026-08" → "2025-08"), o null si no se compara. */
export const pairOf = (month: string | null, offset: number | null) => (month && offset !== null ? shiftMonth(month, offset) : null);
/** "ago", o "ago 25" cuando el periodo abarca varios años. */
export const monthLabel = (month: string, withYear: boolean) => {
  const name = monthNames[Number(month.slice(5, 7)) - 1] ?? month;
  return withYear ? `${name} ${month.slice(2, 4)}` : name;
};
/** "agosto de 2025", para las frases. */
export const monthWithYear = (month: string) => `${monthName(month)} de ${month.slice(0, 4)}`;

/**
 * El mes marcado, cuando hay uno solo.
 *
 * Hay sitios que solo tienen sentido con un mes —"las ventas de agosto frente
 * a las de agosto del año pasado"— y con varios marcados no dicen nada: ahí se
 * pregunta por este y, si viene vacío, se enseña lo del periodo entero.
 */
export const soloUnMes = (filters: SalesFilters) => soloUno(filters.months);

/** Si hay algún mes marcado. */
export const hayMesMarcado = (filters: SalesFilters) => filters.months.length > 0;

/** Si una fila entra con los meses marcados. Sin ninguno marcado, entran todas. */
export const mesMarcado = (filters: SalesFilters, month: string) => marcado(filters.months, month);

/** Las parejas de los meses marcados en la comparación. */
export const parejasDe = (filters: SalesFilters, offset: number | null) =>
  (offset === null ? [] : filters.months.map((month) => shiftMonth(month, offset)));

/**
 * El comercial marcado, cuando hay uno solo.
 *
 * Igual que con los meses: los sitios que hablan de "este comercial" en
 * singular —resaltar su fila, sus objetivos— preguntan por este.
 */
export const soloUnComercial = (filters: SalesFilters) => soloUno(filters.repKeys);

/** Si hay algún comercial marcado. */
export const hayComercialMarcado = (filters: SalesFilters) => filters.repKeys.length > 0;

/** Si una fila entra con los comerciales marcados. Sin ninguno, entran todas. */
export const comercialMarcado = (filters: SalesFilters, key: string) => marcado(filters.repKeys, key);
/** "de 2025", pero "del mismo tramo de 2025". */
const ofPhrase = (versus: string) => (versus.startsWith("el ") ? `del ${versus.slice(3)}` : `de ${versus}`);

/**
 * Lo que el modelo necesita saber del periodo. Lo calcula resolvePeriod (de
 * lib/sales-period), que aquí no se importa para que los tests lo carguen tal cual.
 */
export type PeriodView = {
  /** Los meses del periodo entero. */
  months: string[];
  /** Cuántos meses hay que mover un mes para dar con su pareja; null si no se compara. */
  monthOffset: number | null;
  /** El desfase de los meses marcados, que no siempre es el del periodo entero. */
  selectionOffset: number | null;
  /** Si el total se puede comparar (hay comparación y tiene datos). */
  comparable: boolean;
  /** Tras "que en": "2025", "el mismo tramo de 2025", "agosto de 2025"... */
  versus: string | null;
  /** Si el periodo entero acaba hoy: su último mes va por la mitad. */
  basePartial: boolean;
  /** Si los meses son de más de un año. */
  multiYear: boolean;
};

/**
 * Con un "antes" negativo —un comercial que ya solo arrastra abonos, un canal
 * con margen en pérdidas— la división invierte el signo: mejorar de -10.000 a
 * -5.000 saldría como -50 % en rojo. Y con un "antes" ridículo al lado del
 * "ahora" sale un +499.900 % que no dice nada. En los dos casos es más honesto
 * no comparar.
 */
export const variation = (now: number, before: number) => (before > 0 ? ((now - before) / before) * 100 : null);
/** Redondeado a una décima, y sin "-0,0": un -0,02 % no es una bajada que pintar en rojo. */
export const tenths = (value: number) => Math.round(value * 10) / 10 || 0;
/**
 * El porcentaje de un KPI y, si se le pasa, lo que ese porcentaje es en dinero:
 * "+93,8 % · +33.967 €". El porcentaje solo se presta a leerlo al revés de lo
 * que dice (un +300 % sobre dos mil euros no es una buena noticia).
 */
export const delta = (value: number | null, amount?: string | null) => {
  if (value === null) return { delta: "Sin comparación", positive: true };
  const rounded = tenths(value);
  const percent = `${rounded >= 0 ? "+" : ""}${rounded.toFixed(1).replace(".", ",")} %`;
  return { delta: amount ? `${percent} · ${amount}` : percent, positive: rounded >= 0 };
};

/** "+33.967 €" o "-52.408 €": una diferencia con su signo delante. */
export const signedEuros = (value: number) => `${value >= 0 ? "+" : "-"}${euros(Math.abs(value))}`;

/**
 * En Sage la misma persona está dada de alta varias veces: un código por
 * sociedad y, a veces, el nombre a medias. "SERGIO ALMODOVAR", "Sergio
 * Almodovar" y "Sergio Almodóvar Alcaraz" son uno solo, y salían en tres
 * filas distintas.
 *
 * Se juntan los que se escriben igual salvo tildes y mayúsculas, y también
 * los que son el principio de otro contando palabras enteras, que es el caso
 * del nombre sin apellido. Se queda el más completo.
 *
 * Lo de las palabras enteras evita juntar a quien comparte el nombre de pila:
 * "Juan López" y "Juan Antonio López Toral" siguen siendo dos personas. Lo
 * que la regla no distingue es un apellido añadido de verdad: si algún día
 * hay un "Juan López Martínez" que no sea Juan López, se juntarían.
 */
export function buildRepIdentities(reps: Rep[]): Map<string, { key: string; label: string }> {
  const plain = (name: string) =>
    name.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
  // De más largo a más corto, para que el primero que encaje sea el completo.
  const names = [...new Set(reps.map((rep) => rep.name))].sort((a, b) => plain(b).length - plain(a).length);
  const identities = new Map<string, { key: string; label: string }>();
  for (const name of names) {
    const fuller = names.find((other) => plain(other).startsWith(`${plain(name)} `)) ?? name;
    identities.set(name, { key: plain(fuller), label: fuller });
  }
  return identities;
}

export type RepIdentity = { key: string; label: string; assigned: boolean; isPerson: boolean };
export const UNASSIGNED_KEY = "sin";

/**
 * Quién firma una venta, ya juntadas las fichas repetidas de Sage. `isPerson`
 * separa a los comerciales de verdad de los códigos comodín de Sage
 * ("GENERAL", "SAT INTEC", "Alta Automática"): salen en el ranking porque su
 * venta es real, pero no se les puede decir que suben o que bajan.
 */
export function makeRepOf(reps: Rep[], identities: Map<string, { key: string; label: string }>) {
  return (companyCode: number, repCode: number | null): RepIdentity => {
    if (repCode === null) return { key: UNASSIGNED_KEY, label: "Sin comercial asignado", assigned: false, isPerson: false };
    const rep = reps.find((item) => item.company_code === companyCode && item.code === repCode);
    const identity = rep ? identities.get(rep.name) : undefined;
    return {
      key: identity?.key ?? `${companyCode}-${repCode}`,
      label: identity?.label ?? `Código ${repCode}`,
      assigned: true,
      isPerson: rep?.is_person ?? false,
    };
  };
}

/**
 * El filtro de PostgREST para unas fichas 'sociedad:código', cuando hay que
 * consultar una tabla directamente en vez de llamar a una función.
 *
 * Va por parejas y no por código suelto porque el mismo número es otra persona
 * en otra sociedad: el comercial 5 de una no es el 5 de la otra. Devuelve null
 * cuando no hay nada que filtrar, y se salta cualquier ficha con una forma
 * rara, que esto acaba dentro de una cadena de consulta.
 */
export function repFilterFor(pairs: string[] | null | undefined): string | null {
  if (!pairs || pairs.length === 0) return null;
  const trozos = pairs.flatMap((par) => {
    const encaja = /^(\d+):(\d+|sin)$/.exec(par);
    if (!encaja) return [];
    const [, company, rep] = encaja;
    return [rep === "sin"
      ? `and(company_code.eq.${company},rep_code.is.null)`
      : `and(company_code.eq.${company},rep_code.eq.${rep})`];
  });
  return trozos.length > 0 ? trozos.join(",") : null;
}

/**
 * Las fichas de Sage ('sociedad:código') que corresponden a los comerciales
 * marcados, para filtrar en la base de datos. Nulo = sin filtro.
 *
 * Una misma persona puede tener ficha en varias sociedades, así que de cada
 * comercial salen todas las suyas y se juntan sin repetir.
 */
export function repPairsFor(repKeys: string[], reps: Rep[], identities: Map<string, { key: string; label: string }>, companies: number[]): string[] | null {
  if (repKeys.length === 0) return null;
  const pairs = new Set<string>();
  for (const repKey of repKeys) {
    if (repKey === UNASSIGNED_KEY) {
      for (const code of companies) pairs.add(`${code}:sin`);
      continue;
    }
    const suyas = reps
      .filter((rep) => (identities.get(rep.name)?.key ?? `${rep.company_code}-${rep.code}`) === repKey)
      .map((rep) => `${rep.company_code}:${rep.code}`);
    if (suyas.length > 0) {
      for (const par of suyas) pairs.add(par);
      continue;
    }
    // Un código sin ficha en Sage llega como "sociedad-código".
    const match = /^(\d+)-(\d+)$/.exec(repKey);
    if (match) pairs.add(`${match[1]}:${match[2]}`);
  }
  return [...pairs];
}

/**
 * Las series de Sage que forman los canales marcados (varias series pueden dar
 * el mismo nombre de canal). Nulo = sin filtro.
 */
export function seriesFor(channels: string[], allSeries: string[]): string[] | null {
  if (channels.length === 0) return null;
  return allSeries.filter((series) => channels.includes(channelLabel(series)));
}

/** Lo que el panel señala solo, para que no haya que ir buscándolo. */
export type Finding = {
  tone: "bad" | "warn" | "good";
  text: string;
  /** Lo que se filtra al pulsar el aviso, para ir directo a lo que señala. */
  filter?: Partial<SalesFilters>;
};

/** Por qué se puede partir una fila de ventas. */
export type Dimension = "company" | "channel" | "rep" | "month";

/**
 * Filtra las filas por todo lo elegido menos lo que se pida saltar: el cuadro
 * que pinta una dimensión no se filtra por ella misma, o al pulsar un
 * comercial desaparecerían los demás y ya no se podría cambiar de opinión.
 */
export function filterRows(
  rows: SummaryRow[],
  filters: SalesFilters,
  repOf: (companyCode: number, repCode: number | null) => RepIdentity,
  skip: Dimension[] = [],
  monthsOverride?: string[],
): SummaryRow[] {
  const months = monthsOverride ?? filters.months;
  return rows.filter((row) => {
    if (!skip.includes("company") && !marcado(filters.companies, row.company_code)) return false;
    if (!skip.includes("channel") && !marcado(filters.channels, channelLabel(row.series))) return false;
    if (!skip.includes("rep") && !comercialMarcado(filters, repOf(row.company_code, row.rep_code).key)) return false;
    if (!skip.includes("month") && months.length > 0 && !months.includes(row.month)) return false;
    return true;
  });
}

/** Suma una lista de filas agrupada por una clave. */
export function groupRows<K>(rows: SummaryRow[], keyOf: (row: SummaryRow) => K): Map<K, Bucket> {
  const map = new Map<K, Bucket>();
  for (const row of rows) {
    const key = keyOf(row);
    const bucket = map.get(key) ?? emptyBucket();
    addRow(bucket, row);
    map.set(key, bucket);
  }
  return map;
}

/** Un objetivo de venta guardado en el Hub (Sage no tiene presupuesto). */
export type SalesTarget = { id: string; year: number; month: number; company_code: number | null; rep_key: string | null; amount: number };

/**
 * Los objetivos de un ámbito exacto, mes a mes (índice 0 = enero; null = sin
 * objetivo). El ámbito es la sociedad y el comercial elegidos: el objetivo del
 * grupo no se reparte solo entre sociedades, porque eso lo decide Dirección.
 */
export function targetsFor(targets: SalesTarget[], year: number, companies: number[], repKeys: string[]): (number | null)[] {
  const months: (number | null)[] = Array.from({ length: 12 }, () => null);
  for (const target of targets) {
    // Sin sociedades marcadas, el objetivo del grupo; con varias, la suma de
    // las suyas, igual que con los comerciales.
    const deSuSociedad = companies.length === 0 ? target.company_code === null : target.company_code !== null && companies.includes(target.company_code);
    if (target.year !== year || !deSuSociedad) continue;
    // Sin comerciales marcados, el objetivo del ámbito entero; con varios, la
    // suma de los suyos, para que el cumplimiento siga queriendo decir lo mismo.
    const suyo = repKeys.length === 0
      ? target.rep_key === null
      : target.rep_key !== null && repKeys.includes(target.rep_key);
    if (!suyo) continue;
    months[target.month - 1] = (months[target.month - 1] ?? 0) + Number(target.amount);
  }
  return months;
}

/**
 * Lo que va de objetivo hasta el mes que se mira: los meses cerrados enteros y
 * el mes en curso en proporción a los días que han pasado. Si no, a mitad de
 * mes siempre parecería que se va por detrás.
 */
export function targetToDate(months: (number | null)[], year: number, today: Date, onlyMonth: number | null = null): { target: number; months: string[] } | null {
  let target = 0;
  const counted: string[] = [];
  const currentYear = today.getFullYear();
  for (let index = 0; index < 12; index += 1) {
    if (onlyMonth !== null && index !== onlyMonth) continue;
    const amount = months[index];
    if (amount === null) continue;
    if (year > currentYear || (year === currentYear && index > today.getMonth())) continue;
    if (year === currentYear && index === today.getMonth()) {
      const days = new Date(year, index + 1, 0).getDate();
      target += amount * (today.getDate() / days);
    } else {
      target += amount;
    }
    counted.push(`${year}-${pad(index + 1)}`);
  }
  return counted.length > 0 ? { target, months: counted } : null;
}

export type SalesModel = ReturnType<typeof computeSalesModel>;

/** Cuánto sube o baja un comercial, un canal o una sociedad de un periodo al otro. */
export type Difference = { key: string; label: string; now: number; before: number; change: number; muted: boolean };

/**
 * Todo lo que se pinta de las ventas a partir de las filas del periodo y de
 * las del periodo con el que se compara, con los filtros puestos.
 */
export function computeSalesModel(input: {
  rows: SummaryRow[];
  previousRows: SummaryRow[];
  filters: SalesFilters;
  period: PeriodView;
  companies: Company[];
  repOf: (companyCode: number, repCode: number | null) => RepIdentity;
}) {
  const { rows, previousRows, filters, period, companies, repOf } = input;
  const pairMonths = parejasDe(filters, period.selectionOffset);
  // Sin una comparación válida del total, el "antes" se queda vacío y las
  // flechas dicen "Sin comparación". Mes a mes se sigue comparando lo que haya.
  const comparedRows = period.comparable ? previousRows : [];
  /*
    Dónde buscar la pareja de los meses marcados.

    Comparando con «el periodo justo anterior», la pareja de agosto es julio, y
    julio está en las filas de lo que se mira, no en las del periodo de al
    lado. Así que se busca en los dos sitios. No se suma nada dos veces: la
    pareja de un mes marcado siempre es un mes distinto de los marcados.
  */
  const beforeRows = pairMonths.length > 0 && period.comparable ? [...previousRows, ...rows] : comparedRows;

  const visible = filterRows(rows, filters, repOf);
  const visibleBefore = filterRows(beforeRows, filters, repOf, [], pairMonths.length > 0 ? pairMonths : undefined);
  const current = sumRows(visible);
  const previous = sumRows(visibleBefore);
  const currentMargin = bucketMargin(current);
  const previousMargin = bucketMargin(previous);

  /**
   * El coste solo vale desde noviembre de 2025, así que en 2026 el margen cubre
   * doce meses y el de 2025 solo dos. Compararlos daría un +500 % con flecha
   * verde. Solo se compara cuando los dos periodos cubren los mismos meses,
   * cada uno con su pareja.
   */
  const trustedMonthsOf = (list: SummaryRow[]) =>
    new Set(list.filter((row) => row.month >= COST_TRUSTED_FROM_MONTH).map((row) => row.month));
  const nowMonths = trustedMonthsOf(visible);
  const beforeMonths = trustedMonthsOf(visibleBefore);
  const paired = new Set([...nowMonths].map((month) => pairOf(month, period.monthOffset)));
  const marginSpansMatch = nowMonths.size > 0 && paired.size === beforeMonths.size && [...beforeMonths].every((month) => paired.has(month));
  const withoutCostShare = current.costNet > 0 ? (current.withoutCost / current.costNet) * 100 : 0;
  /** Venta del periodo que se queda fuera del margen por venir de las series viejas. */
  const netBeforeSeriesChange = current.net - current.costNet;

  // ---- Mes a mes: sin el filtro de mes, para poder pulsar cualquier mes ----
  const byMonth = (list: SummaryRow[]) => {
    const map = new Map<string, Bucket>();
    for (const row of list) {
      const bucket = map.get(row.month) ?? emptyBucket();
      addRow(bucket, row);
      map.set(row.month, bucket);
    }
    return map;
  };
  const monthNow = byMonth(filterRows(rows, filters, repOf, ["month"]));
  // Comparando con el año anterior, este llega recortado al mismo día que hoy,
  // así que su mes en curso mide lo mismo que el nuestro: septiembre a medias
  // contra septiembre a medias.
  const monthBefore = byMonth(filterRows(previousRows, filters, repOf, ["month"]));
  // Los meses del periodo, que nunca pasan de hoy: si se pintaran los doce de
  // un año en curso, la línea caería a cero en octubre y parecería que la
  // empresa se ha hundido.
  const months = period.months.map((key, index) => {
    const bucket = monthNow.get(key) ?? emptyBucket();
    const pair = pairOf(key, period.monthOffset);
    return {
      index,
      key,
      label: monthLabel(key, period.multiYear),
      /** El mes con el que se compara. */
      pair,
      bucket,
      margin: bucketMargin(bucket),
      beforeNet: pair ? (monthBefore.get(pair) ?? emptyBucket()).net : 0,
    };
  });
  let runNow = 0;
  let runBefore = 0;
  let runMargin = 0;
  const running = months.map((month) => {
    runNow += month.bucket.net;
    runBefore += month.beforeNet;
    runMargin += month.margin?.amount ?? 0;
    return { label: month.label, ventas: Math.round(runNow), anterior: Math.round(runBefore), margen: Math.round(runMargin) };
  });
  const currentMonth = period.basePartial ? months[months.length - 1] ?? null : null;
  const monthly = {
    months,
    currentMonth,
    points: months.map((month) => ({
      label: month.label,
      ventas: Math.round(month.bucket.net),
      anterior: Math.round(month.beforeNet),
      margen: Math.round(month.margin?.amount ?? 0),
    })),
    running,
    // La línea de margen solo se dibuja si la tienen todos los meses con venta:
    // si no, caería a cero en los de las series viejas y parecería un desplome.
    marginComplete: months.every((month) => month.bucket.net === 0 || month.margin !== null),
    hasBefore: months.some((month) => month.beforeNet > 0),
  };

  // ---- Por sociedad: sin el filtro de sociedad, para poder pulsar otra ----
  const companyMap = new Map<number, Bucket>();
  for (const row of filterRows(rows, filters, repOf, ["company"])) {
    const bucket = companyMap.get(row.company_code) ?? emptyBucket();
    addRow(bucket, row);
    companyMap.set(row.company_code, bucket);
  }
  const byCompany = [...companyMap].map(([code, bucket]) => ({
    code,
    name: companies.find((company) => company.code === code)?.name ?? `Sociedad ${code}`,
    bucket,
    margin: bucketMargin(bucket),
  })).sort((a, b) => b.bucket.net - a.bucket.net);
  const companiesTotal = emptyBucket();
  for (const company of byCompany) mergeBucket(companiesTotal, company.bucket);

  // ---- Por comercial: sin el filtro de comercial ----
  const forReps = filterRows(rows, filters, repOf, ["rep"]);
  const forRepsBefore = filterRows(beforeRows, filters, repOf, ["rep"], pairMonths.length > 0 ? pairMonths : undefined);
  const repMap = new Map<string, { name: string; assigned: boolean; isPerson: boolean; bucket: Bucket }>();
  for (const row of forReps) {
    const who = repOf(row.company_code, row.rep_code);
    const entry = repMap.get(who.key) ?? { name: who.label, assigned: who.assigned, isPerson: who.isPerson, bucket: emptyBucket() };
    addRow(entry.bucket, row);
    repMap.set(who.key, entry);
  }
  const repBefore = new Map<string, number>();
  for (const row of forRepsBefore) {
    const who = repOf(row.company_code, row.rep_code);
    repBefore.set(who.key, (repBefore.get(who.key) ?? 0) + Number(row.net_amount));
  }
  const byRep = [...repMap]
    .map(([key, value]) => ({ key, ...value, margin: bucketMargin(value.bucket), beforeNet: repBefore.get(key) ?? 0 }))
    .sort((a, b) => b.bucket.net - a.bucket.net);
  const repsTotal = sumRows(forReps);
  const repsMargin = bucketMargin(repsTotal);

  // ---- Por canal: sin el filtro de canal ----
  const TOP_CHANNELS = 8;
  const channelSums = new Map<string, number>();
  const channelBuckets = new Map<string, Bucket>();
  for (const row of filterRows(rows, filters, repOf, ["channel"])) {
    const label = channelLabel(row.series);
    channelSums.set(label, (channelSums.get(label) ?? 0) + Number(row.net_amount));
    const bucket = channelBuckets.get(label) ?? emptyBucket();
    addRow(bucket, row);
    channelBuckets.set(label, bucket);
  }
  // Los abonos van en negativo y una rosquilla no los puede dibujar, así que
  // se apartan y se dicen debajo.
  const positive = [...channelSums].filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1]);
  const refunds = [...channelSums].reduce((sum, [, value]) => (value < 0 ? sum + value : sum), 0);
  // Con muchas series las etiquetas salen cortadas, así que la cola se junta en
  // una sola porción, que no es pulsable porque no es un canal.
  const head = positive.slice(0, TOP_CHANNELS);
  const tail = positive.slice(TOP_CHANNELS);
  const shownChannels: [string, number][] = tail.length > 0
    ? [...head, [`Otras ${tail.length} series`, tail.reduce((sum, [, value]) => sum + value, 0)]]
    : head;
  const realChannels = new Set(positive.map(([label]) => label));
  const channelMargins = [...channelBuckets]
    .filter(([label]) => realChannels.has(label))
    .map(([label, bucket]) => ({ label, net: bucket.net, margin: bucketMargin(bucket) }));
  const byChannel = {
    items: shownChannels.map(([label, value], index) => ({ label, value: Math.round(value), color: channelColors[index % channelColors.length] })),
    buckets: channelBuckets,
    refunds,
    real: realChannels,
    total: shownChannels.reduce((sum, [, value]) => sum + value, 0),
  };

  // ---- Lo que hay que mirar ----
  const findings: Finding[] = [];
  if (repsTotal.net > 0) {
    const desde = period.versus ?? "";
    // Solo se compara a quien ya vendía: el que empezó este año no "cae" ni "sube".
    const comparables = byRep
      .filter((rep) => rep.isPerson && rep.beforeNet > (hayMesMarcado(filters) ? 5000 : 50000))
      .map((rep) => ({ rep, change: ((rep.bucket.net - rep.beforeNet) / rep.beforeNet) * 100 }));
    for (const { rep, change } of comparables.filter((item) => item.change <= -15).sort((a, b) => a.change - b.change).slice(0, 2)) {
      findings.push({ tone: "bad", filter: { repKeys: [rep.key] }, text: `${rep.name} vende un ${formatPercent(Math.abs(change))} menos que en ${desde}: ${euros(rep.bucket.net)} frente a ${euros(rep.beforeNet)}.` });
    }
    for (const { rep, change } of comparables.filter((item) => item.change >= 25).sort((a, b) => b.change - a.change).slice(0, 1)) {
      findings.push({ tone: "good", filter: { repKeys: [rep.key] }, text: `${rep.name} es quien más sube: un ${formatPercent(change)} más que en ${desde}, hasta ${euros(rep.bucket.net)}.` });
    }
    // Vender mucho con poco margen es justo lo que el PDF pide vigilar.
    const media = repsMargin?.percent ?? null;
    if (media !== null) {
      byRep
        .flatMap((rep) => (rep.isPerson && rep.margin && rep.bucket.net > repsTotal.net * 0.03 ? [{ rep, percent: rep.margin.percent }] : []))
        .filter((item) => item.percent <= media - 8)
        .sort((a, b) => a.percent - b.percent)
        .slice(0, 2)
        .forEach(({ rep, percent }) => findings.push({
          tone: "warn",
          filter: { repKeys: [rep.key] },
          text: `${rep.name} vende ${euros(rep.bucket.net)} al ${formatPercent(percent)} de margen, ${formatPercent(media - percent)} por debajo de la media.`,
        }));
      channelMargins
        .filter((item) => item.margin !== null && item.net > repsTotal.net * 0.02)
        .sort((a, b) => (a.margin?.percent ?? 0) - (b.margin?.percent ?? 0))
        .slice(0, 1)
        .filter((item) => (item.margin?.percent ?? 0) <= media - 8)
        .forEach((item) => findings.push({ tone: "warn", filter: { channels: [item.label] }, text: `El canal con peor margen es ${item.label}: ${euros(item.net)} al ${formatPercent(item.margin?.percent ?? 0)}.` }));
    }
    // Si tres personas son media empresa, eso es un riesgo, no un dato.
    const personas = byRep.filter((rep) => rep.isPerson);
    const top3 = personas.slice(0, 3).reduce((sum, rep) => sum + rep.bucket.net, 0);
    const totalPersonas = personas.reduce((sum, rep) => sum + rep.bucket.net, 0);
    if (totalPersonas > 0 && personas.length > 4 && top3 > 0 && top3 <= totalPersonas && top3 / totalPersonas >= 0.55) {
      findings.push({
        tone: "warn",
        text: `Tres comerciales concentran el ${formatPercent((top3 / totalPersonas) * 100)} de lo que venden las personas: ${personas.slice(0, 3).map((rep) => rep.name.split(" ").slice(0, 2).join(" ")).join(", ")}.`,
      });
    }
    const unassigned = byRep.find((rep) => rep.key === UNASSIGNED_KEY);
    if (unassigned && unassigned.bucket.net > repsTotal.net * 0.08) {
      findings.push({ tone: "warn", filter: { repKeys: [UNASSIGNED_KEY] }, text: `${euros(unassigned.bucket.net)} de venta no tienen comercial asignado en Sage, el ${formatPercent((unassigned.bucket.net / repsTotal.net) * 100)} del total.` });
    }
    // El descuento es lo que el director comercial controla: quién rebaja más que
    // el resto y si la rebaja media sube respecto al año pasado.
    const repsDiscount = bucketDiscount(repsTotal);
    if (repsDiscount) {
      byRep
        .flatMap((rep) => {
          const discount = bucketDiscount(rep.bucket);
          return rep.isPerson && discount && rep.bucket.net > repsTotal.net * 0.03 ? [{ rep, discount }] : [];
        })
        .filter((item) => item.discount.percent >= repsDiscount.percent + 5)
        .sort((a, b) => b.discount.percent - a.discount.percent)
        .slice(0, 2)
        .forEach(({ rep, discount }) => findings.push({
          tone: "warn",
          filter: { repKeys: [rep.key] },
          text: `${rep.name} rebaja un ${formatPercent(discount.percent)} sobre tarifa, ${(discount.percent - repsDiscount.percent).toFixed(1).replace(".", ",")} puntos más que la media, en ${euros(rep.bucket.net)} de venta.`,
        }));
    }
    const nowDiscount = bucketDiscount(current);
    const beforeDiscount = bucketDiscount(previous);
    if (nowDiscount && beforeDiscount && nowDiscount.percent - beforeDiscount.percent >= 2) {
      findings.push({
        tone: "warn",
        text: `El descuento medio sube al ${formatPercent(nowDiscount.percent)}, frente al ${formatPercent(beforeDiscount.percent)} ${ofPhrase(desde)}: cada punto de descuento cuesta unos ${euros(current.gross / 100)}.`,
      });
    }
    // Decir que agosto es el mes más flojo no es un hallazgo, lo es todos los
    // años. Lo que importa es el mes que vende menos que su pareja (el mismo
    // mes del año pasado, si se compara con él). El mes en curso se deja fuera
    // porque va por la mitad.
    if (!hayMesMarcado(filters)) {
      const ongoing = period.basePartial ? months.length - 1 : months.length;
      months
        .filter((month) => month.index < ongoing && month.pair !== null && month.beforeNet > 0 && month.bucket.net > 0)
        .map((month) => ({ month, change: ((month.bucket.net - month.beforeNet) / month.beforeNet) * 100 }))
        .filter((item) => item.change <= -15)
        .sort((a, b) => a.change - b.change)
        .slice(0, 1)
        .forEach(({ month, change }) => findings.push({
          tone: "bad",
          filter: { months: [month.key] },
          text: `En ${monthWithYear(month.key)} se vendió un ${formatPercent(Math.abs(change))} menos que en ${monthWithYear(month.pair ?? month.key)}: ${euros(month.bucket.net)} frente a ${euros(month.beforeNet)}.`,
        }));
    }
  }

  // ---- Qué explica la diferencia entre un periodo y el otro ----
  const differencesOf = (
    nowList: SummaryRow[],
    beforeList: SummaryRow[],
    who: (row: SummaryRow) => { key: string; label: string; muted?: boolean },
  ): Difference[] => {
    const map = new Map<string, Difference>();
    const add = (row: SummaryRow, field: "now" | "before") => {
      const item = who(row);
      const entry = map.get(item.key) ?? { key: item.key, label: item.label, now: 0, before: 0, change: 0, muted: item.muted ?? false };
      entry[field] += Number(row.net_amount);
      map.set(item.key, entry);
    };
    for (const row of nowList) add(row, "now");
    for (const row of beforeList) add(row, "before");
    return [...map.values()].map((entry) => ({ ...entry, change: entry.now - entry.before })).sort((a, b) => b.change - a.change);
  };
  // Cada lista sin su propio filtro, como los rankings: pulsar uno filtra por él.
  const differences = period.comparable
    ? {
        rep: differencesOf(forReps, forRepsBefore, (row) => {
          const who = repOf(row.company_code, row.rep_code);
          return { key: who.key, label: who.label, muted: !who.assigned || who.key === UNASSIGNED_KEY };
        }),
        channel: differencesOf(
          filterRows(rows, filters, repOf, ["channel"]),
          filterRows(beforeRows, filters, repOf, ["channel"], pairMonths.length > 0 ? pairMonths : undefined),
          (row) => ({ key: channelLabel(row.series), label: channelLabel(row.series) }),
        ),
        company: differencesOf(
          filterRows(rows, filters, repOf, ["company"]),
          filterRows(beforeRows, filters, repOf, ["company"], pairMonths.length > 0 ? pairMonths : undefined),
          (row) => ({ key: String(row.company_code), label: companies.find((company) => company.code === row.company_code)?.name ?? `Sociedad ${row.company_code}` }),
        ),
      }
    : null;

  return {
    visible,
    current,
    previous,
    currentMargin,
    previousMargin,
    currentDiscount: bucketDiscount(current),
    previousDiscount: bucketDiscount(previous),
    /** Si Sage calcula comisiones: allí pueden no usarse, y entonces no se enseñan ceros. */
    hasCommissions: rows.some((row) => Number(row.commission_amount ?? 0) !== 0),
    marginSpansMatch,
    withoutCostShare,
    netBeforeSeriesChange,
    marginCoversEverything: netBeforeSeriesChange <= 0,
    monthly,
    byCompany,
    companiesMargin: bucketMargin(companiesTotal),
    companiesTotal,
    byRep,
    repsTotal,
    repsMargin,
    byChannel,
    channelMargins,
    findings,
    differences,
    available: {
      channels: new Set(rows.map((row) => channelLabel(row.series))),
      reps: new Set(rows.map((row) => repOf(row.company_code, row.rep_code).key)),
    },
  };
}

/** Los colores de los años, del más reciente (el fuerte) hacia atrás. */
export const yearColors = ["#4f46e5", "#0ea5e9", "#f59e0b", "#10b981", "#ec4899", "#94a3b8", "#a16207"];

/**
 * Un año contra otro: la venta de cada año mes a mes, para pintarlos uno
 * encima de otro, y el total de cada año con su variación.
 *
 * La variación solo cuenta los meses cerrados que tienen los dos años: el mes
 * en curso va por la mitad, y el primer año del histórico no está entero (2023
 * contra agosto-diciembre de 2022 daría un +140 % que no es verdad). Cuando no
 * son los doce meses se dice cuáles son.
 */
export function yearlyView(input: {
  rows: SummaryRow[];
  filters: SalesFilters;
  repOf: (companyCode: number, repCode: number | null) => RepIdentity;
  months: string[];
  basePartial: boolean;
}) {
  const { rows, filters, repOf, months, basePartial } = input;
  const byMonth = groupRows(filterRows(rows, filters, repOf, ["month"]), (row) => row.month);
  const years = [...new Set(months.map((month) => Number(month.slice(0, 4))))].sort((a, b) => a - b);
  const inPeriod = new Set(months);
  const closed = new Set(basePartial ? months.slice(0, -1) : months);
  // Un mes fuera del periodo no es un cero: la línea se corta en vez de caer.
  const points = monthNames.map((label, index) => {
    const point: Record<string, number | string | null> = { label };
    for (const year of years) {
      const key = `${year}-${pad(index + 1)}`;
      point[`y${year}`] = inPeriod.has(key) ? Math.round(byMonth.get(key)?.net ?? 0) : null;
    }
    return point;
  });
  const table = years.map((year) => {
    const own = months.filter((month) => month.startsWith(`${year}-`));
    const bucket = own.reduce((total, month) => mergeBucket(total, byMonth.get(month) ?? emptyBucket()), emptyBucket());
    const common = own.filter((month) => closed.has(month) && closed.has(shiftMonth(month, -12)));
    const now = common.reduce((sum, month) => sum + (byMonth.get(month)?.net ?? 0), 0);
    const before = common.reduce((sum, month) => sum + (byMonth.get(shiftMonth(month, -12))?.net ?? 0), 0);
    const span = common.length === 0 || common.length === 12
      ? null
      : `${monthNames[Number(common[0].slice(5, 7)) - 1]}–${monthNames[Number(common[common.length - 1].slice(5, 7)) - 1]}`;
    return {
      year,
      bucket,
      /** Meses del año dentro del periodo, y si están todos cerrados. */
      months: own.length,
      complete: own.length === 12 && own.every((month) => closed.has(month)),
      change: common.length > 0 ? variation(now, before) : null,
      /** Lo que crece o baja en dinero en esos mismos meses, para decirlo al lado del porcentaje. */
      changeAmount: common.length > 0 ? now - before : null,
      /** Los meses que entran en la variación, cuando no son los doce. */
      span,
    };
  });
  return {
    years,
    points,
    table,
    series: years.map((year, index) => ({ key: `y${year}`, label: String(year), color: yearColors[(years.length - 1 - index) % yearColors.length] })),
  };
}

/* -------------------------------------------------------------------------
   Lo que no pasó por Sage
   ------------------------------------------------------------------------- */

/** Una cifra mensual de una empresa que (todavía) no está en Sage. */
export type VentaDeFuera = { month: string; company_code: number | null; net_amount: number };

/**
 * Las de fuera que caen dentro del filtro de sociedad.
 *
 * Una empresa que todavía no está en Sage no tiene sociedad, así que cuenta
 * cuando no hay filtro puesto y desaparece en cuanto se mira una sociedad
 * concreta: no se la puede colgar de una sociedad que no existe. Es la misma
 * regla que aplica la función de la base, y por el mismo motivo.
 */
export function externasDelFiltro<T extends VentaDeFuera>(lista: T[], companies: number[]): T[] {
  if (companies.length === 0) return lista;
  return lista.filter((fila) => fila.company_code !== null && companies.includes(fila.company_code));
}

/**
 * Cuánto hay de fuera en cada mes, por "YYYY-MM".
 *
 * Hace falta para que la línea del año no caiga a cero en los meses que una
 * empresa todavía no estaba en Sage: Jender no tiene nada de enero a
 * septiembre de 2025 porque entró el 6 de octubre.
 */
export function externasPorMes(lista: VentaDeFuera[], companies: number[]): Map<string, number> {
  const mapa = new Map<string, number>();
  for (const fila of externasDelFiltro(lista, companies)) {
    const clave = String(fila.month).slice(0, 7);
    mapa.set(clave, (mapa.get(clave) ?? 0) + Number(fila.net_amount));
  }
  return mapa;
}
