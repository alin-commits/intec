import { formatEuroForPdf, generatePdfReport, type ReportStat, type ReportTable } from "@/lib/pdf-report";
import {
  UNASSIGNED_KEY,
  bucketMargin,
  euros,
  hayComercialMarcado,
  monthWithYear,
  tenths,
  type Bucket,
  type SalesFilters,
  type SalesModel,
  variation,
} from "@/lib/sales-model";
import { monthListPhrase, type SalesPeriod } from "@/lib/sales-period";

/*
  El informe de ventas en PDF.

  Lo que se exporta es exactamente lo que se está mirando: el periodo, con qué
  se compara y los filtros puestos. Si alguien manda el PDF por correo, quien lo
  abre tiene que poder saber de qué son esas cifras sin preguntar, así que los
  filtros van escritos arriba y no solo aplicados por debajo.

  Es vectorial —texto y tablas, no una foto de la pantalla—, así que se puede
  buscar dentro, copiar una cifra y se imprime limpio a cualquier tamaño. Los
  gráficos no se llevan: una barra en un PDF que nadie puede pulsar vale menos
  que la tabla de la que sale, y la tabla sí se puede pegar en un Excel.
*/

/** Una variación en palabras, o un guion si no hay con qué comparar. */
const varia = (now: number, before: number) => {
  const value = variation(now, before);
  if (value === null) return "—";
  const rounded = tenths(value);
  return `${rounded >= 0 ? "+" : ""}${rounded.toFixed(1).replace(".", ",")} %`;
};

/** "frente a 2025", pero "frente al mismo tramo de 2025". */
const frenteA = (versus: string, mayuscula = false) => {
  const texto = versus.startsWith("el ") ? `al ${versus.slice(3)}` : `a ${versus}`;
  return mayuscula ? `Frente ${texto}` : `frente ${texto}`;
};

const porcentaje = (value: number | null) => (value === null ? "—" : `${tenths(value).toFixed(1).replace(".", ",")} %`);
const margenDe = (bucket: Bucket) => porcentaje(bucketMargin(bucket)?.percent ?? null);
const ticketDe = (bucket: Bucket) => (bucket.documents > 0 ? formatEuroForPdf(bucket.net / bucket.documents) : "—");

export type SalesReportInput = {
  model: SalesModel;
  period: SalesPeriod;
  filters: SalesFilters;
  /** "Todo el grupo" o el nombre de la sociedad elegida. */
  companyLabel: string;
  repName: (key: string) => string;
  familyName: (code: string) => string;
  /** Lo que se mira, en palabras ("septiembre–octubre de 2026"). */
  periodName: string;
  basis: "albaran" | "factura";
  today: Date;
};

/** Los filtros puestos, escritos para que se lean en el papel. */
function filtrosPuestos(input: SalesReportInput): string[] {
  const { filters, period, companyLabel, repName, familyName } = input;
  const dichos: string[] = [`Sociedad: ${companyLabel}`];
  if (period.selectedMonths.length > 0) {
    dichos.push(`${period.selectedMonths.length === 1 ? "Mes" : "Meses"}: ${monthListPhrase(period.selectedMonths, period.scattered, true)}`);
  }
  if (filters.channels.length > 0) dichos.push(`${filters.channels.length === 1 ? "Canal" : "Canales"}: ${filters.channels.join(", ")}`);
  if (hayComercialMarcado(filters)) {
    const nombres = filters.repKeys.map(repName);
    dichos.push(`${nombres.length === 1 ? "Comercial" : "Comerciales"}: ${nombres.join(", ")}`);
  }
  if (filters.families.length > 0) {
    dichos.push(`${filters.families.length === 1 ? "Familia" : "Familias"}: ${filters.families.map(familyName).join(", ")}`);
  }
  return dichos;
}

/** Lo que hay que saber para no leer mal una cifra. */
function avisos(input: SalesReportInput): string[] {
  const { model, period } = input;
  const dichos = [`Filtros: ${filtrosPuestos(input).join(" · ")}.`];
  if (period.scattered) {
    dichos.push("Los meses marcados no van seguidos: cada cifra es la suma de esos meses, no la del tramo que los abarca.");
  }
  if (!model.marginCoversEverything) {
    dichos.push(`El margen deja fuera ${euros(model.netBeforeSeriesChange)} de venta anterior a noviembre de 2025, que es cuando Sage empieza a traer el coste.`);
  }
  if (model.currentMargin && !model.marginSpansMatch) {
    dichos.push("El margen no se compara con el periodo anterior: los dos no cubren los mismos meses con coste, y compararlos daría una subida que no es verdad.");
  }
  return dichos;
}

