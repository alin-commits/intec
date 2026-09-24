"use client";

import { useEffect, useMemo, useState } from "react";
import { KpiCard } from "@/components/kpi-card";
import { TrendChart } from "@/components/charts/trend-chart";
import { DonutChart, type DonutItem } from "@/components/charts/donut-chart";
import { ConsultasIcon, ConversionIcon, EuroIcon, UsuariosIcon } from "@/components/icons";
import { currencyFormatter, numberFormatter, formatPercent } from "@/lib/format";
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

/** Días que tarda un día en dejar de moverse: se corrigen albaranes y se factura. */
const PROVISIONAL_DAYS = 7;

const monthNames = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/**
 * El 16 de octubre de 2025 se cambio el sistema de series en Sage: las series
 * viejas (IM0, IM2, IM5, IM75...) acaban el dia 15 y las nuevas (CRE, B2C, POS,
 * B2B, TK, SAT, CON...) arrancan el 16.
 *
 * En las viejas el coste no vale: suma mas que la propia venta, con un coste de
 * entre 1,1 y 1,9 veces la base imponible, lo que daria a la empresa un margen
 * negativo del -45 % en 2024 y del -85 % en 2023. En las nuevas sale entre el
 * 25 % y el 35 % todos los meses, que es lo que se espera de una distribuidora.
 *
 * Asi que la venta de los anos anteriores se ensena -esa si es buena- y el
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

/**
 * El margen sobre la venta que tiene coste fiable, o null cuando no hay nada
 * que medir. Deja fuera dos cosas: lo anterior al cambio de series y la venta
 * sin coste grabado, que si se contara subiria el margen artificialmente.
 */
function bucketMargin(bucket: Bucket): { amount: number; percent: number } | null {
  const base = bucket.costNet - bucket.withoutCost;
  if (base <= 0) return null;
  return { amount: base - bucket.cost, percent: ((base - bucket.cost) / base) * 100 };
}

