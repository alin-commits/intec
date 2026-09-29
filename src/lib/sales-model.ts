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
};
export type Company = { code: number; name: string; is_active: boolean };
export type Rep = { company_code: number; code: number; name: string; is_person: boolean };
export type SyncRun = { started_at: string; ok: boolean; covered_from: string | null; covered_to: string | null };

/** Lo que se filtra pulsando, como en Power BI. Nulo = sin filtro. */
export type SalesFilters = {
  company: number | null;
  channel: string | null;
  repKey: string | null;
  /** "YYYY-MM" dentro del año elegido. */
  month: string | null;
  family: string | null;
};
export const noFilters: SalesFilters = { company: null, channel: null, repKey: null, month: null, family: null };

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

/** Lo que se suma de un grupo de filas: la venta siempre, el coste solo si vale. */
export type Bucket = { net: number; documents: number; costNet: number; cost: number; withoutCost: number };
export const emptyBucket = (): Bucket => ({ net: 0, documents: 0, costNet: 0, cost: 0, withoutCost: 0 });

export function addRow(bucket: Bucket, row: SummaryRow): void {
  bucket.net += Number(row.net_amount);
  bucket.documents += Number(row.documents);
  if (row.month < COST_TRUSTED_FROM_MONTH) return;
  bucket.costNet += Number(row.net_amount);
  bucket.cost += Number(row.cost_amount);
  bucket.withoutCost += Number(row.net_without_cost);
}

