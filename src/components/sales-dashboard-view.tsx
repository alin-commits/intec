"use client";

import { useEffect, useMemo, useState } from "react";
import { KpiCard } from "@/components/kpi-card";
import { TrendChart } from "@/components/charts/trend-chart";
import { DonutChart, type DonutItem } from "@/components/charts/donut-chart";
import { ConsultasIcon, ConversionIcon, EuroIcon, UsuariosIcon } from "@/components/icons";
import { numberFormatter, formatPercent } from "@/lib/format";

/** El ticket medio son dos o tres dígitos: ahí el céntimo sí dice algo. */
const ticketFormatter = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });
import { hasAnyRole, SALES_ROLES } from "@/lib/constants";
import { createClient } from "@/lib/supabase/client";
import { loadCurrentProfile } from "@/lib/supabase/current-profile";

/** Una fila del resumen mensual que devuelve la base de datos. */
type SummaryRow = {
  month: string;
  company_code: number;
  series: string;
  rep_code: number | null;
  documents: number;
  net_amount: number;
  cost_amount: number;
  net_without_cost: number;
};
type Company = { code: number; name: string; is_active: boolean };
type Rep = { company_code: number; code: number; name: string; is_person: boolean };
type SyncRun = { started_at: string; ok: boolean; covered_from: string | null; covered_to: string | null };

/**
 * Las series de Sage son el canal de venta. Se nombran para que el panel no
 * enseñe códigos; las que no estén aquí salen con su código tal cual.
 */
