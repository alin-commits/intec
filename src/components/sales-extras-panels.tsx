"use client";

import { useEffect, useMemo, useState } from "react";
import { KpiCard } from "@/components/kpi-card";
import { TrendChart } from "@/components/charts/trend-chart";
import { CalendarIcon, ConsultasIcon, DocumentIcon, UsuariosIcon, WalletIcon, XCircleIcon } from "@/components/icons";
import { formatPercent, numberFormatter } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { familyMargin, lastCompleteMonth, latestSnapshot, trustedNewCustomersFrom, type SnapshotRow } from "@/lib/sage-panel";

/*
  Lo que llega de Sage además de la venta: ofertas y pedidos, la cartera por
  servir, la venta por familia y los clientes (cuántos, nunca quiénes).

  Sale por debajo del panel de ventas y respeta su año y su sociedad. Hasta que
  el agente del servidor de Sage se actualice no hay nada de esto, y entonces lo
  dice en vez de enseñar ceros que parecerían un hundimiento.
*/

type OrderRow = { month: string; company_code: number; kind: "oferta" | "pedido"; rep_code: number | null; documents: number; net_amount: number };
type FamilyRow = {
  company_code: number;
  family_code: string;
  family_name: string | null;
  units: number;
  net_amount: number;
  trusted_net: number;
  trusted_cost: number;
  trusted_without_cost: number;
};
type CustomerRow = { company_code: number; month: string; active_customers: number; new_customers: number };

type ExtrasData = {
  year: number;
  orders: OrderRow[];
  families: FamilyRow[];
  customers: CustomerRow[];
  firstCustomerMonth: string | null;
  snapshots: SnapshotRow[];
  agentNotes: string | null;
};

const monthNames = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const euros = (value: number) => `${numberFormatter.format(Math.round(value))} €`;
const shortDate = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString("es-ES", { day: "numeric", month: "short" });
/** Cuántas familias se enseñan antes de juntar el resto en una fila. */
const TOP_FAMILIES = 12;