export function SalesDashboardView() {
  const [stage, setStage] = useState<"loading" | "denied" | "ready">("loading");
  const [error, setError] = useState<string | null>(null);
  const [years, setYears] = useState<number[]>([]);
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [basis, setBasis] = useState<"albaran" | "factura">("albaran");
  const [companyCode, setCompanyCode] = useState<"all" | number>("all");
  const [rows, setRows] = useState<SummaryRow[]>([]);
  const [previousRows, setPreviousRows] = useState<SummaryRow[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [reps, setReps] = useState<Rep[]>([]);
  const [lastRun, setLastRun] = useState<SyncRun | null>(null);
  /** True cuando se compara contra el mismo tramo del año anterior, no el año entero. */
  const [comparisonIsPartial, setComparisonIsPartial] = useState(false);

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
        const [{ data: yearRows }, { data: companyRows }, { data: repRows }, { data: runRows }] = await Promise.all([
          supabase.rpc("sage_sales_years"),
          supabase.from("sage_companies").select("code, name, is_active").order("code"),
          supabase.from("sage_reps").select("company_code, code, name, is_person"),
          supabase.from("sage_sync_runs").select("started_at, ok, covered_from, covered_to").eq("ok", true).order("started_at", { ascending: false }).limit(1),
        ]);
        if (!active) return;
        const found = (yearRows ?? []).map((row: { year: number }) => row.year);
        setYears(found);
        if (found.length > 0 && !found.includes(year)) setYear(found[0]);
        setCompanies((companyRows ?? []) as Company[]);
        setReps((repRows ?? []) as Rep[]);
        setLastRun(((runRows ?? [])[0] as SyncRun) ?? null);
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
      try {
        const supabase = createClient();
        // Un año en curso se compara contra el mismo tramo del anterior, no
        // contra el año entero: si no, en septiembre siempre parecería que se
        // ha vendido un 30 % menos.
        const today = new Date();
        const partial = year === today.getFullYear();
        const sameDay = `${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
        const [{ data: current }, { data: before }] = await Promise.all([
          supabase.rpc("sage_sales_summary", { p_from: `${year}-01-01`, p_to: `${year}-12-31`, p_basis: basis }),
          supabase.rpc("sage_sales_summary", {
            p_from: `${year - 1}-01-01`,
            p_to: partial ? `${year - 1}-${sameDay}` : `${year - 1}-12-31`,
            p_basis: basis,
          }),
        ]);
        if (!active) return;
        setComparisonIsPartial(partial);
        setRows((current ?? []) as SummaryRow[]);
        setPreviousRows((before ?? []) as SummaryRow[]);
      } catch (cause) {
        console.error("No se pudieron cargar las ventas:", cause);
        if (active) setError("No se pudieron cargar las ventas de ese periodo.");
      }
    })();
    return () => { active = false; };
  }, [stage, year, basis]);

  const visible = useMemo(
    () => rows.filter((row) => companyCode === "all" || row.company_code === companyCode),
    [rows, companyCode],
  );
  const visibleBefore = useMemo(
    () => previousRows.filter((row) => companyCode === "all" || row.company_code === companyCode),
    [previousRows, companyCode],
  );

  const totals = useMemo(() => {
    const sum = (list: SummaryRow[]) => {
      const bucket = emptyBucket();
      for (const row of list) addRow(bucket, row);
      return bucket;
    };
    return { current: sum(visible), previous: sum(visibleBefore) };
  }, [visible, visibleBefore]);

  const { current, previous } = totals;
  const variation = (now: number, before: number) => (before ? ((now - before) / before) * 100 : null);
  const delta = (value: number | null) =>
    value === null
      ? { delta: "Sin comparación", positive: true }
      : { delta: `${value >= 0 ? "+" : ""}${value.toFixed(1).replace(".", ",")} %`, positive: value >= 0 };

  const currentMargin = bucketMargin(current);
  const previousMargin = bucketMargin(previous);
  const withoutCostShare = current.costNet > 0 ? (current.withoutCost / current.costNet) * 100 : 0;
  /** Venta del periodo que se queda fuera del margen por venir de las series viejas. */
  const netBeforeSeriesChange = current.net - current.costNet;
  const marginCoversEverything = netBeforeSeriesChange <= 0;

  const monthly = useMemo(() => {
    const map = new Map<string, Bucket>();
    for (const row of visible) {
      const bucket = map.get(row.month) ?? emptyBucket();
      addRow(bucket, row);
      map.set(row.month, bucket);
    }
    const months = Array.from({ length: 12 }, (_, index) => {
      const bucket = map.get(`${year}-${String(index + 1).padStart(2, "0")}`) ?? emptyBucket();
      return { label: monthNames[index], bucket, margin: bucketMargin(bucket) };
    });
    return {
      points: months.map((month) => ({
        label: month.label,
        ventas: Math.round(month.bucket.net),
        margen: Math.round(month.margin?.amount ?? 0),
      })),
      // La linea de margen solo se dibuja si la tienen todos los meses con venta:
      // si no, caeria a cero en los de las series viejas y pareceria un desplome.
      marginComplete: months.every((month) => month.bucket.net === 0 || month.margin !== null),
    };
  }, [visible, year]);

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
      name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
    // De más largo a más corto, para que el primero que encaje sea el completo.
    const names = [...new Set(reps.map((rep) => rep.name))].sort((a, b) => plain(b).length - plain(a).length);
    const identities = new Map<string, { key: string; label: string }>();
    for (const name of names) {
      const fuller = names.find((other) => plain(other).startsWith(`${plain(name)} `)) ?? name;
      identities.set(name, { key: plain(fuller), label: fuller });
    }
    return identities;
  }, [reps]);

  const byRep = useMemo(() => {
    const map = new Map<string, { name: string; assigned: boolean; bucket: Bucket }>();
    for (const row of visible) {
      const rep = row.rep_code === null ? null : reps.find((item) => item.company_code === row.company_code && item.code === row.rep_code);
      const identity = rep ? repIdentities.get(rep.name) : undefined;
      const name = row.rep_code === null ? "Sin comercial asignado" : identity?.label ?? `Código ${row.rep_code}`;
      const key = row.rep_code === null ? "sin" : identity?.key ?? `${row.company_code}-${row.rep_code}`;
      const entry = map.get(key) ?? { name, assigned: row.rep_code !== null, bucket: emptyBucket() };
      addRow(entry.bucket, row);
      map.set(key, entry);
    }
    return [...map]
      .map(([key, value]) => ({ key, ...value, margin: bucketMargin(value.bucket) }))
      .sort((a, b) => b.bucket.net - a.bucket.net);
  }, [visible, reps, repIdentities]);

  /** Cuántos canales caben en la rosquilla antes de que las etiquetas se corten. */
  const TOP_CHANNELS = 8;

  const byChannel = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of visible) {
      const label = channelNames[row.series] ?? (row.series || "Sin serie");
      map.set(label, (map.get(label) ?? 0) + Number(row.net_amount));
    }
    // Los abonos van en negativo y una rosquilla no los puede dibujar, así que
    // se apartan y se dicen debajo: si no, el total del centro no cuadraría con
    // el de ventas de arriba y nadie sabría por qué.
    const positive = [...map].filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1]);
    const refunds = [...map].reduce((sum, [, value]) => (value < 0 ? sum + value : sum), 0);
    // Con 19 series las etiquetas salen cortadas a "Cré...", así que la cola se
    // junta en una sola porción.
    const head = positive.slice(0, TOP_CHANNELS);
    const tail = positive.slice(TOP_CHANNELS);
    const shown = tail.length > 0
      ? [...head, [`Otras ${tail.length} series`, tail.reduce((sum, [, value]) => sum + value, 0)] as [string, number]]
      : head;
    return { shown, refunds };
  }, [visible]);

  const channelItems: DonutItem[] = byChannel.shown.map(([label, value], index) => ({
    label,
    value: Math.round(value),
    color: channelColors[index % channelColors.length],
  }));

  if (stage === "denied") {
    return (
      <div className="page-stack">
        <section className="panel">
          <h2>No tienes acceso a esta página</h2>
          <p>Las ventas de Sage solo las ven dirección y administración.</p>
        </section>
      </div>
    );
  }
  if (error) {
    return (
      <div className="page-stack">
        <section className="panel">
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
        <section className="panel">
          <h2>Todavía no han llegado datos de Sage</h2>
          <p className="muted">
            El programa que lee Sage aún no ha enviado nada. En cuanto lo haga, esta página se llena sola.
          </p>
        </section>
      </div>
    );
  }

  const isCurrentYear = year === new Date().getFullYear();
  const comparisonHelper = comparisonIsPartial ? `frente al mismo tramo de ${year - 1}` : `frente a ${year - 1}`;
  const companyLabel = companyCode === "all" ? "todas las sociedades" : byCompany.find((item) => item.code === companyCode)?.name ?? "";

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
          <select className="panel-heading-select" value={basis} onChange={(event) => setBasis(event.target.value as "albaran" | "factura")} aria-label="Qué fecha manda">
            <option value="albaran">Por fecha de albarán</option>
            <option value="factura">Por fecha de factura</option>
          </select>
        </div>
      </section>

      {basis === "factura" ? (
        <section className="panel notice">
          <strong>Estás viendo la venta por fecha de factura.</strong>
          <span>
            Lo servido y todavía sin facturar no aparece aquí, así que el mes en curso siempre parece más pequeño de
            lo que es. Para saber cuánto se ha vendido, mira por fecha de albarán.
          </span>
        </section>
      ) : null}

      <section className="kpi-grid kpi-grid-main">
        <KpiCard
          label="Ventas"
          value={currencyFormatter.format(current.net)}
          helper={comparisonHelper}
          icon={<EuroIcon />}
          tone="indigo"
          {...delta(variation(current.net, previous.net))}
        />
        <KpiCard
          label="Margen"
          value={currentMargin ? currencyFormatter.format(currentMargin.amount) : "No disponible"}
          helper={currentMargin
            ? `${formatPercent(currentMargin.percent)} sobre lo que tiene coste${marginCoversEverything ? "" : ", solo desde el cambio de series"}`
            : "el coste de las series antiguas no sirve"}
          icon={<ConversionIcon />}
          tone={currentMargin ? "emerald" : "amber"}
          {...(currentMargin && previousMargin
            ? delta(variation(currentMargin.amount, previousMargin.amount))
            : { delta: "Sin comparación", positive: true })}
        />
        <KpiCard
          label="Albaranes"
          value={numberFormatter.format(current.documents)}
          helper={comparisonHelper}
          icon={<ConsultasIcon />}
          tone="sky"
          {...delta(variation(current.documents, previous.documents))}
        />
        <KpiCard
          label="Ticket medio"
          value={currencyFormatter.format(current.documents ? current.net / current.documents : 0)}
          helper="por albarán"
          icon={<UsuariosIcon />}
          tone="amber"
          delta="Sin comparación"
        />
      </section>

      {!marginCoversEverything ? (
        <section className="panel sales-broken">
          <div>
            <strong>
              {currentMargin
                ? `El margen deja fuera ${currencyFormatter.format(netBeforeSeriesChange)} de venta anterior al cambio de series`
                : "De este periodo no se puede sacar el margen"}
            </strong>
            <span>
              El 16 de octubre de 2025 se cambió el sistema de series en Sage. En las series antiguas el coste está
              mal grabado: suma más que la propia venta, lo que daría un margen negativo imposible. La venta de
              entonces sí es buena y está contada arriba; el coste no, así que esa parte se queda fuera del margen.
            </span>
          </div>
        </section>
      ) : null}

      {current.withoutCost > 0 ? (
        <section className="panel sales-warning">
          <div>
            <strong>{currencyFormatter.format(current.withoutCost)} de venta no tienen coste grabado en Sage</strong>
            <span>
              Es el {formatPercent(withoutCostShare)} de la venta con la que se mide el margen, que lo deja fuera porque
              contarla como si no costara nada lo subiría artificialmente. Con ella dentro saldría{" "}
              {formatPercent(((current.costNet - current.cost) / current.costNet) * 100)}.
            </span>
          </div>
        </section>
      ) : null}

      <section className="panel chart-panel">
        <div className="panel-heading">
          <div>
            <h2>Evolución del año</h2>
            <p className="panel-subtitle">
              {monthly.marginComplete ? "Ventas y margen por mes, en euros" : "Ventas por mes, en euros"}
            </p>
          </div>
        </div>
        <TrendChart
          data={monthly.points}
          series={monthly.marginComplete
            ? [{ key: "ventas", label: "Ventas", color: "#4f46e5" }, { key: "margen", label: "Margen", color: "#10b981" }]
            : [{ key: "ventas", label: "Ventas", color: "#4f46e5" }]}
          ariaLabel={monthly.marginComplete
            ? `Evolución mensual de ventas y margen en ${year}`
            : `Evolución mensual de ventas en ${year}`}
        />
      </section>

      <section className="dashboard-grid">
        <article className="panel table-panel">
          <div className="panel-heading">
            <div><h2>Por comercial</h2><p className="panel-subtitle">{companyLabel}, año {year}</p></div>
          </div>
          <div className="table-scroll">
            <table className="sales-rep-table">
              <thead><tr><th>Comercial</th><th>Albaranes</th><th>Ventas</th><th>Margen</th></tr></thead>
              <tbody>
                {byRep.map((rep) => (
                  <tr key={rep.key} className={rep.assigned ? undefined : "row-muted"}>
                    <td><strong>{rep.name}</strong></td>
                    <td>{numberFormatter.format(rep.bucket.documents)}</td>
                    <td>{currencyFormatter.format(rep.bucket.net)}</td>
                    <td>{rep.margin ? formatPercent(rep.margin.percent) : <span className="muted">—</span>}</td>
                  </tr>
                ))}
                {byRep.length === 0 ? <tr><td colSpan={4} className="muted">Sin ventas en este periodo.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </article>

        <article className="panel chart-panel sales-channel">
          <div className="panel-heading">
            <div>
              <h2>Por canal</h2>
              <p className="panel-subtitle">
                Según la serie del albarán
                {byChannel.refunds < 0 ? `, sin los ${currencyFormatter.format(-byChannel.refunds)} de abonos` : ""}
              </p>
            </div>
          </div>
          <DonutChart
            items={channelItems}
            centerLabel="ventas"
            ariaLabel="Reparto de las ventas por canal"
            emptyMessage="Sin datos en este periodo."
          />
        </article>
      </section>

      <section className="panel table-panel">
        <div className="panel-heading">
          <div><h2>Por sociedad</h2><p className="panel-subtitle">Año {year}, todas las sociedades</p></div>
        </div>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Sociedad</th><th>Albaranes</th><th>Ventas</th><th>Margen €</th><th>Margen %</th></tr></thead>
            <tbody>
              {byCompany.map((company) => (
                <tr key={company.code}>
                  <td><strong>{company.name}</strong></td>
                  <td>{numberFormatter.format(company.bucket.documents)}</td>
                  <td>{currencyFormatter.format(company.bucket.net)}</td>
                  <td>{company.margin ? currencyFormatter.format(company.margin.amount) : <span className="muted">—</span>}</td>
                  <td>{company.margin ? formatPercent(company.margin.percent) : <span className="muted">—</span>}</td>
                </tr>
              ))}
              {byCompany.length === 0 ? <tr><td colSpan={5} className="muted">Sin ventas en este periodo.</td></tr> : null}
            </tbody>
          </table>
        </div>
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
