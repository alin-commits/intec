"use client";

import { KpiCard } from "@/components/kpi-card";
import { TrendChart } from "@/components/charts/trend-chart";
import { CalendarIcon, ClockIcon, ConsultasIcon, ConversionIcon, DocumentIcon, LeadsIcon, WalletIcon, XCircleIcon } from "@/components/icons";
import { leadStatusLabels } from "@/lib/constants";
import { formatPercent, numberFormatter } from "@/lib/format";
import { channelLabel, euros, monthName, monthNames, UNASSIGNED_KEY } from "@/lib/sales-model";
import { createClient } from "@/lib/supabase/client";
import { fetchAllPages } from "@/lib/supabase/fetch-all";
import type { LeadStatus } from "@/lib/types";
import type { SalesContext } from "./sales-context";
import { snapshotTotal, useCustomerTotals } from "./sales-queries";
import { days, LoadFailed, Panel, PendingDetail, RankList, share, useSageQuery } from "./sales-ui";

/*
  Comercial: ofertas, pedidos, cartera por servir, abonos e incidencias, y los
  leads que entran por la web al Hub. Todo con los filtros del panel; cada
  cifra abre la lista de documentos que hay detrás.
*/

type Dimensions = { month: string; company_code: number; series: string; rep_code: number | null };
type OfferStat = Dimensions & {
  reject_reason: string;
  offers: number; net_amount: number;
  converted: number; converted_amount: number; ordered_amount: number;
  timed: number; days_to_order: number;
  open_offers: number; open_amount: number;
  expired: number; expired_amount: number;
  rejected: number; rejected_amount: number;
};
type OrderStat = Dimensions & {
  from_offer: boolean;
  orders: number; net_amount: number;
  pending_orders: number; pending_amount: number; delivered_amount: number;
  served: number; days_to_serve: number;
  with_need: number; late: number;
};
type IncidentStat = Dimensions & { kind: "abono" | "incidencia"; reason: string; documents: number; net_amount: number };
type OldOrderRow = { month: string; company_code: number; kind: "oferta" | "pedido"; rep_code: number | null; documents: number; net_amount: number };
type Lead = { created_at: string; status: LeadStatus; sale_value: number | null; source: string | null };

/** Suma los campos numéricos de una lista de filas. */
function total<T>(rows: T[], field: keyof T): number {
  return rows.reduce((sum, row) => sum + Number(row[field] ?? 0), 0);
}