const channelNames: Record<string, string> = {
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
const channelColors = ["#4f46e5", "#0ea5e9", "#10b981", "#f59e0b", "#ec4899", "#8b5cf6", "#14b8a6", "#f43f5e", "#64748b", "#a16207"];

const channelLabel = (series: string) => channelNames[series] ?? (series || "Sin serie");

/** Días que tarda un día en dejar de moverse: se corrigen albaranes y se factura. */
const PROVISIONAL_DAYS = 7;

const monthNames = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

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
const COST_TRUSTED_FROM_MONTH = "2025-11";

/** Lo que se suma de un grupo de filas: la venta siempre, el coste solo si vale. */
type Bucket = { net: number; documents: number; costNet: number; cost: number; withoutCost: number };
const emptyBucket = (): Bucket => ({ net: 0, documents: 0, costNet: 0, cost: 0, withoutCost: 0 });

function addRow(bucket: Bucket, row: SummaryRow): void {
  bucket.net += Number(row.net_amount);
  bucket.documents += Number(row.documents);
  if (row.month < COST_TRUSTED_FROM_MONTH) return;
  bucket.costNet += Number(row.net_amount);
  bucket.cost += Number(row.cost_amount);
  bucket.withoutCost += Number(row.net_without_cost);
}

function sumRows(list: SummaryRow[]): Bucket {
  const bucket = emptyBucket();
  for (const row of list) addRow(bucket, row);
  return bucket;
}

/**
 * El margen sobre la venta que tiene coste fiable, o null cuando no hay nada
 * que medir. Deja fuera dos cosas: lo anterior al cambio de series y la venta
 * sin coste grabado, que si se contara subiría el margen artificialmente.
 */
function bucketMargin(bucket: Bucket): { amount: number; percent: number } | null {
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
const euros = (value: number) => `${numberFormatter.format(Math.round(value))} €`;

/**
 * El mismo día del año anterior. Un 29 de febrero daría "2027-02-29", que no
 * existe: Postgres responde "date/time field value out of range" y el panel se
 * quedaría sin datos. Se recorta al último día que tenga ese mes.
 */
function sameDayPreviousYear(year: number, today: Date): string {
  const month = today.getMonth();
  const lastDay = new Date(year - 1, month + 1, 0).getDate();
  const day = Math.min(today.getDate(), lastDay);
  return `${year - 1}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Lo que el panel señala solo, para que no haya que ir buscándolo. */
type Finding = { tone: "bad" | "warn" | "good"; text: string };

export function SalesDashboardView() {
  const [stage, setStage] = useState<"loading" | "denied" | "ready">("loading");
  const [error, setError] = useState<string | null>(null);
  const [years, setYears] = useState<number[]>([]);
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [basis, setBasis] = useState<"albaran" | "factura">("albaran");
  const [companyCode, setCompanyCode] = useState<"all" | number>("all");
  /** Filtros que se ponen pulsando en el propio panel, como en Power BI. */
  const [channel, setChannel] = useState<string | null>(null);
  const [repKey, setRepKey] = useState<string | null>(null);
  /** Mes a mes se ve el ritmo; acumulado se ve si se va por delante o por detrás. */
  const [chartMode, setChartMode] = useState<"mensual" | "acumulado">("mensual");
  const [rows, setRows] = useState<SummaryRow[]>([]);
  const [previousRows, setPreviousRows] = useState<SummaryRow[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [reps, setReps] = useState<Rep[]>([]);
  const [lastRun, setLastRun] = useState<SyncRun | null>(null);
  /** True cuando se compara contra el mismo tramo del año anterior, no el año entero. */
  const [comparisonIsPartial, setComparisonIsPartial] = useState(false);
  const [busy, setBusy] = useState(false);
  /**
   * A qué año pertenecen las filas que hay ahora mismo. Mientras llega el año
   * nuevo se sigue pintando el viejo, y el gráfico busca los meses de ESTE año,
   * no del que acaban de elegir: si no, se queda sin encontrar ninguno y la
   * línea cae a cero, que es justo lo que parece un hundimiento.
   */
  const [dataYear, setDataYear] = useState<number | null>(null);

  // Quién entra y qué años hay con datos. Solo una vez.
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const profile = await loadCurrentProfile();
        if (!active) return;
        if (!profile || !hasAnyRole(profile.roles, SALES_ROLES)) {
          setStage("denied");
          return;
        }
        const supabase = createClient();
        const [years, companyRows, repRows, runRows] = await Promise.all([
          supabase.rpc("sage_sales_years"),
          supabase.from("sage_companies").select("code, name, is_active").order("code"),
          supabase.from("sage_reps").select("company_code, code, name, is_person"),
          supabase.from("sage_sync_runs").select("started_at, ok, covered_from, covered_to").eq("ok", true).order("started_at", { ascending: false }).limit(1),
        ]);
        // supabase-js no lanza cuando Postgres devuelve un error: resuelve con
        // data a null. Sin mirar esto, un fallo del servidor se convertiría en
        // "todavía no han llegado datos de Sage", que es mentira.
        const failure = years.error ?? companyRows.error ?? repRows.error ?? runRows.error;
        if (failure) throw failure;
        if (!active) return;
        const yearRows = years.data;
        const found = (yearRows ?? []).map((row: { year: number }) => row.year);
        setYears(found);
        if (found.length > 0 && !found.includes(year)) setYear(found[0]);
        setCompanies((companyRows.data ?? []) as Company[]);
        setReps((repRows.data ?? []) as Rep[]);
        setLastRun(((runRows.data ?? [])[0] as SyncRun) ?? null);
        setStage("ready");
      } catch (cause) {
        console.error("No se pudo preparar el panel de ventas:", cause);
        if (active) setError("No se pudieron cargar los datos. Comprueba tu conexión y recarga la página.");
      }
    })();
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al entrar
  }, []);

  // El año elegido y el anterior, para poder comparar.
  useEffect(() => {
    if (stage !== "ready") return;
    let active = true;
    void (async () => {
      setBusy(true);
      setError(null);
      try {
        const supabase = createClient();
        // Un año en curso se compara contra el mismo tramo del anterior, no
        // contra el año entero: si no, en septiembre siempre parecería que se
        // ha vendido un 30 % menos.
        const today = new Date();
        const partial = year === today.getFullYear();
        const [current, before] = await Promise.all([
          supabase.rpc("sage_sales_summary", { p_from: `${year}-01-01`, p_to: `${year}-12-31`, p_basis: basis }),
          supabase.rpc("sage_sales_summary", {
            p_from: `${year - 1}-01-01`,
            p_to: partial ? sameDayPreviousYear(year, today) : `${year - 1}-12-31`,
            p_basis: basis,
          }),
        ]);
        const failure = current.error ?? before.error;
        if (failure) throw failure;
        if (!active) return;
        setComparisonIsPartial(partial);
        setRows((current.data ?? []) as SummaryRow[]);
        setPreviousRows((before.data ?? []) as SummaryRow[]);
        setDataYear(year);
        setBusy(false);
      } catch (cause) {
        console.error("No se pudieron cargar las ventas:", cause);
        if (!active) return;
        setError("No se pudieron cargar las ventas de ese periodo.");
        setBusy(false);
      }
    })();
    return () => { active = false; };
  }, [stage, year, basis]);

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
   * hay un "Juan López Martínez" que no sea Juan López, se juntarían. Con los
   * 26 nombres que hay hoy en Sage solo agrupa a Sergio Almodóvar, con tres
   * fichas, y a Raúl Vicente Barea, con dos por una tilde.
   */
  const repIdentities = useMemo(() => {
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
  }, [reps]);

  /**
   * Quién firma una fila, ya juntadas las fichas repetidas de Sage. `isPerson`
   * separa a los comerciales de verdad de los códigos comodín de Sage
   * ("GENERAL", "SAT INTEC", "Alta Automática"): salen en el ranking porque su
   * venta es real, pero no se les puede decir que suben o que bajan.
   */
  const repOf = useMemo(() => (row: SummaryRow): { key: string; label: string; assigned: boolean; isPerson: boolean } => {
    if (row.rep_code === null) return { key: "sin", label: "Sin comercial asignado", assigned: false, isPerson: false };
    const rep = reps.find((item) => item.company_code === row.company_code && item.code === row.rep_code);
    const identity = rep ? repIdentities.get(rep.name) : undefined;
    return {
      key: identity?.key ?? `${row.company_code}-${row.rep_code}`,
      label: identity?.label ?? `Código ${row.rep_code}`,
      assigned: true,
      isPerson: rep?.is_person ?? false,
    };
  }, [reps, repIdentities]);

  /**
   * Un canal o un comercial elegido en un año puede no existir en otro: las
   * series nuevas no existen antes de octubre de 2025, y un comercial puede no
   * haber vendido nada ese año. Si el filtro se quedara puesto, el panel
   * enseñaría un cero rotundo para un año que sí tuvo ventas, y encima el
   * desplegable diría "Todos los canales" porque esa opción ya no está en la
   * lista. Así que un filtro que no existe en lo cargado no se aplica.
   */
  const available = useMemo(() => ({
    channels: new Set(rows.map((row) => channelLabel(row.series))),
    reps: new Set(rows.map((row) => repOf(row).key)),
  }), [rows, repOf]);
  const activeChannel = channel !== null && available.channels.has(channel) ? channel : null;
  const activeRepKey = repKey !== null && available.reps.has(repKey) ? repKey : null;

  /**
   * Los filtros se aplican todos menos el del propio cuadro que se está
   * pintando: si el ranking de comerciales se filtrase a sí mismo, al pulsar
   * uno desaparecerían los demás y ya no se podría cambiar de opinión.
   */
  const filtered = useMemo(() => {
    const pick = (list: SummaryRow[], skip?: "channel" | "rep") => list.filter((row) => {
      if (companyCode !== "all" && row.company_code !== companyCode) return false;
      if (skip !== "channel" && activeChannel !== null && channelLabel(row.series) !== activeChannel) return false;
      if (skip !== "rep" && activeRepKey !== null && repOf(row).key !== activeRepKey) return false;
      return true;
    });
    return {
      visible: pick(rows),
      visibleBefore: pick(previousRows),
      forChannels: pick(rows, "channel"),
      forReps: pick(rows, "rep"),
      forRepsBefore: pick(previousRows, "rep"),
    };
  }, [rows, previousRows, companyCode, activeChannel, activeRepKey, repOf]);

  const { visible, visibleBefore } = filtered;
  /** El año de las filas que hay cargadas, que mientras carga no es el elegido. */
  const shownYear = dataYear ?? year;

  const current = useMemo(() => sumRows(visible), [visible]);
  const previous = useMemo(() => sumRows(visibleBefore), [visibleBefore]);

  /**
   * Con un "antes" negativo —un comercial que ya solo arrastra abonos, un canal
   * con margen en pérdidas— la división invierte el signo: mejorar de -10.000 a
   * -5.000 saldría como -50 % en rojo. Y con un "antes" ridículo al lado del
   * "ahora" sale un +499.900 % que no dice nada. En los dos casos es más honesto
   * no comparar.
   */
  const variation = (now: number, before: number) => (before > 0 ? ((now - before) / before) * 100 : null);
  const delta = (value: number | null) =>
    value === null
      ? { delta: "Sin comparación", positive: true }
      : { delta: `${value >= 0 ? "+" : ""}${value.toFixed(1).replace(".", ",")} %`, positive: value >= 0 };

  const currentMargin = bucketMargin(current);
  const previousMargin = bucketMargin(previous);
  /**
   * El coste solo vale desde noviembre de 2025, así que en 2026 el margen cubre
   * doce meses y el de 2025 solo dos. Compararlos daría un +500 % con flecha
   * verde, y justo en ese caso el cartel que avisa del cambio de series ya no
   * sale, porque en 2026 no hay venta sin coste fiable. Solo se compara cuando
   * los dos periodos cubren los mismos meses del año.
   */
  const trustedMonthsOf = (list: SummaryRow[]) =>
    new Set(list.filter((row) => row.month >= COST_TRUSTED_FROM_MONTH).map((row) => row.month.slice(5)));
  const marginSpansMatch = (() => {
    const now = trustedMonthsOf(visible);
    const before = trustedMonthsOf(visibleBefore);
    return now.size > 0 && now.size === before.size && [...now].every((month) => before.has(month));
  })();
  const withoutCostShare = current.costNet > 0 ? (current.withoutCost / current.costNet) * 100 : 0;
  /** Venta del periodo que se queda fuera del margen por venir de las series viejas. */
  const netBeforeSeriesChange = current.net - current.costNet;
  const marginCoversEverything = netBeforeSeriesChange <= 0;

  const monthly = useMemo(() => {
    const byMonth = (list: SummaryRow[]) => {
      const map = new Map<string, Bucket>();
      for (const row of list) {
        const bucket = map.get(row.month) ?? emptyBucket();
        addRow(bucket, row);
        map.set(row.month, bucket);
      }
      return map;
    };
    const now = byMonth(visible);
    // El año anterior llega recortado al mismo día que hoy, así que su mes en
    // curso mide lo mismo que el nuestro: septiembre a medias contra septiembre
    // a medias. Con el año anterior completo, el mes en curso siempre parecería
    // una caída.
    const before = byMonth(visibleBefore);
    // Un año en curso se corta en el mes de hoy: si se pintan los doce, la
    // línea cae a cero en octubre y parece que la empresa se ha hundido.
    const today = new Date();
    const lastMonth = shownYear === today.getFullYear() ? today.getMonth() : 11;
    const months = Array.from({ length: lastMonth + 1 }, (_, index) => {
      const suffix = String(index + 1).padStart(2, "0");
      const bucket = now.get(`${shownYear}-${suffix}`) ?? emptyBucket();
      return {
        index,
        label: monthNames[index],
        bucket,
        margin: bucketMargin(bucket),
        beforeNet: (before.get(`${shownYear - 1}-${suffix}`) ?? emptyBucket()).net,
      };
    });
    // El acumulado se calcula aquí y no en el gráfico: el gráfico solo pinta lo
    // que le den, y así el modo se puede cambiar sin volver a pedir nada.
    let corridoAhora = 0;
    let corridoAntes = 0;
    let corridoMargen = 0;
    const running = months.map((month) => {
      corridoAhora += month.bucket.net;
      corridoAntes += month.beforeNet;
      corridoMargen += month.margin?.amount ?? 0;
      return {
        label: month.label,
        ventas: Math.round(corridoAhora),
        anterior: Math.round(corridoAntes),
        margen: Math.round(corridoMargen),
      };
    });
    const enCurso = shownYear === new Date().getFullYear() ? months[months.length - 1] ?? null : null;
    return {
      enCurso,
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
      months,
    };
  }, [visible, visibleBefore, shownYear]);

  const byCompany = useMemo(() => {
    const map = new Map<number, Bucket>();
    for (const row of rows) {
      const bucket = map.get(row.company_code) ?? emptyBucket();
      addRow(bucket, row);
      map.set(row.company_code, bucket);
    }
    return [...map].map(([code, bucket]) => ({
      code,
      name: companies.find((company) => company.code === code)?.name ?? `Sociedad ${code}`,
      bucket,
      margin: bucketMargin(bucket),
    })).sort((a, b) => b.bucket.net - a.bucket.net);
  }, [rows, companies]);

  /** El margen del conjunto de sociedades, para el total de su tabla. */
  const companiesMargin = useMemo(() => {
    const total = emptyBucket();
    for (const company of byCompany) {
      total.net += company.bucket.net;
      total.documents += company.bucket.documents;
      total.costNet += company.bucket.costNet;
      total.cost += company.bucket.cost;
      total.withoutCost += company.bucket.withoutCost;
    }
    return bucketMargin(total);
  }, [byCompany]);

  const byRep = useMemo(() => {
    const map = new Map<string, { name: string; assigned: boolean; isPerson: boolean; bucket: Bucket }>();
    for (const row of filtered.forReps) {
      const who = repOf(row);
      const entry = map.get(who.key) ?? { name: who.label, assigned: who.assigned, isPerson: who.isPerson, bucket: emptyBucket() };
      addRow(entry.bucket, row);
      map.set(who.key, entry);
    }
    const before = new Map<string, number>();
    for (const row of filtered.forRepsBefore) {
      const who = repOf(row);
      before.set(who.key, (before.get(who.key) ?? 0) + Number(row.net_amount));
    }
    return [...map]
      .map(([key, value]) => ({
        key,
        ...value,
        margin: bucketMargin(value.bucket),
        beforeNet: before.get(key) ?? 0,
      }))
      .sort((a, b) => b.bucket.net - a.bucket.net);
  }, [filtered.forReps, filtered.forRepsBefore, repOf]);

  /** Cuántos canales caben en la rosquilla antes de que las etiquetas se corten. */
  const TOP_CHANNELS = 8;

  /** El total del mismo conjunto que alimenta el ranking, para que los avisos
   *  y sus porcentajes hablen de la misma base que los comerciales que citan. */
  const repsTotal = useMemo(() => sumRows(filtered.forReps), [filtered.forReps]);
  const repsMargin = bucketMargin(repsTotal);

  const byChannel = useMemo(() => {
    const map = new Map<string, number>();
    const buckets = new Map<string, Bucket>();
    for (const row of filtered.forChannels) {
      const label = channelLabel(row.series);
      map.set(label, (map.get(label) ?? 0) + Number(row.net_amount));
      const bucket = buckets.get(label) ?? emptyBucket();
      addRow(bucket, row);
      buckets.set(label, bucket);
    }
    // Los abonos van en negativo y una rosquilla no los puede dibujar, así que
    // se apartan y se dicen debajo: si no, el total del centro no cuadraría con
    // el de ventas de arriba y nadie sabría por qué.
    const positive = [...map].filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1]);
    const refunds = [...map].reduce((sum, [, value]) => (value < 0 ? sum + value : sum), 0);
    // Con 19 series las etiquetas salen cortadas a "Cré...", así que la cola se
    // junta en una sola porción, que no es pulsable porque no es un canal.
    const head = positive.slice(0, TOP_CHANNELS);
    const tail = positive.slice(TOP_CHANNELS);
    const shown = tail.length > 0
      ? [...head, [`Otras ${tail.length} series`, tail.reduce((sum, [, value]) => sum + value, 0)] as [string, number]]
      : head;
    return { shown, refunds, buckets, real: new Set(positive.map(([label]) => label)) };
  }, [filtered.forChannels]);

  const channelTotal = byChannel.shown.reduce((sum, [, value]) => sum + value, 0);
  /** El margen de cada canal de verdad, que usan tanto la lista como los avisos. */
  const channelMargins = useMemo(
    () => [...byChannel.buckets]
      .filter(([label]) => byChannel.real.has(label))
      .map(([label, bucket]) => ({ label, net: bucket.net, margin: bucketMargin(bucket) })),
    [byChannel],
  );
  const channelItems: DonutItem[] = byChannel.shown.map(([label, value], index) => ({
    label,
    value: Math.round(value),
    color: channelColors[index % channelColors.length],
  }));

  /**
   * Lo que el panel señala solo. La idea es que Dirección no tenga que buscar:
   * si algo se está torciendo, sale escrito con su número al lado.
   */
  const findings = useMemo<Finding[]>(() => {
    // Ojo con la base: el ranking se salta el filtro de comercial a propósito,
    // así que si aquí se usara `current` (que sí lo respeta), al pulsar a
    // alguien saldrían cosas como "el 112 % del total".
    if (repsTotal.net <= 0) return [];

    // Solo se compara a quien ya vendía el año pasado: el que empezó este año
    // no "cae" ni "sube", es que antes no estaba.
    const comparables = byRep
      .filter((rep) => rep.isPerson && rep.beforeNet > 50000)
      .map((rep) => ({ rep, change: ((rep.bucket.net - rep.beforeNet) / rep.beforeNet) * 100 }));
    const desde = comparisonIsPartial ? `el mismo tramo de ${shownYear - 1}` : String(shownYear - 1);

    const caidas: Finding[] = comparables
      .filter((item) => item.change <= -15)
      .sort((a, b) => a.change - b.change)
      .slice(0, 2)
      .map(({ rep, change }) => ({
        tone: "bad",
        text: `${rep.name} vende un ${formatPercent(Math.abs(change))} menos que en ${desde}: ${euros(rep.bucket.net)} frente a ${euros(rep.beforeNet)}.`,
      }));

    const subidas: Finding[] = comparables
      .filter((item) => item.change >= 25)
      .sort((a, b) => b.change - a.change)
      .slice(0, 1)
      .map(({ rep, change }) => ({
        tone: "good",
        text: `${rep.name} es quien más sube: un ${formatPercent(change)} más que en ${desde}, hasta ${euros(rep.bucket.net)}.`,
      }));

    // Vender mucho con poco margen es justo lo que el PDF pide vigilar.
    const media = repsMargin?.percent ?? null;
    const flojos: Finding[] = media === null ? [] : byRep
      .flatMap((rep) => (rep.isPerson && rep.margin && rep.bucket.net > repsTotal.net * 0.03
        ? [{ rep, percent: rep.margin.percent }]
        : []))
      .filter((item) => item.percent <= media - 8)
      .sort((a, b) => a.percent - b.percent)
      .slice(0, 2)
      .map(({ rep, percent }) => ({
        tone: "warn",
        text: `${rep.name} vende ${euros(rep.bucket.net)} al ${formatPercent(percent)} de margen, ${formatPercent(media - percent)} por debajo de la media.`,
      }));

    // Si tres personas son media empresa, eso es un riesgo, no un dato.
    const personas = byRep.filter((rep) => rep.isPerson);
    const top3 = personas.slice(0, 3).reduce((sum, rep) => sum + rep.bucket.net, 0);
    const totalPersonas = personas.reduce((sum, rep) => sum + rep.bucket.net, 0);
    // Si alguien arrastra abonos, su venta es negativa y el total se encoge: el
    // porcentaje se dispararía por encima de 100 sin querer decir nada.
    const concentracion: Finding[] = totalPersonas > 0 && personas.length > 4
      && top3 > 0 && top3 <= totalPersonas && top3 / totalPersonas >= 0.55
      ? [{
          tone: "warn",
          text: `Tres comerciales concentran el ${formatPercent((top3 / totalPersonas) * 100)} de lo que venden las personas: ${personas.slice(0, 3).map((rep) => rep.name.split(" ").slice(0, 2).join(" ")).join(", ")}.`,
        }]
      : [];

    // Venta que no se sabe de quién es.
    const sinAsignar = byRep.find((rep) => rep.key === "sin");
    const huerfana: Finding[] = sinAsignar && sinAsignar.bucket.net > repsTotal.net * 0.08
      ? [{
          tone: "warn",
          text: `${euros(sinAsignar.bucket.net)} de venta no tienen comercial asignado en Sage, el ${formatPercent((sinAsignar.bucket.net / repsTotal.net) * 100)} del total.`,
        }]
      : [];

    // Decir que agosto es el mes más flojo no es un hallazgo, lo es todos los
    // años. Lo que importa es el mes que vende menos que ese mismo mes del año
    // pasado. El mes en curso se deja fuera porque va por la mitad.
    const mesEnCurso = shownYear === new Date().getFullYear() ? new Date().getMonth() : 12;
    const caidaMes = monthly.months
      .filter((month) => month.index < mesEnCurso && month.beforeNet > 0 && month.bucket.net > 0)
      .map((month) => ({ month, change: ((month.bucket.net - month.beforeNet) / month.beforeNet) * 100 }))
      .filter((item) => item.change <= -15)
      .sort((a, b) => a.change - b.change)
      .slice(0, 1);
    const mesFlojo: Finding[] = caidaMes.map(({ month, change }) => ({
      tone: "bad",
      text: `En ${month.label} se vendió un ${formatPercent(Math.abs(change))} menos que en ${month.label} de ${shownYear - 1}: ${euros(month.bucket.net)} frente a ${euros(month.beforeNet)}.`,
    }));

    // Vender por un canal que apenas deja margen también es de lo que el PDF
    // manda vigilar, y no se ve mirando solo la venta.
    const canalFlojo = channelMargins
      .filter((item) => item.margin !== null && item.net > repsTotal.net * 0.02)
      .sort((a, b) => (a.margin?.percent ?? 0) - (b.margin?.percent ?? 0))
      .slice(0, 1);
    const canales: Finding[] = media === null ? [] : canalFlojo
      .filter((item) => (item.margin?.percent ?? 0) <= media - 8)
      .map((item) => ({
        tone: "warn",
        text: `El canal con peor margen es ${item.label}: ${euros(item.net)} al ${formatPercent(item.margin?.percent ?? 0)}.`,
      }));

    return [...caidas, ...subidas, ...flojos, ...canales, ...concentracion, ...huerfana, ...mesFlojo];
  }, [byRep, repsTotal, repsMargin, channelMargins, monthly.months, comparisonIsPartial, shownYear]);

  if (stage === "denied") {
    return (
      <div className="page-stack">
        <section className="panel panel-padded">
          <h2>No tienes acceso a esta página</h2>
          <p>Las ventas de Sage solo las ven dirección y administración.</p>
        </section>
      </div>
    );
  }
  if (error && dataYear === null) {
    return (
      <div className="page-stack">
        <section className="panel panel-padded">
          <h2>No se pudo cargar</h2>
          <p>{error}</p>
        </section>
      </div>
    );
  }
  if (stage === "loading") return <div className="page-stack" />;

  if (years.length === 0) {
    return (
      <div className="page-stack">
        <section className="panel panel-padded">
          <h2>Todavía no han llegado datos de Sage</h2>
          <p className="muted">
            El programa que lee Sage aún no ha enviado nada. En cuanto lo haga, esta página se llena sola.
          </p>
        </section>
      </div>
    );
  }

  const isCurrentYear = year === new Date().getFullYear();
  const comparisonHelper = comparisonIsPartial ? `frente al mismo tramo de ${shownYear - 1}` : `frente a ${shownYear - 1}`;
  // De `companies`, no de las ventas del año: una sociedad sin ventas en el año
  // elegido dejaría la frase en "en ." y el chip del filtro sin texto.
  const companyLabel = companyCode === "all"
    ? "todas las sociedades"
    : companies.find((item) => item.code === companyCode)?.name ?? `Sociedad ${companyCode}`;
  const repRankMax = Math.max(...byRep.map((rep) => rep.bucket.net), 1);
  /**
   * Los filtros puestos, incluidos los que este año no se pueden aplicar. Un
   * canal elegido que no existe en el año que se está mirando no se aplica,
   * pero tampoco se tira: se queda dicho y en gris. Si desapareciera sin más,
   * al volver a un año donde sí existe reaparecería solo y nadie entendería por
   * qué han cambiado los números.
   */
  const activeFilters = [
    companyCode !== "all" ? { label: companyLabel, inactive: false, clear: () => setCompanyCode("all") } : null,
    channel !== null
      ? { label: `Canal: ${channel}`, inactive: activeChannel === null, clear: () => setChannel(null) }
      : null,
    repKey !== null
      ? {
          label: `Comercial: ${byRep.find((item) => item.key === repKey)?.name ?? repKey}`,
          inactive: activeRepKey === null,
          clear: () => setRepKey(null),
        }
      : null,
  ].filter((item): item is { label: string; inactive: boolean; clear: () => void } => item !== null);

  return (
    <div className="page-stack">
      <section className="section-heading">
        <div>
          <p>
            Ventas y margen según Sage, {basis === "albaran" ? "por fecha de albarán" : "por fecha de factura"}, en {companyLabel}.
            Las devoluciones restan.
          </p>
        </div>
        <div className="panel-heading-trailing">
          <select className="panel-heading-select" value={String(companyCode)} onChange={(event) => setCompanyCode(event.target.value === "all" ? "all" : Number(event.target.value))} aria-label="Sociedad">
            <option value="all">Todas las sociedades</option>
            {companies.filter((company) => company.is_active).map((company) => (
              <option key={company.code} value={company.code}>{company.name}</option>
            ))}
          </select>
          <select className="panel-heading-select" value={year} onChange={(event) => setYear(Number(event.target.value))} aria-label="Año">
            {years.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          <select className="panel-heading-select" value={activeChannel ?? "all"} onChange={(event) => setChannel(event.target.value === "all" ? null : event.target.value)} aria-label="Canal">
            <option value="all">Todos los canales</option>
            {[...byChannel.real].sort().map((label) => <option key={label} value={label}>{label}</option>)}
          </select>
          <select className="panel-heading-select" value={basis} onChange={(event) => setBasis(event.target.value as "albaran" | "factura")} aria-label="Qué fecha manda">
            <option value="albaran">Por fecha de albarán</option>
            <option value="factura">Por fecha de factura</option>
          </select>
        </div>
      </section>

      {error ? (
        <section className="panel sales-broken">
          <div>
            <strong>{error}</strong>
            <span>
              Lo que se ve abajo es de {shownYear}, que es lo último que sí llegó. Vuelve a elegir el año para
              intentarlo otra vez.
            </span>
          </div>
        </section>
      ) : null}

      {busy ? <p className="sales-busy" role="status">Actualizando…</p> : null}

      {activeFilters.length > 0 ? (
        <section className="sales-chips" aria-label="Filtros puestos">
          {activeFilters.map((filter) => (
            <button
              key={filter.label}
              type="button"
              className={filter.inactive ? "sales-chip sales-chip-off" : "sales-chip"}
              onClick={filter.clear}
              title={filter.inactive ? `No se aplica: no hay nada de esto en ${shownYear}` : undefined}
            >
              {filter.label}{filter.inactive ? ` · no está en ${shownYear}` : ""}<span aria-hidden="true">×</span>
              <span className="sr-only">Quitar este filtro</span>
            </button>
          ))}
          <button
            type="button"
            className="sales-chip sales-chip-clear"
            onClick={() => { setCompanyCode("all"); setChannel(null); setRepKey(null); }}
          >
            Quitar todos
          </button>
        </section>
      ) : null}

      {basis === "factura" ? (
        <section className="panel notice">
          <strong>Estás viendo la venta por fecha de factura.</strong>
          <span>
            Lo servido y todavía sin facturar no aparece aquí, así que el mes en curso siempre parece más pequeño de
            lo que es. Para saber cuánto se ha vendido, mira por fecha de albarán.
          </span>
        </section>
      ) : null}

      <section className="kpi-grid kpi-grid-sales">
        <KpiCard
          label="Ventas"
          value={euros(current.net)}
          helper={comparisonHelper}
          icon={<EuroIcon />}
          tone="indigo"
          {...delta(variation(current.net, previous.net))}
        />
        <KpiCard
          label="Margen"
          value={currentMargin ? euros(currentMargin.amount) : "No disponible"}
          helper={currentMargin && !marginCoversEverything ? "solo desde el cambio de series" : "en euros"}
          icon={<ConversionIcon />}
          tone={currentMargin ? "emerald" : "amber"}
          {...(currentMargin && previousMargin && marginSpansMatch
            ? delta(variation(currentMargin.amount, previousMargin.amount))
            : { delta: "Sin comparación", positive: true })}
        />
        <KpiCard
          label="Margen %"
          value={currentMargin ? formatPercent(currentMargin.percent) : "—"}
          helper={currentMargin ? "sobre lo que tiene coste" : "el coste de las series antiguas no sirve"}
          icon={<ConversionIcon />}
          tone={currentMargin ? "emerald" : "amber"}
          delta={currentMargin && previousMargin && marginSpansMatch
            ? `${currentMargin.percent - previousMargin.percent >= 0 ? "+" : ""}${(currentMargin.percent - previousMargin.percent).toFixed(1).replace(".", ",")} pts`
            : "Sin comparación"}
          positive={currentMargin && previousMargin && marginSpansMatch ? currentMargin.percent >= previousMargin.percent : true}
        />
        <KpiCard
          label="Albaranes"
          value={numberFormatter.format(current.documents)}
          helper={comparisonHelper}
          icon={<ConsultasIcon />}
          tone="sky"
          {...delta(variation(current.documents, previous.documents))}
        />
        {monthly.enCurso ? (
          <KpiCard
            label={`Va de ${monthNames[monthly.enCurso.index]}`}
            value={euros(monthly.enCurso.bucket.net)}
            helper={`frente a los mismos días de ${monthNames[monthly.enCurso.index]} de ${shownYear - 1}`}
            icon={<EuroIcon />}
            tone="sky"
            {...delta(variation(monthly.enCurso.bucket.net, monthly.enCurso.beforeNet))}
          />
        ) : null}
        <KpiCard
          label="Ticket medio"
          value={ticketFormatter.format(current.documents ? current.net / current.documents : 0)}
          helper="por albarán"
          icon={<UsuariosIcon />}
          tone="amber"
          {...delta(variation(
            current.documents ? current.net / current.documents : 0,
            previous.documents ? previous.net / previous.documents : 0,
          ))}
        />
      </section>

      {!marginCoversEverything ? (
        <section className="panel sales-broken">
          <div>
            <strong>
              {currentMargin
                ? `El margen deja fuera ${euros(netBeforeSeriesChange)} de venta anterior a noviembre de 2025`
                : "De este periodo no se puede sacar el margen"}
            </strong>
            <span>
              El 16 de octubre de 2025 se cambió el sistema de series en Sage. En las series antiguas el coste está
              mal grabado: suma más que la propia venta, lo que daría un margen negativo imposible. La venta de
              entonces sí es buena y está contada arriba; el coste no, así que esa parte se queda fuera del margen.
              El corte se hace en noviembre porque octubre tiene las dos series mezcladas.
            </span>
          </div>
        </section>
      ) : null}

      {current.withoutCost > 0 && current.costNet > 0 ? (
        <section className="panel sales-warning">
          <div>
            <strong>{euros(current.withoutCost)} de venta no tienen coste grabado en Sage</strong>
            <span>
              Es el {formatPercent(withoutCostShare)} de la venta del periodo que tiene coste fiable. El margen la deja
              fuera porque contarla como si no costara nada lo subiría artificialmente: con ella dentro saldría{" "}
              {formatPercent(((current.costNet - current.cost) / current.costNet) * 100)}.
            </span>
          </div>
        </section>
      ) : null}

      <section className="sales-board">
        <article className="panel chart-panel sales-board-wide">
          <div className="panel-heading">
            <div>
              <h2>Evolución del año</h2>
              <p className="panel-subtitle">
                {chartMode === "acumulado"
                  ? `Lo que se lleva vendido a cada mes${monthly.marginComplete ? ", con el margen" : ""}`
                  : monthly.marginComplete ? "Ventas y margen por mes" : "Ventas por mes"}
                {monthly.hasBefore ? `, con ${shownYear - 1} detrás en gris` : ""}
              </p>
            </div>
            <div className="sales-switch" role="group" aria-label="Cómo se mira la evolución">
              {(["mensual", "acumulado"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={chartMode === mode ? "is-active" : undefined}
                  onClick={() => setChartMode(mode)}
                  aria-pressed={chartMode === mode}
                >
                  {mode === "mensual" ? "Mes a mes" : "Acumulado"}
                </button>
              ))}
            </div>
          </div>
          <TrendChart
            data={chartMode === "acumulado" ? monthly.running : monthly.points}
            series={[
              ...(monthly.hasBefore ? [{ key: "anterior", label: String(shownYear - 1), color: "#cbd5e1" }] : []),
              { key: "ventas", label: "Ventas", color: "#4f46e5" },
              ...(monthly.marginComplete ? [{ key: "margen", label: "Margen", color: "#10b981" }] : []),
            ]}
            ariaLabel={`Evolución mensual de ventas en ${shownYear}`}
          />
        </article>

        <article className="panel panel-padded sales-board-narrow">
          <div className="panel-heading">
            <div>
              <h2>Lo que hay que mirar</h2>
              <p className="panel-subtitle">Lo saca el panel solo, con los datos de arriba</p>
            </div>
          </div>
          {findings.length === 0 ? (
            <p className="muted">Nada que destacar en este periodo: ni caídas fuertes ni márgenes fuera de sitio.</p>
          ) : (
            <ul className="sales-findings">
              {findings.map((finding) => (
                <li key={finding.text} className={`sales-finding sales-finding-${finding.tone}`}>{finding.text}</li>
              ))}
            </ul>
          )}
        </article>

        <article className="panel panel-padded sales-board-half">
          <div className="panel-heading">
            <div>
              <h2>Ranking de comerciales</h2>
              <p className="panel-subtitle">Pulsa uno para filtrar todo el panel</p>
            </div>
          </div>
          {byRep.length === 0 ? (
            <p className="muted">Sin ventas en este periodo.</p>
          ) : (
            <ol className="sales-rank">
              {byRep.map((rep) => (
                <li key={rep.key}>
                  <button
                    type="button"
                    className={`sales-rank-row${activeRepKey === rep.key ? " is-active" : ""}${rep.assigned ? "" : " is-muted"}`}
                    onClick={() => setRepKey(activeRepKey === rep.key ? null : rep.key)}
                    aria-pressed={activeRepKey === rep.key}
                  >
                    <span className="sales-rank-name" title={rep.name}>{rep.name}</span>
                    <span className="sales-rank-track">
                      <span
                        className="sales-rank-fill"
                        style={{ width: `${Math.max(1.5, (Math.max(rep.bucket.net, 0) / repRankMax) * 100)}%` }}
                      />
                    </span>
                    <strong className="sales-rank-value">{euros(rep.bucket.net)}</strong>
                    <span className="sales-rank-margin">
                      {rep.margin ? formatPercent(rep.margin.percent) : "—"}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </article>

        <article className="panel chart-panel sales-channel sales-board-quarter">
          <div className="panel-heading">
            <div>
              <h2>Por canal</h2>
              <p className="panel-subtitle">
                Venta, peso y margen de cada uno. Pulsa uno para filtrar
                {byChannel.refunds < 0 ? `. Sin los ${euros(-byChannel.refunds)} de abonos` : ""}
              </p>
            </div>
          </div>
          <DonutChart
            items={channelItems}
            centerLabel="ventas"
            ariaLabel="Reparto de las ventas por canal"
            emptyMessage="Sin datos en este periodo."
            showLegend={false}
          />
          <div className="sales-channel-head" aria-hidden="true">
            <span /><span>Canal</span><span>Ventas</span><span>Peso</span><span>Margen</span>
          </div>
          <ul className="sales-channel-list">
            {channelItems.map((item) => {
              const real = byChannel.real.has(item.label);
              const margen = bucketMargin(byChannel.buckets.get(item.label) ?? emptyBucket());
              const share = channelTotal > 0 ? (item.value / channelTotal) * 100 : 0;
              const content = (
                <>
                  <i style={{ background: item.color }} aria-hidden="true" />
                  <span>{item.label}</span>
                  <strong>{euros(item.value)}</strong>
                  <em>{Math.round(share)}%</em>
                  <b>{margen ? formatPercent(margen.percent) : "—"}</b>
                </>
              );
              // "Otras N series" no es un canal, así que no se puede filtrar por él.
              return (
                <li key={item.label}>
                  {real ? (
                    <button
                      type="button"
                      className={`sales-channel-row${activeChannel === item.label ? " is-active" : ""}`}
                      onClick={() => setChannel(activeChannel === item.label ? null : item.label)}
                      aria-pressed={activeChannel === item.label}
                    >
                      {content}
                    </button>
                  ) : (
                    <span className="sales-channel-row is-plain">{content}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </article>

        <article className="panel table-panel sales-board-third">
          <div className="panel-heading">
            <div><h2>Por sociedad</h2><p className="panel-subtitle">Año {shownYear}, sin filtrar</p></div>
          </div>
          <div className="table-scroll">
            <table className="sales-compact-table">
              <thead><tr><th>Sociedad</th><th>Albaranes</th><th>Ventas</th><th>Margen €</th><th>Margen %</th></tr></thead>
              <tbody>
                {byCompany.map((company) => (
                  <tr key={company.code}>
                    <td><strong>{company.name}</strong></td>
                    <td>{numberFormatter.format(company.bucket.documents)}</td>
                    <td>{euros(company.bucket.net)}</td>
                    <td>{company.margin ? euros(company.margin.amount) : <span className="muted">—</span>}</td>
                    <td>{company.margin ? formatPercent(company.margin.percent) : <span className="muted">—</span>}</td>
                  </tr>
                ))}
                {byCompany.length === 0 ? <tr><td colSpan={5} className="muted">Sin ventas en este periodo.</td></tr> : null}
              </tbody>
              {byCompany.length > 1 ? (
                <tfoot>
                  <tr>
                    <td><strong>Todas</strong></td>
                    <td><strong>{numberFormatter.format(byCompany.reduce((sum, company) => sum + company.bucket.documents, 0))}</strong></td>
                    <td><strong>{euros(byCompany.reduce((sum, company) => sum + company.bucket.net, 0))}</strong></td>
                    <td>{companiesMargin ? <strong>{euros(companiesMargin.amount)}</strong> : <span className="muted">—</span>}</td>
                    <td>{companiesMargin ? <strong>{formatPercent(companiesMargin.percent)}</strong> : <span className="muted">—</span>}</td>
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
        </article>
      </section>

      <section className="panel sales-footnote">
        <p className="muted">
          {lastRun
            ? `Última lectura de Sage: ${new Date(lastRun.started_at).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" })}.`
            : "Todavía no consta ninguna lectura de Sage."}
          {isCurrentYear ? ` Los últimos ${PROVISIONAL_DAYS} días son provisionales: se siguen corrigiendo albaranes y facturando, así que esas cifras aún se mueven.` : ""}
          {" "}Si un número no cuadra con Sage, manda Sage.
        </p>
      </section>
    </div>
  );
}
