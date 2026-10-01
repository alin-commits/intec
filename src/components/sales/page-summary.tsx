"use client";

import { useState } from "react";
import { KpiCard } from "@/components/kpi-card";
import { TrendChart } from "@/components/charts/trend-chart";
import { DonutChart } from "@/components/charts/donut-chart";
import { CalendarIcon, ConsultasIcon, ConversionIcon, EuroIcon, TarjetasIcon, TrophyIcon, UsuariosIcon, WalletIcon, XCircleIcon } from "@/components/icons";
import { trustedNewCustomersFrom } from "@/lib/sage-panel";
import {
  bucketMargin,
  delta,
  emptyBucket,
  euros,
  filterRows,
  monthName,
  sumRows,
  targetsFor,
  targetToDate,
  tenths,
  ticketFormatter,
  UNASSIGNED_KEY,
  variation,
} from "@/lib/sales-model";
import { formatPercent, numberFormatter } from "@/lib/format";
import { lostCustomers, type SalesContext } from "./sales-context";
import { snapshotTotal, useCustomerCounts, useCustomerTotals } from "./sales-queries";
import { Panel, RankList } from "./sales-ui";
import { MarginNotices } from "./page-sales";
import { DifferencePanel, VersusPanel, YearsPanels } from "./sales-comparison";

/*
  Resumen: lo que Dirección tiene que ver de un vistazo. Cada cifra lleva a su
  detalle y cada gráfico filtra todo el panel al pulsarlo.
*/