export function CommercialPage({ ctx }: { ctx: SalesContext }) {
  const { filters, shownYear } = ctx;
  const yearFrom = `${shownYear}-01-01`;
  const yearTo = `${shownYear}-12-31`;
  const reload = ctx.reloadKey;

  const offers = useSageQuery<OfferStat[]>(ctx.detail.offers ? JSON.stringify(["ofertas", shownYear, reload]) : null, async () =>
    await createClient().rpc("sage_offer_stats", { p_from: yearFrom, p_to: yearTo }));
  const orders = useSageQuery<OrderStat[]>(ctx.detail.orders ? JSON.stringify(["pedidos", shownYear, reload]) : null, async () =>
    await createClient().rpc("sage_order_stats", { p_from: yearFrom, p_to: yearTo }));
  const incidents = useSageQuery<IncidentStat[]>(ctx.detail.incidents ? JSON.stringify(["incidencias", shownYear, reload]) : null, async () =>
    await createClient().rpc("sage_incident_stats", { p_from: yearFrom, p_to: yearTo }));
  // Lo de antes del detalle: totales de ofertas y pedidos por mes, sin serie.
  const oldOrders = useSageQuery<OldOrderRow[]>(!ctx.detail.offers || !ctx.detail.orders ? JSON.stringify(["antiguo", shownYear, reload]) : null, async () =>
    await createClient().rpc("sage_orders_summary", { p_from: yearFrom, p_to: yearTo }));
  const totals = useCustomerTotals(ctx);
  const leads = useSageQuery<Lead[]>(ctx.canSeeLeads ? JSON.stringify(["leads", ctx.period.from, ctx.period.to, reload]) : null, async () => {
    const supabase = createClient();
    const { data, error } = await fetchAllPages<Lead>((start, end) =>
      supabase.from("leads").select("created_at, status, sale_value, source")
        .gte("created_at", `${ctx.period.from}T00:00:00`).lte("created_at", `${ctx.period.to}T23:59:59`)
        .order("id").range(start, end));
    return { data, error };
  });

  /** Si una fila entra con los filtros del panel (menos los que se pidan saltar). */
  const keep = (row: Dimensions, skip: ("month" | "rep" | "channel")[] = []) => {
    if (filters.company !== null && row.company_code !== filters.company) return false;
    if (!skip.includes("channel") && filters.channel !== null && channelLabel(row.series) !== filters.channel) return false;
    if (!skip.includes("rep") && filters.repKey !== null && ctx.repOf(row.company_code, row.rep_code).key !== filters.repKey) return false;
    if (!skip.includes("month") && filters.month !== null && row.month !== filters.month) return false;
    return true;
  };

  const lastMonthIndex = shownYear === ctx.today.getFullYear() ? ctx.today.getMonth() : 11;
  const monthKeys = Array.from({ length: lastMonthIndex + 1 }, (_, index) => `${shownYear}-${String(index + 1).padStart(2, "0")}`);
  const selectedMonthIndex = filters.month ? monthKeys.indexOf(filters.month) : -1;
  const periodName = filters.month ? monthName(filters.month) : String(shownYear);

  // ---- Ofertas ----
  const offerRows = (offers.data ?? []).filter((row) => keep(row));
  const offerCount = total(offerRows, "offers");
  const offerNet = total(offerRows, "net_amount");
  const converted = total(offerRows, "converted");
  const convertedNet = total(offerRows, "converted_amount");
  const timed = total(offerRows, "timed");
  const reasons = new Map<string, { count: number; amount: number }>();
  for (const row of offerRows) {
    if (!row.reject_reason || Number(row.rejected) === 0) continue;
    const entry = reasons.get(row.reject_reason) ?? { count: 0, amount: 0 };
    entry.count += Number(row.rejected);
    entry.amount += Number(row.rejected_amount);
    reasons.set(row.reject_reason, entry);
  }
  // Conversión por comercial: sin el filtro de comercial, para poder pulsar otro.
  const repOffers = new Map<string, { label: string; offers: number; net: number; converted: number; convertedNet: number; assigned: boolean }>();
  for (const row of (offers.data ?? []).filter((item) => keep(item, ["rep"]))) {
    const who = ctx.repOf(row.company_code, row.rep_code);
    const entry = repOffers.get(who.key) ?? { label: who.label, offers: 0, net: 0, converted: 0, convertedNet: 0, assigned: who.assigned };
    entry.offers += Number(row.offers);
    entry.net += Number(row.net_amount);
    entry.converted += Number(row.converted);
    entry.convertedNet += Number(row.converted_amount);
    repOffers.set(who.key, entry);
  }

  // ---- Pedidos ----
  const orderRows = (orders.data ?? []).filter((row) => keep(row));
  const orderCount = total(orderRows, "orders");
  const orderNet = total(orderRows, "net_amount");
  const fromOffer = orderRows.filter((row) => row.from_offer).reduce((sum, row) => sum + Number(row.orders), 0);
  const pendingNet = total(orderRows, "pending_amount");
  const pendingCount = total(orderRows, "pending_orders");
  const served = total(orderRows, "served");
  const withNeed = total(orderRows, "with_need");
  const late = total(orderRows, "late");
  const repBacklog = new Map<string, { label: string; amount: number; count: number; assigned: boolean }>();
  for (const row of (orders.data ?? []).filter((item) => keep(item, ["rep"]))) {
    if (Number(row.pending_amount) <= 0) continue;
    const who = ctx.repOf(row.company_code, row.rep_code);
    const entry = repBacklog.get(who.key) ?? { label: who.label, amount: 0, count: 0, assigned: who.assigned };
    entry.amount += Number(row.pending_amount);
    entry.count += Number(row.pending_orders);
    repBacklog.set(who.key, entry);
  }

  // ---- Lo de antes (sin serie, así que el canal no se puede aplicar) ----
  const oldRows = (oldOrders.data ?? []).filter((row) => keep({ ...row, series: "" }, ["channel"]));
  const oldTotals = {
    oferta: { net: oldRows.filter((row) => row.kind === "oferta").reduce((sum, row) => sum + Number(row.net_amount), 0), count: oldRows.filter((row) => row.kind === "oferta").reduce((sum, row) => sum + Number(row.documents), 0) },
    pedido: { net: oldRows.filter((row) => row.kind === "pedido").reduce((sum, row) => sum + Number(row.net_amount), 0), count: oldRows.filter((row) => row.kind === "pedido").reduce((sum, row) => sum + Number(row.documents), 0) },
  };

  // ---- Gráfico: ofertas y pedidos por mes (sin el filtro de mes, para poder pulsar otro) ----
  const byMonth = new Map<string, { ofertas: number; pedidos: number; convertidas: number }>();
  const add = (month: string, field: "ofertas" | "pedidos" | "convertidas", value: number) => {
    const entry = byMonth.get(month) ?? { ofertas: 0, pedidos: 0, convertidas: 0 };
    entry[field] += value;
    byMonth.set(month, entry);
  };
  if (ctx.detail.offers) {
    for (const row of (offers.data ?? []).filter((item) => keep(item, ["month"]))) {
      add(row.month, "ofertas", Number(row.net_amount));
      add(row.month, "convertidas", Number(row.converted_amount));
    }
  }
  if (ctx.detail.orders) {
    for (const row of (orders.data ?? []).filter((item) => keep(item, ["month"]))) add(row.month, "pedidos", Number(row.net_amount));
  }
  for (const row of (oldOrders.data ?? []).filter((item) => keep({ ...item, series: "" }, ["month", "channel"]))) {
    if (row.kind === "oferta" && !ctx.detail.offers) add(row.month, "ofertas", Number(row.net_amount));
    if (row.kind === "pedido" && !ctx.detail.orders) add(row.month, "pedidos", Number(row.net_amount));
  }
  const points = monthKeys.map((key, index) => ({
    label: monthNames[index],
    ofertas: Math.round(byMonth.get(key)?.ofertas ?? 0),
    convertidas: Math.round(byMonth.get(key)?.convertidas ?? 0),
    pedidos: Math.round(byMonth.get(key)?.pedidos ?? 0),
  }));

  // ---- Abonos e incidencias ----
  const incidentRows = (incidents.data ?? []).filter((row) => keep(row));
  const refunds = incidentRows.filter((row) => row.kind === "abono");
  const notes = incidentRows.filter((row) => row.kind === "incidencia");
  const reasonList = (list: IncidentStat[]) => {
    const map = new Map<string, { count: number; amount: number }>();
    for (const row of list) {
      const key = row.reason || "Sin motivo";
      const entry = map.get(key) ?? { count: 0, amount: 0 };
      entry.count += Number(row.documents);
      entry.amount += Math.abs(Number(row.net_amount));
      map.set(key, entry);
    }
    return [...map].sort((a, b) => b[1].amount - a[1].amount || b[1].count - a[1].count);
  };

  // ---- Cartera de la foto diaria (antes del detalle por pedido) ----
  const backlogSnapshot = totals.data ? snapshotTotal(totals.data.snapshots, "pedidos_pendientes", filters.company) : null;

  // ---- Leads de la web (Hub) ----
  const leadList = leads.data ?? [];
  const leadsWon = leadList.filter((lead) => lead.status === "won");
  const leadsOpen = leadList.filter((lead) => !["won", "lost", "invalid"].includes(lead.status));
  const leadValue = leadsWon.reduce((sum, lead) => sum + Number(lead.sale_value ?? 0), 0);
  const leadStatuses = new Map<LeadStatus, number>();
  for (const lead of leadList) leadStatuses.set(lead.status, (leadStatuses.get(lead.status) ?? 0) + 1);
  const leadSources = new Map<string, { count: number; won: number }>();
  for (const lead of leadList) {
    const key = lead.source?.trim() || "Sin origen";
    const entry = leadSources.get(key) ?? { count: 0, won: 0 };
    entry.count += 1;
    if (lead.status === "won") entry.won += 1;
    leadSources.set(key, entry);
  }

  const list = (type: "ofertas" | "pedidos", kind: string, title: string, description: string) =>
    ctx.openList({ type, kind, title, description } as Parameters<SalesContext["openList"]>[0]);

  return (
    <div className="page-stack">
      <section className="sales-section">
        <div className="sales-section-heading">
          <h2>Ofertas y pedidos de {periodName}</h2>
          <p>Pulsa una cifra para ver los documentos de Sage que hay detrás.</p>
        </div>
        <div className="kpi-grid kpi-grid-sales">
          {ctx.detail.offers ? (
            <>
              <KpiCard label="Ofertas" value={euros(offerNet)} helper={`${numberFormatter.format(offerCount)} ofertas`} delta="Sin comparación" icon={<DocumentIcon />} tone="indigo"
                onClick={() => list("ofertas", "todas", `Ofertas de ${periodName}`, "Todas las ofertas del periodo, de mayor a menor importe.")} actionLabel="Ver ofertas" />
              <KpiCard label="Conversión" value={share(converted, offerCount)} helper={`${numberFormatter.format(converted)} pasan a pedido · ${share(convertedNet, offerNet)} del importe`} delta="Sin comparación" icon={<ConversionIcon />} tone="emerald"
                onClick={() => list("ofertas", "convertidas", `Ofertas convertidas en ${periodName}`, "Ofertas que Sage enlaza con algún pedido.")} actionLabel="Ver convertidas" />
              <KpiCard label="Ofertas vivas" value={euros(total(offerRows, "open_amount"))} helper={`${numberFormatter.format(total(offerRows, "open_offers"))} por cerrar`} delta="Sin comparación" icon={<CalendarIcon />} tone="sky"
                onClick={() => list("ofertas", "vivas", `Ofertas vivas de ${periodName}`, "Sin pedido ni rechazo y todavía en plazo. Son las que hay que perseguir.")} actionLabel="Ver a quién llamar" />
              <KpiCard label="Rechazadas" value={numberFormatter.format(total(offerRows, "rejected"))} helper={`${euros(total(offerRows, "rejected_amount"))} perdidos`} delta="Sin comparación" icon={<XCircleIcon />} tone="rose"
                onClick={() => list("ofertas", "rechazadas", `Ofertas rechazadas en ${periodName}`, "Con motivo de rechazo o pérdida anotado en Sage.")} actionLabel="Ver motivos" />
              <KpiCard label="Caducadas sin respuesta" value={numberFormatter.format(total(offerRows, "expired"))} helper={`${euros(total(offerRows, "expired_amount"))} sin pedido ni rechazo`} delta="Sin comparación" icon={<ClockIcon />} tone="amber"
                onClick={() => list("ofertas", "caducadas", `Ofertas caducadas de ${periodName}`, "Pasó su validez sin pedido y sin motivo de rechazo: nadie sabe qué pasó.")} actionLabel="Ver lista" />
              <KpiCard label="De oferta a pedido" value={timed ? days(total(offerRows, "days_to_order") / timed) : "—"} helper="de media, en las convertidas" delta="Sin comparación" icon={<ClockIcon />} tone="sky" />
            </>
          ) : (
            <KpiCard label="Ofertas" value={euros(oldTotals.oferta.net)} helper={`${numberFormatter.format(oldTotals.oferta.count)} ofertas${filters.channel ? " · sin filtro de canal" : ""}`} delta="Sin comparación" icon={<DocumentIcon />} tone="indigo" />
          )}
          {ctx.detail.orders ? (
            <>
              <KpiCard label="Pedidos" value={euros(orderNet)} helper={`${numberFormatter.format(orderCount)} pedidos · ${share(fromOffer, orderCount)} desde oferta`} delta="Sin comparación" icon={<ConsultasIcon />} tone="indigo"
                onClick={() => list("pedidos", "todos", `Pedidos de ${periodName}`, "Todos los pedidos del periodo, de mayor a menor importe.")} actionLabel="Ver pedidos" />
              <KpiCard label="Pendiente de servir" value={euros(pendingNet)} helper={`${numberFormatter.format(pendingCount)} pedidos del periodo`} delta="Sin comparación" icon={<WalletIcon />} tone="amber"
                onClick={() => list("pedidos", "pendientes", `Pedidos de ${periodName} pendientes de servir`, "Lo que falta por servir de cada pedido.")} actionLabel="Ver pendientes" />
              <KpiCard label="Servidos tarde" value={share(late, withNeed)} helper={`${numberFormatter.format(late)} de ${numberFormatter.format(withNeed)} con fecha pedida`} delta="Sin comparación" icon={<ClockIcon />} tone={withNeed && late / withNeed > 0.15 ? "rose" : "emerald"}
                onClick={() => list("pedidos", "tarde", `Pedidos servidos tarde en ${periodName}`, "Servidos después de la fecha que pidió el cliente, o ya pasada y aún pendientes.")} actionLabel="Ver cuáles" />
              <KpiCard label="Plazo de servicio" value={served ? days(total(orderRows, "days_to_serve") / served) : "—"} helper="del pedido al primer albarán" delta="Sin comparación" icon={<CalendarIcon />} tone="sky" />
            </>
          ) : (
            <KpiCard label="Pedidos" value={euros(oldTotals.pedido.net)} helper={`${numberFormatter.format(oldTotals.pedido.count)} pedidos${filters.channel ? " · sin filtro de canal" : ""}`} delta="Sin comparación" icon={<ConsultasIcon />} tone="sky" />
          )}
          {!ctx.detail.orders && backlogSnapshot ? (
            <KpiCard label="Cartera por servir" value={euros(backlogSnapshot.amount)} helper={`${numberFormatter.format(backlogSnapshot.count)} pedidos de los últimos 12 meses`} delta="Sin comparación" icon={<WalletIcon />} tone="amber" />
          ) : null}
        </div>
        {!ctx.detail.offers || !ctx.detail.orders ? (
          <p className="sales-section-note">
            Conversión, ofertas vivas, motivos de rechazo, plazos de servicio y las listas de documentos se activan solos cuando el
            servidor de Sage mande las ofertas y los pedidos uno a uno. Mientras, se ven los totales.
          </p>
        ) : null}
      </section>

      {offers.failed || orders.failed || oldOrders.failed ? <LoadFailed what="parte de las ofertas y pedidos" /> : null}

      <section className="sales-board">
        <Panel
          title={`Ofertas y pedidos en ${shownYear}`}
          subtitle="Importe por mes, sin IVA. Pulsa un mes para filtrar"
          className="panel chart-panel sales-board-wide"
        >
          <TrendChart
            data={points}
            series={[
              { key: "ofertas", label: "Ofertas", color: "#6366f1" },
              ...(ctx.detail.offers ? [{ key: "convertidas", label: "Convertidas", color: "#f59e0b" }] : []),
              { key: "pedidos", label: "Pedidos", color: "#10b981" },
            ]}
            ariaLabel={`Ofertas y pedidos por mes en ${shownYear}`}
            onSelect={(index) => ctx.toggle("month", monthKeys[index] ?? null)}
            selectedIndex={selectedMonthIndex >= 0 ? selectedMonthIndex : null}
          />
        </Panel>

        <Panel title="Conversión por comercial" subtitle="Importe ofertado y qué parte pasa a pedido. Pulsa uno para filtrar" className="panel panel-padded sales-board-narrow">
          {ctx.detail.offers ? (
            <RankList
              items={[...repOffers].sort((a, b) => b[1].net - a[1].net).map(([key, rep]) => ({
                key,
                label: rep.label,
                value: rep.net,
                valueLabel: euros(rep.net),
                extra: share(rep.converted, rep.offers),
                muted: !rep.assigned || key === UNASSIGNED_KEY,
                title: `${rep.label}: ${numberFormatter.format(rep.offers)} ofertas, ${numberFormatter.format(rep.converted)} convertidas`,
              }))}
              activeKey={filters.repKey}
              onSelect={(key) => ctx.toggle("repKey", key)}
              empty="Sin ofertas en este periodo."
            />
          ) : <PendingDetail what="La conversión de cada comercial" />}
        </Panel>

        <Panel title="Por qué se pierden las ofertas" subtitle="Motivo de rechazo anotado en Sage" className="panel panel-padded sales-board-half">
          {ctx.detail.offers ? (
            reasons.size === 0 ? <p className="muted">Ninguna oferta rechazada con motivo en este periodo.</p> : (
              <RankList
                items={[...reasons].sort((a, b) => b[1].amount - a[1].amount).map(([reason, value]) => ({
                  key: reason, label: reason, value: value.amount, valueLabel: euros(value.amount), extra: numberFormatter.format(value.count),
                }))}
                limit={12}
              />
            )
          ) : <PendingDetail what="El motivo de cada oferta perdida" />}
        </Panel>

        <Panel title="Pendiente de servir por comercial" subtitle={ctx.detail.orders ? "Pedidos del periodo con algo por servir. Pulsa uno para filtrar" : "Foto de hoy: pedidos de los últimos 12 meses"} className="panel panel-padded sales-board-half">
          {ctx.detail.orders ? (
            <RankList
              items={[...repBacklog].sort((a, b) => b[1].amount - a[1].amount).map(([key, rep]) => ({
                key, label: rep.label, value: rep.amount, valueLabel: euros(rep.amount), extra: numberFormatter.format(rep.count), muted: !rep.assigned,
              }))}
              activeKey={filters.repKey}
              onSelect={(key) => ctx.toggle("repKey", key)}
              empty="No hay pedidos pendientes de servir."
            />
          ) : backlogSnapshot ? (
            <RankList
              items={(() => {
                const map = new Map<string, { label: string; amount: number; count: number; assigned: boolean }>();
                for (const row of backlogSnapshot.rows) {
                  const who = ctx.repOf(row.company_code, row.rep_code);
                  const entry = map.get(who.key) ?? { label: who.label, amount: 0, count: 0, assigned: who.assigned };
                  entry.amount += Number(row.amount);
                  entry.count += Number(row.count);
                  map.set(who.key, entry);
                }
                return [...map].sort((a, b) => b[1].amount - a[1].amount).map(([key, rep]) => ({
                  key, label: rep.label, value: rep.amount, valueLabel: euros(rep.amount), extra: numberFormatter.format(rep.count), muted: !rep.assigned,
                }));
              })()}
              activeKey={filters.repKey}
              onSelect={(key) => ctx.toggle("repKey", key)}
              empty="No hay pedidos pendientes de servir."
            />
          ) : <p className="muted">Todavía no hay foto de la cartera.</p>}
        </Panel>

        <Panel title="Abonos e incidencias" subtitle={`Devoluciones y notas de incidencia de los albaranes de ${periodName}`} className="panel panel-padded sales-board-full">
          {ctx.detail.incidents ? (
            <div className="sales-two-columns">
              <div>
                <h3 className="sales-subheading">Abonos · {euros(Math.abs(total(refunds, "net_amount")))} en {numberFormatter.format(total(refunds, "documents"))} documentos</h3>
                {refunds.length === 0 ? <p className="muted">Sin abonos en este periodo.</p> : (
                  <RankList items={reasonList(refunds).map(([reason, value]) => ({ key: reason, label: reason, value: value.amount, valueLabel: euros(value.amount), extra: numberFormatter.format(value.count) }))} limit={10} />
                )}
              </div>
              <div>
                <h3 className="sales-subheading">Incidencias · {numberFormatter.format(total(notes, "documents"))} albaranes</h3>
                {notes.length === 0 ? <p className="muted">Sin incidencias anotadas en este periodo.</p> : (
                  <RankList items={reasonList(notes).map(([reason, value]) => ({ key: reason, label: reason, value: value.count, valueLabel: numberFormatter.format(value.count), extra: "" }))} limit={10} />
                )}
              </div>
            </div>
          ) : <PendingDetail what="El detalle de abonos e incidencias por motivo" />}
        </Panel>

        {ctx.canSeeLeads ? (
          <Panel title={`Leads de la web en ${periodName}`} subtitle="Los que entran al Hub por la web y las campañas (no dependen de sociedad, canal ni comercial de Sage)" className="panel panel-padded sales-board-full">
            {leads.failed ? <LoadFailed what="los leads" /> : !leads.data ? <p className="muted">Cargando…</p> : (
              <div className="sales-leads">
                <div className="sales-inline-stats">
                  <span><LeadsIcon /> Recibidos <strong>{numberFormatter.format(leadList.length)}</strong></span>
                  <span>Ganados <strong>{numberFormatter.format(leadsWon.length)} · {share(leadsWon.length, leadList.length)}</strong></span>
                  <span>Abiertos <strong>{numberFormatter.format(leadsOpen.length)}</strong></span>
                  <span>Venta de los ganados <strong>{euros(leadValue)}</strong></span>
                  <a className="sales-link" href="/leads">Ir a Leads →</a>
                </div>
                <div className="sales-two-columns">
                  <div>
                    <h3 className="sales-subheading">Por estado</h3>
                    <RankList items={[...leadStatuses].sort((a, b) => b[1] - a[1]).map(([status, count]) => ({
                      key: status, label: leadStatusLabels[status] ?? status, value: count, valueLabel: numberFormatter.format(count), extra: share(count, leadList.length),
                    }))} empty="Ningún lead en este periodo." />
                  </div>
                  <div>
                    <h3 className="sales-subheading">Por origen</h3>
                    <RankList items={[...leadSources].sort((a, b) => b[1].count - a[1].count).map(([source, value]) => ({
                      key: source, label: source, value: value.count, valueLabel: numberFormatter.format(value.count), extra: value.count ? formatPercent((value.won / value.count) * 100) : "—",
                    }))} empty="Ningún lead en este periodo." limit={8} />
                  </div>
                </div>
              </div>
            )}
          </Panel>
        ) : null}
      </section>
    </div>
  );
}