function cifras(input: SalesReportInput): ReportStat[] {
  const { model, period } = input;
  const { current, previous, currentMargin } = model;
  const stats: ReportStat[] = [
    { label: "Ventas", value: formatEuroForPdf(current.net) },
    { label: period.versus ? frenteA(period.versus, true) : "Comparación", value: period.compare ? varia(current.net, previous.net) : "—" },
    { label: "Margen", value: currentMargin ? formatEuroForPdf(currentMargin.amount) : "—" },
    { label: "Margen %", value: currentMargin ? porcentaje(currentMargin.percent) : "—" },
    { label: "Albaranes", value: current.documents.toLocaleString("es-ES") },
    { label: "Ticket medio", value: ticketDe(current) },
  ];
  if (model.currentDiscount) stats.push({ label: "Descuento sobre tarifa", value: porcentaje(model.currentDiscount.percent) });
  return stats;
}

function tablas(input: SalesReportInput): ReportTable[] {
  const { model, period, filters } = input;
  const lista: ReportTable[] = [];
  const conComparacion = period.compare !== null;

  /*
    Las tablas del panel enseñan de más a propósito: el mes a mes pinta todos
    los meses del periodo aunque haya dos marcados, y el reparto por comercial
    los lista a todos, porque allí se pulsa otro para cambiar de filtro.

    En un papel eso no se puede pulsar, y una tabla con los diez meses debajo de
    un título que dice "septiembre–octubre" se lee mal. Así que aquí cada tabla
    se recorta a lo que está marcado, que es lo que el informe dice ser.
  */

  // ---- Mes a mes ----
  const deLosMarcados = period.selectedMonths.length > 0
    ? model.monthly.months.filter((month) => period.selectedMonths.includes(month.key))
    : model.monthly.months;
  const meses = deLosMarcados.filter((month) => month.bucket.net !== 0 || month.beforeNet !== 0);
  if (meses.length > 0) {
    const enCurso = model.monthly.currentMonth;
    lista.push({
      title: "Mes a mes",
      head: [
        "Mes",
        "Ventas",
        (period.selectedMonths.length > 0 ? period.compareShort : period.baseCompareShort) ?? "Anterior",
        "Variación",
        "Margen",
        "Margen %",
        "Albaranes",
      ],
      body: meses.map((month) => [
        // Con el año, que el informe se lee suelto y "oct" no dice de cuándo es.
        monthWithYear(month.key),
        formatEuroForPdf(month.bucket.net),
        month.pair ? formatEuroForPdf(month.beforeNet) : "—",
        month.pair ? varia(month.bucket.net, month.beforeNet) : "—",
        month.margin ? formatEuroForPdf(month.margin.amount) : "—",
        month.margin ? porcentaje(month.margin.percent) : "—",
        month.bucket.documents.toLocaleString("es-ES"),
      ]),
      align: ["left", "right", "right", "right", "right", "right", "right"],
      note: enCurso && meses.some((month) => month.key === enCurso.key)
        ? `${monthWithYear(enCurso.key)} va por la mitad: todavía le quedan días.`
        : undefined,
    });
  }

  // ---- Por comercial ----
  const reps = hayComercialMarcado(filters)
    ? model.byRep.filter((rep) => filters.repKeys.includes(rep.key))
    : model.byRep;
  const totalReps = reps.reduce((sum, rep) => sum + rep.bucket.net, 0);
  if (reps.length > 0) {
    lista.push({
      title: hayComercialMarcado(filters) && reps.length === 1 ? "El comercial marcado" : "Por comercial",
      head: ["Comercial", "Ventas", "% del total", period.compareShort ?? "Anterior", "Variación", "Margen %", "Albaranes", "Ticket medio"],
      body: reps.map((rep) => [
        rep.key === UNASSIGNED_KEY ? "Sin comercial asignado" : rep.name,
        formatEuroForPdf(rep.bucket.net),
        porcentaje(totalReps > 0 ? (rep.bucket.net / totalReps) * 100 : null),
        conComparacion ? formatEuroForPdf(rep.beforeNet) : "—",
        conComparacion ? varia(rep.bucket.net, rep.beforeNet) : "—",
        margenDe(rep.bucket),
        rep.bucket.documents.toLocaleString("es-ES"),
        ticketDe(rep.bucket),
      ]),
      align: ["left", "right", "right", "right", "right", "right", "right", "right"],
    });
  }

  // ---- Por sociedad: solo si se miran varias ----
  if (filters.companies.length === 0 && model.byCompany.length > 1) {
    lista.push({
      title: "Por sociedad",
      head: ["Sociedad", "Ventas", "% del total", "Margen", "Margen %", "Albaranes", "Ticket medio"],
      body: model.byCompany.map((company) => [
        company.name,
        formatEuroForPdf(company.bucket.net),
        porcentaje(model.companiesTotal.net > 0 ? (company.bucket.net / model.companiesTotal.net) * 100 : null),
        company.margin ? formatEuroForPdf(company.margin.amount) : "—",
        company.margin ? porcentaje(company.margin.percent) : "—",
        company.bucket.documents.toLocaleString("es-ES"),
        ticketDe(company.bucket),
      ]),
      align: ["left", "right", "right", "right", "right", "right", "right"],
    });
  }

  // ---- Por canal: solo si se miran varios ----
  if (filters.channels.length === 0 && model.byChannel.items.length > 1) {
    lista.push({
      title: "Por canal",
      head: ["Canal", "Ventas", "% del total", "Margen %", "Albaranes"],
      body: model.byChannel.items.map((item) => {
        const bucket = model.byChannel.buckets.get(item.label);
        return [
          item.label,
          formatEuroForPdf(item.value),
          porcentaje(model.byChannel.total > 0 ? (item.value / model.byChannel.total) * 100 : null),
          bucket ? margenDe(bucket) : "—",
          bucket ? bucket.documents.toLocaleString("es-ES") : "—",
        ];
      }),
      align: ["left", "right", "right", "right", "right"],
      note: model.byChannel.refunds < 0 ? `Fuera de la tabla quedan ${euros(Math.abs(model.byChannel.refunds))} de abonos.` : undefined,
    });
  }

  // ---- Lo que hay que mirar ----
  // Los avisos se calculan sobre todo el equipo y todo el periodo, que es lo
  // que les da sentido ("quién baja más"). Con comerciales marcados se quitan
  // los que señalan a alguien que no está marcado, y se dice que los que
  // quedan miran más allá de lo filtrado.
  const avisosSuyos = hayComercialMarcado(filters)
    ? model.findings.filter((finding) => (finding.filter?.repKeys ?? []).every((key) => filters.repKeys.includes(key)))
    : model.findings;
  if (avisosSuyos.length > 0) {
    const comoSuena = { good: "A favor", bad: "En contra", warn: "Ojo" } as const;
    lista.push({
      title: "Lo que hay que mirar",
      head: ["", "Qué pasa"],
      body: avisosSuyos.map((finding) => [comoSuena[finding.tone], finding.text]),
      align: ["left", "left"],
      widths: [24, "auto"],
      note: hayComercialMarcado(filters)
        ? "Los avisos comparan con el resto del equipo, así que pueden nombrar a gente que no está marcada."
        : undefined,
    });
  }

  return lista;
}

/** Descarga el informe de ventas de lo que se está mirando. */
export async function generateSalesReport(input: SalesReportInput) {
  const { period, periodName, basis, today } = input;
  const cuando = today.toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" });
  const trozos = [
    periodName,
    period.versus ? frenteA(period.versus) : null,
    basis === "albaran" ? "por fecha de albarán" : "por fecha de factura",
    `generado el ${cuando}`,
  ].filter(Boolean);
  // El nombre del archivo lleva el periodo, que es lo que lo distingue cuando
  // hay tres informes en la carpeta de descargas.
  const trozoPeriodo = period.shortLabel.replace(/[^\w-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").toLowerCase();

  await generatePdfReport({
    title: "Informe de ventas",
    subtitle: trozos.join(" · "),
    stats: cifras(input),
    notes: avisos(input),
    tables: tablas(input),
    filename: `informe-ventas-${trozoPeriodo || "periodo"}.pdf`,
    orientation: "l",
  });
}