export function sumRows(list: SummaryRow[]): Bucket {
  const bucket = emptyBucket();
  for (const row of list) addRow(bucket, row);
  return bucket;
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

/**
 * El mismo día del año anterior. Un 29 de febrero daría "2027-02-29", que no
 * existe: Postgres responde "date/time field value out of range" y el panel se
 * quedaría sin datos. Se recorta al último día que tenga ese mes.
 */
export function sameDayPreviousYear(year: number, today: Date): string {
  const month = today.getMonth();
  const lastDay = new Date(year - 1, month + 1, 0).getDate();
  const day = Math.min(today.getDate(), lastDay);
  return `${year - 1}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const pad = (value: number) => String(value).padStart(2, "0");
const dateKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/**
 * El periodo que se mira: el año entero, o un mes si se ha pulsado uno. Un
 * periodo en curso acaba hoy, y se compara con el mismo tramo del año anterior
 * (si no, en septiembre siempre parecería que se ha vendido un 30 % menos).
 */
export function periodOf(year: number, month: string | null, today: Date): { from: string; to: string; partial: boolean; previousFrom: string; previousTo: string } {
  const todayKey = dateKey(today);
  let from = `${year}-01-01`;
  let to = `${year}-12-31`;
  if (month) {
    const [y, m] = month.split("-").map(Number);
    from = `${month}-01`;
    to = `${month}-${pad(new Date(y, m, 0).getDate())}`;
  }
  const partial = to >= todayKey && from <= todayKey;
  if (partial) to = todayKey;
  const shift = (key: string) => {
    const [y, m, d] = key.split("-").map(Number);
    const lastDay = new Date(y - 1, m, 0).getDate();
    return `${y - 1}-${pad(m)}-${pad(Math.min(d, lastDay))}`;
  };
  return { from, to, partial, previousFrom: shift(from), previousTo: shift(to) };
}

/**
 * Con un "antes" negativo —un comercial que ya solo arrastra abonos, un canal
 * con margen en pérdidas— la división invierte el signo: mejorar de -10.000 a
 * -5.000 saldría como -50 % en rojo. Y con un "antes" ridículo al lado del
 * "ahora" sale un +499.900 % que no dice nada. En los dos casos es más honesto
 * no comparar.
 */
export const variation = (now: number, before: number) => (before > 0 ? ((now - before) / before) * 100 : null);
export const delta = (value: number | null) =>
  value === null
    ? { delta: "Sin comparación", positive: true }
    : { delta: `${value >= 0 ? "+" : ""}${value.toFixed(1).replace(".", ",")} %`, positive: value >= 0 };

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
 * Las fichas de Sage ('sociedad:código') que corresponden a una persona del
 * panel, para filtrar en la base de datos. Nulo = sin filtro.
 */
export function repPairsFor(repKey: string | null, reps: Rep[], identities: Map<string, { key: string; label: string }>, companies: number[]): string[] | null {
  if (repKey === null) return null;
  if (repKey === UNASSIGNED_KEY) return companies.map((code) => `${code}:sin`);
  const pairs = reps
    .filter((rep) => (identities.get(rep.name)?.key ?? `${rep.company_code}-${rep.code}`) === repKey)
    .map((rep) => `${rep.company_code}:${rep.code}`);
  if (pairs.length > 0) return pairs;
  // Un código sin ficha en Sage llega como "sociedad-código".
  const match = /^(\d+)-(\d+)$/.exec(repKey);
  return match ? [`${match[1]}:${match[2]}`] : [];
}

/** Las series de Sage que forman un canal del panel (varias pueden dar el mismo nombre). */
export function seriesFor(channel: string | null, allSeries: string[]): string[] | null {
  if (channel === null) return null;
  return allSeries.filter((series) => channelLabel(series) === channel);
}

/** Lo que el panel señala solo, para que no haya que ir buscándolo. */
export type Finding = {
  tone: "bad" | "warn" | "good";
  text: string;
  /** Lo que se filtra al pulsar el aviso, para ir directo a lo que señala. */
  filter?: Partial<SalesFilters>;
};

type Dimension = "company" | "channel" | "rep" | "month";

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
  monthOverride?: string | null,
): SummaryRow[] {
  const month = monthOverride !== undefined ? monthOverride : filters.month;
  return rows.filter((row) => {
    if (!skip.includes("company") && filters.company !== null && row.company_code !== filters.company) return false;
    if (!skip.includes("channel") && filters.channel !== null && channelLabel(row.series) !== filters.channel) return false;
    if (!skip.includes("rep") && filters.repKey !== null && repOf(row.company_code, row.rep_code).key !== filters.repKey) return false;
    if (!skip.includes("month") && month !== null && row.month !== month) return false;
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
export function targetsFor(targets: SalesTarget[], year: number, company: number | null, repKey: string | null): (number | null)[] {
  const months: (number | null)[] = Array.from({ length: 12 }, () => null);
  for (const target of targets) {
    if (target.year !== year || target.company_code !== company || target.rep_key !== repKey) continue;
    months[target.month - 1] = Number(target.amount);
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

/** El mismo mes del año anterior ("2026-08" → "2025-08"). */
export const previousYearMonth = (month: string | null) => (month ? `${Number(month.slice(0, 4)) - 1}${month.slice(4)}` : null);

export type SalesModel = ReturnType<typeof computeSalesModel>;

/**
 * Todo lo que se pinta de las ventas a partir de las filas del año elegido y
 * del mismo tramo del anterior, con los filtros puestos.
 */
export function computeSalesModel(input: {
  rows: SummaryRow[];
  previousRows: SummaryRow[];
  filters: SalesFilters;
  shownYear: number;
  companies: Company[];
  repOf: (companyCode: number, repCode: number | null) => RepIdentity;
  comparisonIsPartial: boolean;
  today: Date;
}) {
  const { rows, previousRows, filters, shownYear, companies, repOf, comparisonIsPartial, today } = input;
  const previousMonth = previousYearMonth(filters.month);

  const visible = filterRows(rows, filters, repOf);
  const visibleBefore = filterRows(previousRows, filters, repOf, [], previousMonth);
  const current = sumRows(visible);
  const previous = sumRows(visibleBefore);
  const currentMargin = bucketMargin(current);
  const previousMargin = bucketMargin(previous);

  /**
   * El coste solo vale desde noviembre de 2025, así que en 2026 el margen cubre
   * doce meses y el de 2025 solo dos. Compararlos daría un +500 % con flecha
   * verde. Solo se compara cuando los dos periodos cubren los mismos meses.
   */
  const trustedMonthsOf = (list: SummaryRow[]) =>
    new Set(list.filter((row) => row.month >= COST_TRUSTED_FROM_MONTH).map((row) => row.month.slice(5)));
  const nowMonths = trustedMonthsOf(visible);
  const beforeMonths = trustedMonthsOf(visibleBefore);
  const marginSpansMatch = nowMonths.size > 0 && nowMonths.size === beforeMonths.size && [...nowMonths].every((month) => beforeMonths.has(month));
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
  // El año anterior llega recortado al mismo día que hoy, así que su mes en
  // curso mide lo mismo que el nuestro: septiembre a medias contra septiembre
  // a medias.
  const monthBefore = byMonth(filterRows(previousRows, filters, repOf, ["month"]));
  // Un año en curso se corta en el mes de hoy: si se pintan los doce, la
  // línea cae a cero en octubre y parece que la empresa se ha hundido.
  const lastMonth = shownYear === today.getFullYear() ? today.getMonth() : 11;
  const months = Array.from({ length: lastMonth + 1 }, (_, index) => {
    const suffix = String(index + 1).padStart(2, "0");
    const key = `${shownYear}-${suffix}`;
    const bucket = monthNow.get(key) ?? emptyBucket();
    return {
      index,
      key,
      label: monthNames[index],
      bucket,
      margin: bucketMargin(bucket),
      beforeNet: (monthBefore.get(`${shownYear - 1}-${suffix}`) ?? emptyBucket()).net,
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
  const currentMonth = shownYear === today.getFullYear() ? months[months.length - 1] ?? null : null;
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
  for (const company of byCompany) {
    companiesTotal.net += company.bucket.net;
    companiesTotal.documents += company.bucket.documents;
    companiesTotal.costNet += company.bucket.costNet;
    companiesTotal.cost += company.bucket.cost;
    companiesTotal.withoutCost += company.bucket.withoutCost;
  }

  // ---- Por comercial: sin el filtro de comercial ----
  const forReps = filterRows(rows, filters, repOf, ["rep"]);
  const forRepsBefore = filterRows(previousRows, filters, repOf, ["rep"], previousMonth);
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
    const desde = filters.month
      ? `${monthName(filters.month)} de ${shownYear - 1}`
      : comparisonIsPartial ? `el mismo tramo de ${shownYear - 1}` : String(shownYear - 1);
    // Solo se compara a quien ya vendía: el que empezó este año no "cae" ni "sube".
    const comparables = byRep
      .filter((rep) => rep.isPerson && rep.beforeNet > (filters.month ? 5000 : 50000))
      .map((rep) => ({ rep, change: ((rep.bucket.net - rep.beforeNet) / rep.beforeNet) * 100 }));
    for (const { rep, change } of comparables.filter((item) => item.change <= -15).sort((a, b) => a.change - b.change).slice(0, 2)) {
      findings.push({ tone: "bad", filter: { repKey: rep.key }, text: `${rep.name} vende un ${formatPercent(Math.abs(change))} menos que en ${desde}: ${euros(rep.bucket.net)} frente a ${euros(rep.beforeNet)}.` });
    }
    for (const { rep, change } of comparables.filter((item) => item.change >= 25).sort((a, b) => b.change - a.change).slice(0, 1)) {
      findings.push({ tone: "good", filter: { repKey: rep.key }, text: `${rep.name} es quien más sube: un ${formatPercent(change)} más que en ${desde}, hasta ${euros(rep.bucket.net)}.` });
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
          filter: { repKey: rep.key },
          text: `${rep.name} vende ${euros(rep.bucket.net)} al ${formatPercent(percent)} de margen, ${formatPercent(media - percent)} por debajo de la media.`,
        }));
      channelMargins
        .filter((item) => item.margin !== null && item.net > repsTotal.net * 0.02)
        .sort((a, b) => (a.margin?.percent ?? 0) - (b.margin?.percent ?? 0))
        .slice(0, 1)
        .filter((item) => (item.margin?.percent ?? 0) <= media - 8)
        .forEach((item) => findings.push({ tone: "warn", filter: { channel: item.label }, text: `El canal con peor margen es ${item.label}: ${euros(item.net)} al ${formatPercent(item.margin?.percent ?? 0)}.` }));
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
      findings.push({ tone: "warn", filter: { repKey: UNASSIGNED_KEY }, text: `${euros(unassigned.bucket.net)} de venta no tienen comercial asignado en Sage, el ${formatPercent((unassigned.bucket.net / repsTotal.net) * 100)} del total.` });
    }
    // Decir que agosto es el mes más flojo no es un hallazgo, lo es todos los
    // años. Lo que importa es el mes que vende menos que ese mismo mes del año
    // pasado. El mes en curso se deja fuera porque va por la mitad.
    if (!filters.month) {
      const ongoing = shownYear === today.getFullYear() ? today.getMonth() : 12;
      months
        .filter((month) => month.index < ongoing && month.beforeNet > 0 && month.bucket.net > 0)
        .map((month) => ({ month, change: ((month.bucket.net - month.beforeNet) / month.beforeNet) * 100 }))
        .filter((item) => item.change <= -15)
        .sort((a, b) => a.change - b.change)
        .slice(0, 1)
        .forEach(({ month, change }) => findings.push({
          tone: "bad",
          filter: { month: month.key },
          text: `En ${month.label} se vendió un ${formatPercent(Math.abs(change))} menos que en ${month.label} de ${shownYear - 1}: ${euros(month.bucket.net)} frente a ${euros(month.beforeNet)}.`,
        }));
    }
  }

  return {
    visible,
    current,
    previous,
    currentMargin,
    previousMargin,
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
    available: {
      channels: new Set(rows.map((row) => channelLabel(row.series))),
      reps: new Set(rows.map((row) => repOf(row.company_code, row.rep_code).key)),
    },
  };
}
