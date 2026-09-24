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

function marginPercent(net: number, cost: number): number {
  return net > 0 ? ((net - cost) / net) * 100 : 0;
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
        const [{ data: current }, { data: before }] = await Promise.all([
          supabase.rpc("sage_sales_summary", { p_from: `${year}-01-01`, p_to: `${year}-12-31`, p_basis: basis }),
          supabase.rpc("sage_sales_summary", { p_from: `${year - 1}-01-01`, p_to: `${year - 1}-12-31`, p_basis: basis }),
        ]);
        if (!active) return;
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
    const sum = (list: SummaryRow[]) => list.reduce(
      (acc, row) => ({
        net: acc.net + Number(row.net_amount),
        cost: acc.cost + Number(row.cost_amount),
        withoutCost: acc.withoutCost + Number(row.net_without_cost),
        documents: acc.documents + Number(row.documents),
      }),
      { net: 0, cost: 0, withoutCost: 0, documents: 0 },
    );
    return { current: sum(visible), previous: sum(visibleBefore) };
  }, [visible, visibleBefore]);

  const { current, previous } = totals;
  const variation = (now: number, before: number) => (before ? ((now - before) / before) * 100 : null);
  const delta = (value: number | null) =>
    value === null
      ? { delta: "Sin comparación", positive: true }
      : { delta: `${value >= 0 ? "+" : ""}${value.toFixed(1).replace(".", ",")} %`, positive: value >= 0 };

  // El margen de verdad deja fuera la venta que no tiene coste grabado: si se
  // contara, saldría más alto de lo que es.
  const costedNet = current.net - current.withoutCost;
  const reliableMargin = costedNet > 0 ? ((costedNet - current.cost) / costedNet) * 100 : 0;
  const withoutCostShare = current.net > 0 ? (current.withoutCost / current.net) * 100 : 0;

  const monthly = useMemo(() => {
    const map = new Map<string, { net: number; cost: number }>();
    for (const row of visible) {
      const entry = map.get(row.month) ?? { net: 0, cost: 0 };
      entry.net += Number(row.net_amount);
      entry.cost += Number(row.cost_amount);
      map.set(row.month, entry);
    }
    return Array.from({ length: 12 }, (_, index) => {
      const key = `${year}-${String(index + 1).padStart(2, "0")}`;
      const entry = map.get(key) ?? { net: 0, cost: 0 };
      return { label: monthNames[index], ventas: Math.round(entry.net), margen: Math.round(entry.net - entry.cost) };
    });
  }, [visible, year]);

  const byCompany = useMemo(() => {
    const map = new Map<number, { net: number; cost: number; documents: number }>();
    for (const row of rows) {
      const entry = map.get(row.company_code) ?? { net: 0, cost: 0, documents: 0 };
      entry.net += Number(row.net_amount);
      entry.cost += Number(row.cost_amount);
      entry.documents += Number(row.documents);
      map.set(row.company_code, entry);
    }
    return [...map].map(([code, value]) => ({
      code,
      name: companies.find((company) => company.code === code)?.name ?? `Sociedad ${code}`,
      ...value,
    })).sort((a, b) => b.net - a.net);
  }, [rows, companies]);

  const byRep = useMemo(() => {
    const map = new Map<string, { name: string; net: number; cost: number; documents: number; assigned: boolean }>();
    for (const row of visible) {
      const key = row.rep_code === null ? "sin" : `${row.company_code}-${row.rep_code}`;
      const rep = row.rep_code === null ? null : reps.find((item) => item.company_code === row.company_code && item.code === row.rep_code);
      const entry = map.get(key) ?? {
        name: row.rep_code === null ? "Sin comercial asignado" : rep?.name ?? `Código ${row.rep_code}`,
        net: 0, cost: 0, documents: 0,
        assigned: row.rep_code !== null,
      };
      entry.net += Number(row.net_amount);
      entry.cost += Number(row.cost_amount);
      entry.documents += Number(row.documents);
      map.set(key, entry);
    }
    return [...map.values()].sort((a, b) => b.net - a.net);
  }, [visible, reps]);

  const byChannel = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of visible) {
      const label = channelNames[row.series] ?? (row.series || "Sin serie");
      map.set(label, (map.get(label) ?? 0) + Number(row.net_amount));
    }
    // Los abonos van en negativo: en una rosquilla no se pueden dibujar, así
    // que se enseñan aparte en la tabla de al lado.
    return [...map].filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1]);
  }, [visible]);

  const channelItems: DonutItem[] = byChannel.map(([label, value], index) => ({
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
          helper={`frente a ${year - 1}`}
          icon={<EuroIcon />}
          tone="indigo"
          {...delta(variation(current.net, previous.net))}
        />
        <KpiCard
          label="Margen"
          value={currencyFormatter.format(costedNet - current.cost)}
          helper={`${formatPercent(reliableMargin)} sobre lo que tiene coste`}
          icon={<ConversionIcon />}
          tone="emerald"
          {...delta(variation(current.net - current.cost, previous.net - previous.cost))}
        />
        <KpiCard
          label="Albaranes"
          value={numberFormatter.format(current.documents)}
          helper={`frente a ${year - 1}`}
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

      {current.withoutCost > 0 ? (
        <section className="panel sales-warning">
          <div>
            <strong>{currencyFormatter.format(current.withoutCost)} de venta no tienen coste grabado en Sage</strong>
            <span>
              Es el {formatPercent(withoutCostShare)} del total. El margen de arriba deja esa parte fuera, porque
              contarla como si no costara nada lo subiría artificialmente. Con ella dentro saldría{" "}
              {formatPercent(marginPercent(current.net, current.cost))}.
            </span>
          </div>
        </section>
      ) : null}

      <section className="panel chart-panel">
        <div className="panel-heading">
          <div><h2>Evolución del año</h2><p className="panel-subtitle">Ventas y margen por mes, en euros</p></div>
        </div>
        <TrendChart
          data={monthly}
          series={[{ key: "ventas", label: "Ventas", color: "#4f46e5" }, { key: "margen", label: "Margen", color: "#10b981" }]}
          ariaLabel={`Evolución mensual de ventas y margen en ${year}`}
        />
      </section>

      <section className="dashboard-grid">
        <article className="panel table-panel">
          <div className="panel-heading">
            <div><h2>Por comercial</h2><p className="panel-subtitle">{companyLabel}, año {year}</p></div>
          </div>
          <div className="table-scroll">
            <table>
              <thead><tr><th>Comercial</th><th>Albaranes</th><th>Ventas</th><th>Margen</th></tr></thead>
              <tbody>
                {byRep.map((rep) => (
                  <tr key={rep.name} className={rep.assigned ? undefined : "row-muted"}>
                    <td><strong>{rep.name}</strong></td>
                    <td>{numberFormatter.format(rep.documents)}</td>
                    <td>{currencyFormatter.format(rep.net)}</td>
                    <td>{formatPercent(marginPercent(rep.net, rep.cost))}</td>
                  </tr>
                ))}
                {byRep.length === 0 ? <tr><td colSpan={4} className="muted">Sin ventas en este periodo.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </article>

        <article className="panel chart-panel">
          <div className="panel-heading">
            <div><h2>Por canal</h2><p className="panel-subtitle">Según la serie del albarán</p></div>
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
                  <td>{numberFormatter.format(company.documents)}</td>
                  <td>{currencyFormatter.format(company.net)}</td>
                  <td>{currencyFormatter.format(company.net - company.cost)}</td>
                  <td>{formatPercent(marginPercent(company.net, company.cost))}</td>
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