export function SummaryPage({ ctx }: { ctx: SalesContext }) {
  const { model, filters, period, today } = ctx;
  const [chartMode, setChartMode] = useState<"mensual" | "acumulado">("mensual");
  const counts = useCustomerCounts(ctx);
  const totals = useCustomerTotals(ctx);

  const { current, previous, currentMargin, previousMargin, marginSpansMatch, monthly, currentDiscount, previousDiscount } = model;
  const marginDelta = currentMargin && previousMargin && marginSpansMatch;
  // Un descuento que sube es malo: la flecha va en verde cuando baja.
  const discountChange = currentDiscount && previousDiscount ? tenths(currentDiscount.percent - previousDiscount.percent) : null;
  const marginChange = marginDelta ? tenths(currentMargin.percent - previousMargin.percent) : null;
  const points = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(1).replace(".", ",")} pts`;
  const selectedMonthIndex = filters.month ? monthly.months.findIndex((month) => month.key === filters.month) : -1;

  // El objetivo se compara con la venta de su ámbito (sociedad y comercial), sin
  // el filtro de canal: los objetivos no se ponen por canal. Son por año natural,
  // así que con otro periodo no se enseñan.
  const targetYear = period.year;
  const monthIndex = filters.month ? Number(filters.month.slice(5, 7)) - 1 : null;
  const targetSoFar = targetYear !== null
    ? targetToDate(targetsFor(ctx.targets, targetYear, filters.company, filters.repKey), targetYear, today, monthIndex)
    : null;
  // Solo los meses que tienen objetivo: si falta el de marzo, su venta no cuenta.
  const targetReal = targetSoFar
    ? sumRows(filterRows(ctx.rows, filters, ctx.repOf, ["channel", "month"]).filter((row) => targetSoFar.months.includes(row.month))).net
    : 0;

  // Clientes: con el detalle nuevo de Sage, las cifras con nombre; sin él, los totales de antes.
  const customerFallback = (() => {
    if (ctx.detail.customers || !totals.data) return null;
    const inCompany = (row: { company_code: number }) => filters.company === null || row.company_code === filters.company;
    // El último mes cerrado del periodo: el que va por la mitad no dice nada.
    const closed = period.basePartial ? period.months.slice(0, -1) : period.months;
    const monthKey = filters.month ?? closed[closed.length - 1] ?? null;
    const trustedFrom = trustedNewCustomersFrom(totals.data.firstMonth);
    const rows = totals.data.monthly.filter((row) => inCompany(row) && monthKey !== null && row.month.startsWith(monthKey));
    const dormant = snapshotTotal(totals.data.snapshots, "clientes_dormidos", filters.company);
    return {
      monthKey,
      active: rows.length > 0 ? rows.reduce((sum, row) => sum + Number(row.active_customers), 0) : null,
      fresh: rows.length > 0 && trustedFrom !== null && monthKey !== null && monthKey >= trustedFrom
        ? rows.reduce((sum, row) => sum + Number(row.new_customers), 0)
        : null,
      dormant,
    };
  })();
  const backlog = totals.data ? snapshotTotal(totals.data.snapshots, "pedidos_pendientes", filters.company) : null;
  const periodName = ctx.periodName;
  const lost = lostCustomers(period);
  // El mes en curso contra los mismos días de su pareja: solo cuando se compara
  // con el año anterior, que es cuando lo cargado acaba el mismo día que hoy.
  const currentPair = period.compareKind === "year" ? model.monthly.currentMonth?.pair ?? null : null;

  return (
    <div className="page-stack">
      <section className="kpi-grid kpi-grid-sales">
        <KpiCard
          label={filters.month ? `Ventas de ${periodName}` : "Ventas"}
          value={euros(current.net)}
          helper={ctx.comparisonHelper}
          icon={<EuroIcon />}
          tone="indigo"
          onClick={() => ctx.goTo("ventas")}
          actionLabel="Ver detalle"
          {...delta(variation(current.net, previous.net))}
        />
        <KpiCard
          label="Margen"
          value={currentMargin ? euros(currentMargin.amount) : "No disponible"}
          helper={currentMargin && !model.marginCoversEverything ? "solo desde el cambio de series" : "en euros"}
          icon={<ConversionIcon />}
          tone={currentMargin ? "emerald" : "amber"}
          onClick={() => ctx.goTo("ventas")}
          actionLabel="Ver margen"
          {...(marginDelta ? delta(variation(currentMargin.amount, previousMargin.amount)) : { delta: "Sin comparación", positive: true })}
        />
        <KpiCard
          label="Margen %"
          value={currentMargin ? formatPercent(currentMargin.percent) : "—"}
          helper={currentMargin ? "sobre lo que tiene coste" : "el coste de las series antiguas no sirve"}
          icon={<ConversionIcon />}
          tone={currentMargin ? "emerald" : "amber"}
          delta={marginChange === null ? "Sin comparación" : points(marginChange)}
          positive={marginChange === null || marginChange >= 0}
        />
        <KpiCard
          label="Descuento medio"
          value={currentDiscount ? formatPercent(currentDiscount.percent) : "—"}
          helper={currentDiscount
            ? `sobre tarifa; ${formatPercent(currentDiscount.linePercent)} lo ponen los comerciales en la línea`
            : "llega con la próxima lectura de Sage"}
          icon={<TarjetasIcon />}
          tone={discountChange !== null && discountChange >= 1 ? "rose" : "sky"}
          onClick={() => ctx.goTo("ventas")}
          actionLabel="Ver por comercial"
          delta={discountChange === null ? "Sin comparación" : points(discountChange)}
          positive={discountChange === null || discountChange <= 0}
        />
        <KpiCard
          label="Albaranes"
          value={numberFormatter.format(current.documents)}
          helper={ctx.comparisonHelper}
          icon={<ConsultasIcon />}
          tone="sky"
          {...delta(variation(current.documents, previous.documents))}
        />
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
        {!filters.month && monthly.currentMonth ? (
          <KpiCard
            label={`Va de ${monthName(monthly.currentMonth.key)}`}
            value={euros(monthly.currentMonth.bucket.net)}
            helper={currentPair ? `frente a los mismos días de ${monthName(currentPair)} de ${currentPair.slice(0, 4)}` : "lo que llevamos de mes"}
            icon={<CalendarIcon />}
            tone="sky"
            onClick={() => ctx.setFilters({ month: monthly.currentMonth?.key ?? null })}
            actionLabel="Filtrar este mes"
            {...(currentPair ? delta(variation(monthly.currentMonth.bucket.net, monthly.currentMonth.beforeNet)) : { delta: "Sin comparación", positive: true })}
          />
        ) : null}
        {targetYear !== null ? (
          <KpiCard
            label="Objetivo"
            value={targetSoFar ? formatPercent((targetReal / Math.max(targetSoFar.target, 1)) * 100) : "Sin fijar"}
            helper={targetSoFar
              ? `${euros(targetReal)} de ${euros(targetSoFar.target)} a hoy${filters.channel ? " (sin filtro de canal)" : ""}`
              : "pon el objetivo de ventas en la página Objetivos"}
            icon={<TrophyIcon />}
            tone={targetSoFar ? (targetReal >= targetSoFar.target ? "emerald" : "rose") : "amber"}
            onClick={() => ctx.goTo("objetivos")}
            actionLabel={targetSoFar ? "Ver objetivos" : "Fijar objetivo"}
            {...(targetSoFar
              ? { delta: `${targetReal >= targetSoFar.target ? "+" : "-"}${euros(Math.abs(targetReal - targetSoFar.target))}`, positive: targetReal >= targetSoFar.target }
              : { delta: "Sin comparación", positive: true })}
          />
        ) : null}
      </section>

      <section className="sales-section">
        <div className="sales-section-heading">
          <h2>Clientes {filters.month ? `de ${periodName}` : `en ${periodName}`}</h2>
          <p>Pulsa una cifra para ver quiénes son, con su teléfono y lo que compran.</p>
        </div>
        <div className="kpi-grid kpi-grid-sales">
          {ctx.detail.customers ? (
            <>
              <KpiCard
                label="Con compra"
                value={counts.data ? numberFormatter.format(counts.data.activos) : "…"}
                helper={counts.data ? `${euros(counts.data.neto_activos)} de venta` : "cargando"}
                delta="Sin comparación"
                icon={<UsuariosIcon />}
                tone="sky"
                onClick={() => ctx.openList({ type: "clientes", kind: "activos", title: `Clientes con compra en ${periodName}`, description: "Todos los que han comprado en el periodo, de más a menos venta." })}
                actionLabel="Ver lista"
              />
              <KpiCard
                label="Nuevos"
                value={counts.data ? numberFormatter.format(counts.data.nuevos) : "…"}
                helper="primera compra de su vida"
                delta="Sin comparación"
                icon={<CalendarIcon />}
                tone="emerald"
                onClick={() => ctx.openList({ type: "clientes", kind: "nuevos", title: `Clientes nuevos en ${periodName}`, description: "Su primera compra de siempre cae en el periodo." })}
                actionLabel="Ver lista"
              />
              <KpiCard
                label="Recurrentes"
                value={counts.data ? share(counts.data.recurrentes, counts.data.activos) : "…"}
                helper={counts.data ? `${numberFormatter.format(counts.data.recurrentes)} ya compraban el año anterior` : "cargando"}
                delta="Sin comparación"
                icon={<ConversionIcon />}
                tone="indigo"
                onClick={() => ctx.openList({ type: "clientes", kind: "recurrentes", title: `Clientes recurrentes en ${periodName}`, description: "Compran en el periodo y también compraron en los 12 meses anteriores." })}
                actionLabel="Ver lista"
              />
              <KpiCard
                label="Han dejado de comprar"
                value={counts.data ? numberFormatter.format(counts.data.perdidos) : "…"}
                helper={counts.data ? `compraban ${euros(counts.data.neto_perdidos)} en ${lost.previous}; en ${lost.year}, nada` : "cargando"}
                delta="Sin comparación"
                icon={<XCircleIcon />}
                tone="rose"
                onClick={() => ctx.openList({ type: "clientes", kind: "perdidos", title: lost.title, description: lost.description })}
                actionLabel="Ver a quién llamar"
              />
              <KpiCard
                label="Más de 60 días sin comprar"
                value={counts.data ? numberFormatter.format(counts.data.sin_compra_60) : "…"}
                helper="habituales del último año"
                delta="Sin comparación"
                icon={<CalendarIcon />}
                tone="amber"
                onClick={() => ctx.openList({ type: "clientes", kind: "sin_compra", days: 60, title: "Clientes con más de 60 días sin comprar", description: "Clientes habituales del último año (compraron en 2 días o más) que no compran desde hace más de 60 días." })}
                actionLabel="Ver lista"
              />
            </>
          ) : (
            <>
              <KpiCard
                label={customerFallback?.monthKey ? `Clientes en ${monthName(customerFallback.monthKey)}` : "Clientes con compra"}
                value={customerFallback?.active !== null && customerFallback?.active !== undefined ? numberFormatter.format(customerFallback.active) : "—"}
                helper={filters.company === null ? "suma de sociedades" : "con alguna compra ese mes"}
                delta="Sin comparación"
                icon={<UsuariosIcon />}
                tone="sky"
                onClick={() => ctx.goTo("clientes")}
                actionLabel="Ver clientes"
              />
              <KpiCard
                label="Nuevos ese mes"
                value={customerFallback?.fresh !== null && customerFallback?.fresh !== undefined ? numberFormatter.format(customerFallback.fresh) : "—"}
                helper="primera compra"
                delta="Sin comparación"
                icon={<CalendarIcon />}
                tone="emerald"
                onClick={() => ctx.goTo("clientes")}
                actionLabel="Ver clientes"
              />
              <KpiCard
                label="Han dejado de comprar"
                value={customerFallback?.dormant ? numberFormatter.format(customerFallback.dormant.count) : "—"}
                helper={customerFallback?.dormant ? `compraban ${euros(customerFallback.dormant.amount)} al año` : "sin datos todavía"}
                delta="Sin comparación"
                icon={<XCircleIcon />}
                tone="rose"
                onClick={() => ctx.goTo("clientes")}
                actionLabel="Ver clientes"
              />
            </>
          )}
          {backlog ? (
            <KpiCard
              label="Cartera por servir"
              value={euros(backlog.amount)}
              helper={`${numberFormatter.format(backlog.count)} pedidos pendientes`}
              delta="Sin comparación"
              icon={<WalletIcon />}
              tone="amber"
              onClick={() => ctx.goTo("comercial")}
              actionLabel="Ver cartera"
            />
          ) : null}
        </div>
        {!ctx.detail.customers ? (
          <p className="sales-section-note">
            Las listas con nombre y teléfono se activan solas cuando el servidor de Sage mande el detalle de clientes.
          </p>
        ) : null}
      </section>

      <MarginNotices ctx={ctx} />

      <section className="sales-board">
        <article className="panel chart-panel sales-board-wide">
          <div className="panel-heading">
            <div>
              <h2>Evolución de {period.baseLabel}</h2>
              <p className="panel-subtitle">
                {chartMode === "acumulado"
                  ? `Lo que se lleva vendido a cada mes${monthly.marginComplete ? ", con el margen" : ""}`
                  : monthly.marginComplete ? "Ventas y margen por mes" : "Ventas por mes"}
                {monthly.hasBefore ? `, con ${period.baseCompareShort} detrás en gris` : ""}. Pulsa un mes para filtrar.
              </p>
            </div>
            <div className="sales-switch" role="group" aria-label="Cómo se mira la evolución">
              {(["mensual", "acumulado"] as const).map((mode) => (
                <button key={mode} type="button" className={chartMode === mode ? "is-active" : undefined} onClick={() => setChartMode(mode)} aria-pressed={chartMode === mode}>
                  {mode === "mensual" ? "Mes a mes" : "Acumulado"}
                </button>
              ))}
            </div>
          </div>
          <TrendChart
            data={chartMode === "acumulado" ? monthly.running : monthly.points}
            series={[
              ...(monthly.hasBefore ? [{ key: "anterior", label: period.baseCompareShort ?? "Comparado", color: "#cbd5e1" }] : []),
              { key: "ventas", label: "Ventas", color: "#4f46e5" },
              ...(monthly.marginComplete ? [{ key: "margen", label: "Margen", color: "#10b981" }] : []),
            ]}
            ariaLabel={`Evolución mensual de ventas de ${period.baseLabel}`}
            valueFormatter={euros}
            total={chartMode !== "acumulado"}
            onSelect={(index) => ctx.toggle("month", monthly.months[index]?.key ?? null)}
            selectedIndex={selectedMonthIndex >= 0 ? selectedMonthIndex : null}
          />
        </article>

        <article className="panel panel-padded sales-board-narrow">
          <div className="panel-heading">
            <div>
              <h2>Lo que hay que mirar</h2>
              <p className="panel-subtitle">Lo saca el panel solo. Pulsa un aviso para filtrar por lo que señala</p>
            </div>
          </div>
          {model.findings.length === 0 ? (
            <p className="muted">Nada que destacar en este periodo: ni caídas fuertes ni márgenes fuera de sitio.</p>
          ) : (
            <ul className="sales-findings">
              {model.findings.map((finding) => (
                <li key={finding.text}>
                  {finding.filter ? (
                    <button type="button" className={`sales-finding sales-finding-${finding.tone} is-clickable`} onClick={() => finding.filter && ctx.setFilters(finding.filter)}>
                      {finding.text}
                    </button>
                  ) : (
                    <div className={`sales-finding sales-finding-${finding.tone}`}>{finding.text}</div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </article>

        <YearsPanels ctx={ctx} />

        <VersusPanel ctx={ctx} className="panel table-panel sales-board-half" />
        <DifferencePanel ctx={ctx} className="panel panel-padded sales-board-half" />

        <Panel title="Ranking de comerciales" subtitle="Venta y margen. Pulsa uno para filtrar todo el panel" className="panel panel-padded sales-board-half">
          <RankList
            items={model.byRep.map((rep) => ({
              key: rep.key,
              label: rep.name,
              value: rep.bucket.net,
              valueLabel: euros(rep.bucket.net),
              extra: rep.margin ? formatPercent(rep.margin.percent) : "—",
              muted: !rep.assigned || rep.key === UNASSIGNED_KEY,
            }))}
            activeKey={filters.repKey}
            onSelect={(key) => ctx.toggle("repKey", key)}
          />
        </Panel>

        <ChannelPanel ctx={ctx} className="panel chart-panel sales-channel sales-board-quarter" />

        <CompanyTable ctx={ctx} />
      </section>
    </div>
  );
}

function share(part: number, total: number) {
  return total > 0 ? formatPercent((part / total) * 100) : "—";
}

/** Rosquilla y lista de canales, con su margen, que filtran al pulsar. */
export function ChannelPanel({ ctx, className }: { ctx: SalesContext; className: string }) {
  const { byChannel } = ctx.model;
  const active = ctx.filters.channel;
  return (
    <article className={className}>
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
        items={byChannel.items}
        centerLabel="ventas"
        ariaLabel="Reparto de las ventas por canal"
        emptyMessage="Sin datos en este periodo."
        showLegend={false}
        onSelect={(label) => byChannel.real.has(label) && ctx.toggle("channel", label)}
        selectedLabel={active}
      />
      <div className="sales-channel-head" aria-hidden="true">
        <span /><span>Canal</span><span>Ventas</span><span>Peso</span><span>Margen</span>
      </div>
      <ul className="sales-channel-list">
        {byChannel.items.map((item) => {
          const real = byChannel.real.has(item.label);
          const margin = bucketMargin(byChannel.buckets.get(item.label) ?? emptyBucket());
          const weight = byChannel.total > 0 ? (item.value / byChannel.total) * 100 : 0;
          const content = (
            <>
              <i style={{ background: item.color }} aria-hidden="true" />
              <span>{item.label}</span>
              <strong>{euros(item.value)}</strong>
              <em>{Math.round(weight)}%</em>
              <b>{margin ? formatPercent(margin.percent) : "—"}</b>
            </>
          );
          // "Otras N series" no es un canal, así que no se puede filtrar por él.
          return (
            <li key={item.label}>
              {real ? (
                <button type="button" className={`sales-channel-row${active === item.label ? " is-active" : ""}`} onClick={() => ctx.toggle("channel", item.label)} aria-pressed={active === item.label}>
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
  );
}

/** Las sociedades, que filtran al pulsar su fila. */
export function CompanyTable({ ctx }: { ctx: SalesContext }) {
  const { byCompany, companiesTotal, companiesMargin } = ctx.model;
  const active = ctx.filters.company;
  return (
    <article className="panel table-panel sales-board-third">
      <div className="panel-heading">
        <div>
          <h2>Por sociedad</h2>
          <p className="panel-subtitle">Con los demás filtros puestos. Pulsa una sociedad para filtrar</p>
        </div>
      </div>
      <div className="table-scroll">
        <table className="sales-compact-table sales-clickable-table">
          <thead><tr><th>Sociedad</th><th>Albaranes</th><th>Ventas</th><th>Margen €</th><th>Margen %</th></tr></thead>
          <tbody>
            {byCompany.map((company) => (
              <tr
                key={company.code}
                className={active === company.code ? "is-active" : undefined}
                onClick={() => ctx.toggle("company", company.code)}
              >
                <td>
                  <button type="button" className="sales-row-button" aria-pressed={active === company.code} onClick={(event) => { event.stopPropagation(); ctx.toggle("company", company.code); }}>
                    {company.name}
                  </button>
                </td>
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
                <td><strong>{numberFormatter.format(companiesTotal.documents)}</strong></td>
                <td><strong>{euros(companiesTotal.net)}</strong></td>
                <td>{companiesMargin ? <strong>{euros(companiesMargin.amount)}</strong> : <span className="muted">—</span>}</td>
                <td>{companiesMargin ? <strong>{formatPercent(companiesMargin.percent)}</strong> : <span className="muted">—</span>}</td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </article>
  );
}
