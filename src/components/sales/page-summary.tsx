"use client";

import { useState } from "react";
import { KpiCard } from "@/components/kpi-card";
import { TrendChart } from "@/components/charts/trend-chart";
import { DonutChart } from "@/components/charts/donut-chart";
import { ConversionIcon, EuroIcon, UsuariosIcon } from "@/components/icons";
import { trustedNewCustomersFrom } from "@/lib/sage-panel";
import { bucketMargin, delta, emptyBucket, euros, filterRows, hayMesMarcado, marcado, monthName, soloUnComercial, soloUnMes, soloUno, sumRows, targetsFor, targetToDate, tenths, ticketFormatter, UNASSIGNED_KEY, variation } from "@/lib/sales-model";
import { formatPercent, numberFormatter } from "@/lib/format";
import { Cifras, type Cifra } from "./cifras";
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
  const selectedMonthIndex = soloUnMes(filters) ? monthly.months.findIndex((month) => month.key === soloUnMes(filters)) : -1;

  // El objetivo se compara con la venta de su ámbito (sociedad y comercial), sin
  // el filtro de canal: los objetivos no se ponen por canal. Son por año natural,
  // así que con otro periodo no se enseñan.
  const targetYear = period.year;
  const unMes = soloUnMes(filters);
  const monthIndex = unMes ? Number(unMes.slice(5, 7)) - 1 : null;
  const targetSoFar = targetYear !== null
    ? targetToDate(targetsFor(ctx.targets, targetYear, filters.companies, filters.repKeys), targetYear, today, monthIndex)
    : null;
  // Solo los meses que tienen objetivo: si falta el de marzo, su venta no cuenta.
  const targetReal = targetSoFar
    ? sumRows(filterRows(ctx.rows, filters, ctx.repOf, ["channel", "month"]).filter((row) => targetSoFar.months.includes(row.month))).net
    : 0;

  // Clientes: con el detalle nuevo de Sage, las cifras con nombre; sin él, los totales de antes.
  const customerFallback = (() => {
    if (ctx.detail.customers || !totals.data) return null;
    const inCompany = (row: { company_code: number }) => marcado(filters.companies, row.company_code);
    // El último mes cerrado del periodo: el que va por la mitad no dice nada.
    const closed = period.basePartial ? period.months.slice(0, -1) : period.months;
    const monthKey = filters.months[filters.months.length - 1] ?? closed[closed.length - 1] ?? null;
    const trustedFrom = trustedNewCustomersFrom(totals.data.firstMonth);
    const rows = totals.data.monthly.filter((row) => inCompany(row) && monthKey !== null && row.month.startsWith(monthKey));
    const dormant = snapshotTotal(totals.data.snapshots, "clientes_dormidos", filters.companies);
    return {
      monthKey,
      active: rows.length > 0 ? rows.reduce((sum, row) => sum + Number(row.active_customers), 0) : null,
      fresh: rows.length > 0 && trustedFrom !== null && monthKey !== null && monthKey >= trustedFrom
        ? rows.reduce((sum, row) => sum + Number(row.new_customers), 0)
        : null,
      dormant,
    };
  })();
  const backlog = totals.data ? snapshotTotal(totals.data.snapshots, "pedidos_pendientes", filters.companies) : null;
  const periodName = ctx.periodName;
  const lost = lostCustomers(period);
  // El mes en curso contra los mismos días de su pareja: solo cuando se compara
  // con el año anterior, que es cuando lo cargado acaba el mismo día que hoy.
  const currentPair = period.compareKind === "year" ? model.monthly.currentMonth?.pair ?? null : null;

  /*
    El orden de la pantalla, que es lo que la hace legible:

      1. El gráfico de evolución, grande, con las cuatro cifras que mandan al
         lado y un minigráfico dentro de cada una.
      2. Lo que acompaña —albaranes, descuento, el mes en curso, el objetivo—
         en una tira: se lee igual y ocupa un tercio.
      3. Los clientes, en otra tira, con sus listas a un clic.
      4. Lo que hay que mirar, con el reparto por canal al lado.
      5. El detalle: ranking, qué explica la diferencia, periodo contra periodo
         y las sociedades.

    Antes esto empezaba con catorce tarjetas iguales y el gráfico aparecía a la
    altura de un pliegue y medio. Las cifras son las mismas; lo que cambia es
    en qué orden te las encuentras y cuánto sitio ocupa cada una.
  */
  const ticket = (bucket: { net: number; documents: number }) => (bucket.documents > 0 ? bucket.net / bucket.documents : 0);
  const porMes = monthly.months;
  const chispa = {
    ventas: porMes.map((mes) => Math.round(mes.bucket.net)),
    margen: porMes.map((mes) => Math.round(mes.margin?.amount ?? 0)),
    margenPorciento: porMes.map((mes) => Math.round(mes.margin?.percent ?? 0)),
    ticket: porMes.map((mes) => Math.round(ticket(mes.bucket))),
  };

  const acompañan: Cifra[] = [
    {
      key: "albaranes",
      etiqueta: "Albaranes",
      valor: numberFormatter.format(current.documents),
      nota: <>{delta(variation(current.documents, previous.documents)).delta} · {ctx.comparisonHelper}</>,
    },
    {
      key: "descuento",
      etiqueta: "Descuento medio",
      valor: currentDiscount ? formatPercent(currentDiscount.percent) : "—",
      nota: currentDiscount
        ? <>sobre tarifa; {formatPercent(currentDiscount.linePercent)} lo ponen los comerciales en la línea</>
        : "llega con la próxima lectura de Sage",
      tono: discountChange !== null && discountChange >= 1 ? "malo" : undefined,
      onClick: () => ctx.goTo("ventas"),
      accion: "Ver por comercial",
    },
    ...(!hayMesMarcado(filters) && monthly.currentMonth ? [{
      key: "mes",
      etiqueta: `Va de ${monthName(monthly.currentMonth.key)}`,
      valor: euros(monthly.currentMonth.bucket.net),
      nota: currentPair ? <>{delta(variation(monthly.currentMonth.bucket.net, monthly.currentMonth.beforeNet)).delta} frente a los mismos días de {monthName(currentPair)}</> : "lo que llevamos de mes",
      onClick: () => ctx.setFilters({ months: monthly.currentMonth ? [monthly.currentMonth.key] : [] }),
      accion: "Filtrar este mes",
    } as Cifra] : []),
    ...(targetYear !== null ? [{
      key: "objetivo",
      etiqueta: "Objetivo",
      valor: targetSoFar ? formatPercent((targetReal / Math.max(targetSoFar.target, 1)) * 100) : "Sin fijar",
      nota: targetSoFar
        ? <>{euros(targetReal)} de {euros(targetSoFar.target)} a hoy{filters.channels.length > 0 ? " (sin filtro de canal)" : ""}</>
        : "pon el objetivo en la página Objetivos",
      tono: targetSoFar ? (targetReal >= targetSoFar.target ? "bueno" : "malo") : undefined,
      onClick: () => ctx.goTo("objetivos"),
      accion: targetSoFar ? "Ver objetivos" : "Fijar objetivo",
    } as Cifra] : []),
  ];

  const deClientes: Cifra[] = ctx.detail.customers ? [
    {
      key: "activos", etiqueta: "Con compra",
      valor: counts.data ? numberFormatter.format(counts.data.activos) : "…",
      nota: counts.data ? `${euros(counts.data.neto_activos)} de venta` : "cargando",
      onClick: () => ctx.openList({ type: "clientes", kind: "activos", title: `Clientes con compra en ${periodName}`, description: "Todos los que han comprado en el periodo, de más a menos venta." }),
      accion: "Ver lista",
    },
    {
      key: "nuevos", etiqueta: "Nuevos",
      valor: counts.data ? numberFormatter.format(counts.data.nuevos) : "…",
      nota: "primera compra de su vida",
      onClick: () => ctx.openList({ type: "clientes", kind: "nuevos", title: `Clientes nuevos en ${periodName}`, description: "Su primera compra de siempre cae en el periodo." }),
      accion: "Ver lista",
    },
    {
      key: "recurrentes", etiqueta: "Recurrentes",
      valor: counts.data ? share(counts.data.recurrentes, counts.data.activos) : "…",
      nota: counts.data ? `${numberFormatter.format(counts.data.recurrentes)} ya compraban el año anterior` : "cargando",
      onClick: () => ctx.openList({ type: "clientes", kind: "recurrentes", title: `Clientes recurrentes en ${periodName}`, description: "Compran en el periodo y también compraron en los 12 meses anteriores." }),
      accion: "Ver lista",
    },
    {
      key: "perdidos", etiqueta: "Han dejado de comprar",
      valor: counts.data ? numberFormatter.format(counts.data.perdidos) : "…",
      nota: counts.data ? `compraban ${euros(counts.data.neto_perdidos)} en ${lost.previous}; en ${lost.year}, nada` : "cargando",
      tono: counts.data && counts.data.perdidos > 0 ? "malo" : undefined,
      onClick: () => ctx.openList({ type: "clientes", kind: "perdidos", title: lost.title, description: lost.description }),
      accion: "Ver a quién llamar",
    },
    {
      key: "sin60", etiqueta: "Más de 60 días sin comprar",
      valor: counts.data ? numberFormatter.format(counts.data.sin_compra_60) : "…",
      nota: "habituales del último año",
      onClick: () => ctx.openList({ type: "clientes", kind: "sin_compra", days: 60, title: "Clientes con más de 60 días sin comprar", description: "Clientes habituales del último año (compraron en 2 días o más) que no compran desde hace más de 60 días." }),
      accion: "Ver lista",
    },
  ] : [
    {
      key: "activos", etiqueta: customerFallback?.monthKey ? `Clientes en ${monthName(customerFallback.monthKey)}` : "Clientes con compra",
      valor: customerFallback?.active !== null && customerFallback?.active !== undefined ? numberFormatter.format(customerFallback.active) : "—",
      nota: filters.companies.length === 0 ? "suma de sociedades" : "con alguna compra ese mes",
      onClick: () => ctx.goTo("clientes"), accion: "Ver clientes",
    },
    {
      key: "nuevos", etiqueta: "Nuevos ese mes",
      valor: customerFallback?.fresh !== null && customerFallback?.fresh !== undefined ? numberFormatter.format(customerFallback.fresh) : "—",
      nota: "primera compra",
      onClick: () => ctx.goTo("clientes"), accion: "Ver clientes",
    },
    {
      key: "perdidos", etiqueta: "Han dejado de comprar",
      valor: customerFallback?.dormant ? numberFormatter.format(customerFallback.dormant.count) : "—",
      nota: customerFallback?.dormant ? `compraban ${euros(customerFallback.dormant.amount)} al año` : "sin datos todavía",
      onClick: () => ctx.goTo("clientes"), accion: "Ver clientes",
    },
  ];
  if (backlog) {
    deClientes.push({
      key: "cartera", etiqueta: "Cartera por servir",
      valor: euros(backlog.amount),
      nota: `${numberFormatter.format(backlog.count)} pedidos pendientes`,
      onClick: () => ctx.goTo("comercial"), accion: "Ver cartera",
    });
  }

  return (
    <div className="page-stack">
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
            onSelect={(index) => ctx.toggleMonth(monthly.months[index]?.key ?? null)}
            selectedIndex={selectedMonthIndex >= 0 ? selectedMonthIndex : null}
          />
        </article>

        <div className="kpi-grid-duo sales-board-narrow">
          <KpiCard
            label={hayMesMarcado(filters) ? `Ventas de ${periodName}` : "Ventas"}
            value={euros(current.net)}
            helper={ctx.comparisonHelper}
            icon={<EuroIcon />}
            tone="indigo"
            sparkline={chispa.ventas}
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
            sparkline={monthly.marginComplete ? chispa.margen : undefined}
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
            sparkline={monthly.marginComplete ? chispa.margenPorciento : undefined}
            delta={marginChange === null ? "Sin comparación" : points(marginChange)}
            positive={marginChange === null || marginChange >= 0}
          />
          <KpiCard
            label="Ticket medio"
            value={ticketFormatter.format(ticket(current))}
            helper="por albarán"
            icon={<UsuariosIcon />}
            tone="amber"
            sparkline={chispa.ticket}
            {...delta(variation(ticket(current), ticket(previous)))}
          />
        </div>

        <Cifras cifras={acompañan} />

        <Cifras
          titulo={`Clientes ${hayMesMarcado(filters) ? `de ${periodName}` : `en ${periodName}`}`}
          subtitulo="Pulsa una cifra para ver quiénes son, con su teléfono y lo que compran"
          cifras={deClientes}
        />
        {!ctx.detail.customers ? (
          <p className="sales-section-note sales-board-full">
            Las listas con nombre y teléfono se activan solas cuando el servidor de Sage mande el detalle de clientes.
          </p>
        ) : null}
      </section>

      <MarginNotices ctx={ctx} />

      <section className="sales-board">
        <article className="panel panel-padded sales-board-wide">
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

        <ChannelPanel ctx={ctx} className="panel chart-panel sales-channel sales-board-narrow" />

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
            activeKey={soloUnComercial(filters)}
            onSelect={(key) => ctx.toggleRep(key)}
          />
        </Panel>

        <DifferencePanel ctx={ctx} className="panel panel-padded sales-board-half" />

        <VersusPanel ctx={ctx} className="panel table-panel sales-board-half" />
        <CompanyTable ctx={ctx} className="panel table-panel sales-board-half" />

        <YearsPanels ctx={ctx} />
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
  const active = soloUno(ctx.filters.channels);
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
        onSelect={(label) => byChannel.real.has(label) && ctx.toggleEnLista("channels", label)}
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
                <button type="button" className={`sales-channel-row${active === item.label ? " is-active" : ""}`} onClick={() => ctx.toggleEnLista("channels", item.label)} aria-pressed={active === item.label}>
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
export function CompanyTable({ ctx, className = "panel table-panel sales-board-third" }: { ctx: SalesContext; className?: string }) {
  const { byCompany, companiesTotal, companiesMargin } = ctx.model;
  const active = soloUno(ctx.filters.companies);
  return (
    <article className={className}>
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
                onClick={() => ctx.toggleEnLista("companies", company.code)}
              >
                <td>
                  <button type="button" className="sales-row-button" aria-pressed={active === company.code} onClick={(event) => { event.stopPropagation(); ctx.toggleEnLista("companies", company.code); }}>
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