export function SalesExtrasPanels({ year, companyCode, companyLabel, repLabel, reloadKey = 0 }: {
  year: number;
  /** Sube cuando termina una lectura de Sage pedida con el botón. */
  reloadKey?: number;
  companyCode: "all" | number;
  companyLabel: string;
  /** El nombre de un comercial, con las fichas repetidas de Sage ya juntadas. */
  repLabel: (companyCode: number, repCode: number | null) => { key: string; label: string };
}) {
  const [data, setData] = useState<ExtrasData | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const supabase = createClient();
        const from = `${year}-01-01`;
        const to = `${year}-12-31`;
        const [orders, families, customers, firstCustomer, snapshots, lastRun] = await Promise.all([
          supabase.rpc("sage_orders_summary", { p_from: from, p_to: to }),
          supabase.rpc("sage_family_summary", { p_from: from, p_to: to }),
          supabase.from("sage_customers_monthly").select("company_code, month, active_customers, new_customers").gte("month", from).lte("month", `${year}-12-01`),
          supabase.from("sage_customers_monthly").select("month").order("month").limit(1),
          // Las fotos más recientes: basta con las últimas filas para tener la de hoy.
          supabase.from("sage_snapshots").select("taken_on, company_code, metric, rep_code, count, amount").order("taken_on", { ascending: false }).limit(1000),
          supabase.from("sage_sync_runs").select("message").eq("ok", true).order("started_at", { ascending: false }).limit(1),
        ]);
        const failure = orders.error ?? families.error ?? customers.error ?? firstCustomer.error ?? snapshots.error ?? lastRun.error;
        if (failure) throw failure;
        if (!active) return;
        const message = ((lastRun.data ?? [])[0] as { message: string | null } | undefined)?.message ?? null;
        const marker = "Avisos del agente:";
        setData({
          year,
          orders: (orders.data ?? []) as OrderRow[],
          families: (families.data ?? []) as FamilyRow[],
          customers: (customers.data ?? []) as CustomerRow[],
          firstCustomerMonth: ((firstCustomer.data ?? [])[0] as { month: string } | undefined)?.month ?? null,
          snapshots: (snapshots.data ?? []) as SnapshotRow[],
          agentNotes: message && message.includes(marker) ? message.slice(message.indexOf(marker) + marker.length).trim() : null,
        });
        setFailed(false);
      } catch (cause) {
        console.error("No se pudieron cargar los datos extra de Sage:", cause);
        if (active) setFailed(true);
      }
    })();
    return () => { active = false; };
  }, [year, reloadKey]);

  const inCompany = useMemo(
    () => (row: { company_code: number }) => companyCode === "all" || row.company_code === companyCode,
    [companyCode],
  );

  const view = useMemo(() => {
    if (!data) return null;
    const shownYear = data.year;
    const today = new Date();
    const lastMonthIndex = shownYear === today.getFullYear() ? today.getMonth() : 11;
    const monthKeys = Array.from({ length: lastMonthIndex + 1 }, (_, index) => `${shownYear}-${String(index + 1).padStart(2, "0")}`);

    // ---- Ofertas y pedidos ----
    const orders = data.orders.filter(inCompany);
    const totals = { oferta: { net: 0, documents: 0 }, pedido: { net: 0, documents: 0 } };
    const byMonth = new Map<string, { oferta: number; pedido: number }>();
    for (const row of orders) {
      totals[row.kind].net += Number(row.net_amount);
      totals[row.kind].documents += Number(row.documents);
      const month = byMonth.get(row.month) ?? { oferta: 0, pedido: 0 };
      month[row.kind] += Number(row.net_amount);
      byMonth.set(row.month, month);
    }
    const hasOffers = data.orders.some((row) => row.kind === "oferta");
    const hasOrders = data.orders.some((row) => row.kind === "pedido");
    const orderPoints = monthKeys.map((key, index) => ({
      label: monthNames[index],
      ofertas: Math.round(byMonth.get(key)?.oferta ?? 0),
      pedidos: Math.round(byMonth.get(key)?.pedido ?? 0),
    }));

    // ---- Cartera por servir y clientes dormidos: la foto más reciente ----
    const backlogSnapshot = latestSnapshot(data.snapshots, "pedidos_pendientes");
    const backlogRows = backlogSnapshot.rows.filter(inCompany);
    const backlog = backlogSnapshot.takenOn
      ? {
          takenOn: backlogSnapshot.takenOn,
          amount: backlogRows.reduce((sum, row) => sum + Number(row.amount), 0),
          count: backlogRows.reduce((sum, row) => sum + Number(row.count), 0),
        }
      : null;
    const backlogByRep = (() => {
      const map = new Map<string, { label: string; assigned: boolean; amount: number; count: number }>();
      for (const row of backlogRows) {
        const who = row.rep_code === null ? { key: "sin", label: "Sin comercial asignado" } : repLabel(row.company_code, row.rep_code);
        const entry = map.get(who.key) ?? { label: who.label, assigned: row.rep_code !== null, amount: 0, count: 0 };
        entry.amount += Number(row.amount);
        entry.count += Number(row.count);
        map.set(who.key, entry);
      }
      return [...map.values()].sort((a, b) => b.amount - a.amount);
    })();
    const dormantSnapshot = latestSnapshot(data.snapshots, "clientes_dormidos");
    const dormantRows = dormantSnapshot.rows.filter(inCompany);
    const dormant = dormantSnapshot.takenOn
      ? {
          count: dormantRows.reduce((sum, row) => sum + Number(row.count), 0),
          amount: dormantRows.reduce((sum, row) => sum + Number(row.amount), 0),
        }
      : null;

    // ---- Venta por familia ----
    // Con "todas las sociedades" se juntan las familias que se llaman igual en
    // cada una (mismo código), que es como se lee en Sage.
    const familyMap = new Map<string, { name: string; net: number; trusted_net: number; trusted_cost: number; trusted_without_cost: number }>();
    for (const row of data.families.filter(inCompany)) {
      const key = row.family_code || "";
      const entry = familyMap.get(key) ?? {
        name: row.family_name || (row.family_code ? `Familia ${row.family_code}` : "Sin familia"),
        net: 0,
        trusted_net: 0,
        trusted_cost: 0,
        trusted_without_cost: 0,
      };
      if (row.family_name && entry.name.startsWith("Familia ")) entry.name = row.family_name;
      entry.net += Number(row.net_amount);
      entry.trusted_net += Number(row.trusted_net);
      entry.trusted_cost += Number(row.trusted_cost);
      entry.trusted_without_cost += Number(row.trusted_without_cost);
      familyMap.set(key, entry);
    }
    const familyList = [...familyMap.values()].sort((a, b) => b.net - a.net);
    const familyTotal = familyList.reduce((sum, family) => sum + Math.max(family.net, 0), 0);
    const familyHead = familyList.slice(0, TOP_FAMILIES);
    const familyTail = familyList.slice(TOP_FAMILIES);
    const familyRest = familyTail.length
      ? { name: `Otras ${familyTail.length} familias`, net: familyTail.reduce((sum, family) => sum + family.net, 0) }
      : null;

    // ---- Clientes ----
    const customers = data.customers.filter(inCompany);
    const trustedFrom = trustedNewCustomersFrom(data.firstCustomerMonth);
    const customerMonths = new Map<string, { active: number; fresh: number }>();
    for (const row of customers) {
      const key = row.month.slice(0, 7);
      const entry = customerMonths.get(key) ?? { active: 0, fresh: 0 };
      entry.active += Number(row.active_customers);
      entry.fresh += Number(row.new_customers);
      customerMonths.set(key, entry);
    }
    const trustedMonths = monthKeys.filter((key) => trustedFrom !== null && key >= trustedFrom);
    const newCustomers = trustedMonths.length > 0
      ? trustedMonths.reduce((sum, key) => sum + (customerMonths.get(key)?.fresh ?? 0), 0)
      : null;
    const lastMonth = lastCompleteMonth(shownYear, today);
    const activeLastMonth = lastMonth ? customerMonths.get(lastMonth)?.active ?? null : null;
    const newIsComplete = trustedMonths.length === monthKeys.length;
    const customerPoints = monthKeys.map((key, index) => ({
      label: monthNames[index],
      activos: customerMonths.get(key)?.active ?? 0,
      nuevos: customerMonths.get(key)?.fresh ?? 0,
    }));

    return {
      shownYear,
      totals,
      hasOffers,
      hasOrders,
      orderPoints,
      backlog,
      backlogByRep,
      dormant,
      familyHead,
      familyRest,
      familyTotal,
      hasFamilies: data.families.length > 0,
      hasCustomers: data.customers.length > 0,
      newCustomers,
      newIsComplete,
      lastMonth,
      activeLastMonth,
      customerPoints,
      agentNotes: data.agentNotes,
      hasAnything: data.orders.length > 0 || data.families.length > 0 || data.customers.length > 0 || data.snapshots.length > 0,
    };
  }, [data, inCompany, repLabel]);

  if (failed) {
    return (
      <section className="panel sales-broken">
        <div>
          <strong>No se pudieron cargar las ofertas, los pedidos, las familias ni los clientes.</strong>
          <span>Lo de arriba sí está al día. Recarga la página para intentarlo otra vez.</span>
        </div>
      </section>
    );
  }
  if (!view) return null;

  if (!view.hasAnything) {
    return (
      <section className="panel sales-footnote">
        <p className="muted">
          <strong>Pronto aquí: ofertas, pedidos, cartera por servir, venta por familia y clientes.</strong>{" "}
          Aparecerán solos en cuanto se actualice el programa que lee Sage en su servidor.
        </p>
      </section>
    );
  }

  const monthLabel = (key: string) => `${monthNames[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
  const backlogMax = Math.max(...view.backlogByRep.map((rep) => rep.amount), 1);

  return (
    <>
      <section className="section-heading sales-extras-heading">
        <div>
          <h2>Ofertas, pedidos y clientes</h2>
          <p>
            Según Sage, en {companyLabel}. Son totales: ni nombres de clientes ni documentos salen del servidor.
          </p>
        </div>
      </section>

      {view.agentNotes ? (
        <section className="panel sales-warning">
          <div>
            <strong>Hay datos de Sage que el programa no pudo leer</strong>
            <span>{view.agentNotes}</span>
          </div>
        </section>
      ) : null}

      <section className="kpi-grid kpi-grid-sales">
        {view.hasOffers ? (
          <KpiCard label={`Ofertas ${view.shownYear}`} value={euros(view.totals.oferta.net)} helper={`${numberFormatter.format(view.totals.oferta.documents)} ofertas`} delta="Sin comparación" icon={<DocumentIcon />} tone="indigo" />
        ) : null}
        {view.hasOrders ? (
          <KpiCard label={`Pedidos ${view.shownYear}`} value={euros(view.totals.pedido.net)} helper={`${numberFormatter.format(view.totals.pedido.documents)} pedidos`} delta="Sin comparación" icon={<ConsultasIcon />} tone="sky" />
        ) : null}
        {view.backlog ? (
          <KpiCard label="Cartera por servir" value={euros(view.backlog.amount)} helper={`${numberFormatter.format(view.backlog.count)} pedidos · a ${shortDate(view.backlog.takenOn)}`} delta="Sin comparación" icon={<WalletIcon />} tone="amber" />
        ) : null}
        {view.activeLastMonth !== null && view.lastMonth ? (
          <KpiCard label={`Clientes en ${monthLabel(view.lastMonth)}`} value={numberFormatter.format(view.activeLastMonth)} helper={companyCode === "all" ? "con compra ese mes, suma de sociedades" : "con alguna compra ese mes"} delta="Sin comparación" icon={<UsuariosIcon />} tone="emerald" />
        ) : null}
        {view.newCustomers !== null ? (
          <KpiCard label={`Clientes nuevos ${view.shownYear}`} value={numberFormatter.format(view.newCustomers)} helper={view.newIsComplete ? "primera compra este año" : "solo desde que hay un año de historia"} delta="Sin comparación" icon={<CalendarIcon />} tone="emerald" />
        ) : null}
        {view.dormant ? (
          <KpiCard label="Han dejado de comprar" value={numberFormatter.format(view.dormant.count)} helper={`clientes · compraban ${euros(view.dormant.amount)} al año`} delta="Sin comparación" icon={<XCircleIcon />} tone="rose" />
        ) : null}
      </section>

      <section className="sales-board">
        {view.hasOffers || view.hasOrders ? (
          <article className="panel chart-panel sales-board-wide">
            <div className="panel-heading">
              <div>
                <h2>Ofertas y pedidos</h2>
                <p className="panel-subtitle">Importe por mes, sin IVA, de {view.shownYear}</p>
              </div>
            </div>
            <TrendChart
              data={view.orderPoints}
              series={[
                ...(view.hasOffers ? [{ key: "ofertas", label: "Ofertas", color: "#6366f1" }] : []),
                ...(view.hasOrders ? [{ key: "pedidos", label: "Pedidos", color: "#10b981" }] : []),
              ]}
              ariaLabel={`Ofertas y pedidos por mes en ${view.shownYear}`}
            />
          </article>
        ) : null}

        {view.backlog ? (
          <article className="panel panel-padded sales-board-narrow">
            <div className="panel-heading">
              <div>
                <h2>Cartera por comercial</h2>
                <p className="panel-subtitle">Pedidos de los últimos 12 meses con algo por servir</p>
              </div>
            </div>
            {view.backlogByRep.length === 0 ? (
              <p className="muted">No hay pedidos pendientes de servir.</p>
            ) : (
              <ol className="sales-rank">
                {view.backlogByRep.map((rep) => (
                  <li key={rep.label}>
                    <div className={`sales-rank-row is-static${rep.assigned ? "" : " is-muted"}`}>
                      <span className="sales-rank-name" title={rep.label}>{rep.label}</span>
                      <span className="sales-rank-track">
                        <span className="sales-rank-fill" style={{ width: `${Math.max(1.5, (Math.max(rep.amount, 0) / backlogMax) * 100)}%` }} />
                      </span>
                      <strong className="sales-rank-value">{euros(rep.amount)}</strong>
                      <span className="sales-rank-margin">{numberFormatter.format(rep.count)}</span>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </article>
        ) : null}

        {view.hasFamilies ? (
          <article className="panel table-panel sales-board-half">
            <div className="panel-heading">
              <div>
                <h2>Venta por familia</h2>
                <p className="panel-subtitle">Suma de las líneas de albarán; puede no cuadrar al euro con el total por los descuentos de cabecera</p>
              </div>
            </div>
            <div className="table-scroll">
              <table className="sales-compact-table">
                <thead><tr><th>Familia</th><th>Ventas</th><th>Peso</th><th>Margen</th></tr></thead>
                <tbody>
                  {view.familyHead.map((family, index) => {
                    const margin = familyMargin(family);
                    return (
                      <tr key={`${family.name}-${index}`}>
                        <td><strong>{family.name}</strong></td>
                        <td>{euros(family.net)}</td>
                        <td>{view.familyTotal > 0 ? `${Math.round((Math.max(family.net, 0) / view.familyTotal) * 100)}%` : "—"}</td>
                        <td>{margin === null ? <span className="muted">—</span> : formatPercent(margin)}</td>
                      </tr>
                    );
                  })}
                  {view.familyRest ? (
                    <tr>
                      <td className="muted">{view.familyRest.name}</td>
                      <td>{euros(view.familyRest.net)}</td>
                      <td>{view.familyTotal > 0 ? `${Math.round((Math.max(view.familyRest.net, 0) / view.familyTotal) * 100)}%` : "—"}</td>
                      <td />
                    </tr>
                  ) : null}
                  {view.familyHead.length === 0 ? <tr><td colSpan={4} className="muted">Sin ventas por familia en este periodo.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </article>
        ) : null}

        {view.hasCustomers ? (
          <article className="panel chart-panel sales-board-half">
            <div className="panel-heading">
              <div>
                <h2>Clientes por mes</h2>
                <p className="panel-subtitle">
                  Cuántos compran cada mes{view.newIsComplete ? " y cuántos por primera vez" : ""}
                  {companyCode === "all" ? " (suma de sociedades)" : ""}
                </p>
              </div>
            </div>
            <TrendChart
              data={view.customerPoints}
              series={[
                { key: "activos", label: "Con compra", color: "#0ea5e9" },
                ...(view.newIsComplete ? [{ key: "nuevos", label: "Nuevos", color: "#10b981" }] : []),
              ]}
              ariaLabel={`Clientes por mes en ${view.shownYear}`}
            />
          </article>
        ) : null}
      </section>
    </>
  );
}
