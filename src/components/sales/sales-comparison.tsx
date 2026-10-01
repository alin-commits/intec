"use client";

import { useMemo, useState, type ReactNode } from "react";
import { TrendChart } from "@/components/charts/trend-chart";
import { formatPercent, numberFormatter } from "@/lib/format";
import { bucketDiscount, euros, tenths, ticketFormatter, variation, yearlyView, type Bucket } from "@/lib/sales-model";
import type { SalesContext } from "./sales-context";
import { DataTable, Panel, type Column } from "./sales-ui";

/*
  Las piezas para comparar: un periodo contra otro con sus cifras lado a lado,
  qué comerciales, canales o sociedades explican la diferencia, y cuando se
  miran varios años, un año contra otro.
*/

const signedEuros = (value: number) => `${value >= 0 ? "+" : "-"}${euros(Math.abs(value))}`;
/**
 * Un cambio, en verde si sube (o en rojo, con `inverse`, para lo que es malo
 * que suba, como el descuento). Lo que no se mueve ni una décima va sin color.
 */
const changeCell = (value: number | null, unit: string, inverse = false): ReactNode => {
  if (value === null) return <span className="muted">—</span>;
  const rounded = tenths(value);
  const text = `${rounded > 0 ? "+" : ""}${rounded.toFixed(1).replace(".", ",")} ${unit}`;
  if (rounded === 0) return <span>{text}</span>;
  const good = inverse ? rounded < 0 : rounded > 0;
  return <span className={good ? "sales-up" : "sales-down"}>{text}</span>;
};
const percentChange = (value: number | null, inverse = false) => changeCell(value, "%", inverse);
/** En puntos, para porcentajes: el margen, el descuento. */
const pointsChange = (value: number | null, inverse = false) => changeCell(value, "pts", inverse);
const ticketOf = (bucket: Bucket) => (bucket.documents ? bucket.net / bucket.documents : 0);

/** Las cifras de los dos periodos, una al lado de la otra. */
export function VersusPanel({ ctx, className }: { ctx: SalesContext; className: string }) {
  const { model, period } = ctx;
  if (!period.compare) return null;
  const { current, previous, currentMargin, previousMargin, marginSpansMatch, currentDiscount, previousDiscount } = model;
  // El margen solo se compara cuando los dos periodos lo tienen en los mismos meses.
  const beforeMargin = marginSpansMatch ? previousMargin : null;
  const rows: { key: string; label: string; now: string; before: string; change: ReactNode }[] = [
    { key: "ventas", label: "Ventas", now: euros(current.net), before: euros(previous.net), change: percentChange(variation(current.net, previous.net)) },
    {
      key: "margen",
      label: "Margen",
      now: currentMargin ? euros(currentMargin.amount) : "—",
      before: beforeMargin ? euros(beforeMargin.amount) : "—",
      change: percentChange(currentMargin && beforeMargin ? variation(currentMargin.amount, beforeMargin.amount) : null),
    },
    {
      key: "margenp",
      label: "Margen %",
      now: currentMargin ? formatPercent(currentMargin.percent) : "—",
      before: beforeMargin ? formatPercent(beforeMargin.percent) : "—",
      change: pointsChange(currentMargin && beforeMargin ? currentMargin.percent - beforeMargin.percent : null),
    },
    {
      key: "dto",
      label: "Descuento medio",
      now: currentDiscount ? formatPercent(currentDiscount.percent) : "—",
      before: previousDiscount ? formatPercent(previousDiscount.percent) : "—",
      // Que el descuento suba es malo: va en rojo.
      change: pointsChange(currentDiscount && previousDiscount ? currentDiscount.percent - previousDiscount.percent : null, true),
    },
    { key: "albaranes", label: "Albaranes", now: numberFormatter.format(current.documents), before: numberFormatter.format(previous.documents), change: percentChange(variation(current.documents, previous.documents)) },
    { key: "ticket", label: "Ticket medio", now: ticketFormatter.format(ticketOf(current)), before: ticketFormatter.format(ticketOf(previous)), change: percentChange(variation(ticketOf(current), ticketOf(previous))) },
  ];
  return (
    <Panel title="Periodo contra periodo" subtitle={`${ctx.periodName.replace(/^./, (letter) => letter.toUpperCase())} ${ctx.comparisonHelper}, con los filtros puestos`} className={className}>
      <div className="table-scroll">
        <table className="sales-data-table sales-versus-table">
          <thead>
            <tr>
              <th className="is-text" />
              <th>{period.shortLabel}</th>
              <th>{period.compareShort}</th>
              <th>Cambio</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td className="is-text"><strong>{row.label}</strong></td>
                <td>{row.now}</td>
                <td className="muted">{row.before}</td>
                <td>{row.change}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

type DifferenceDimension = "rep" | "channel" | "company";
const dimensionLabels: Record<DifferenceDimension, string> = { rep: "Comerciales", channel: "Canales", company: "Sociedades" };
/** Cuántos se enseñan de cada lado: los que más suben y los que más bajan. */
const SIDE = 6;

/**
 * Qué explica la diferencia entre un periodo y otro: quién sube y quién baja,
 * en euros. Es lo primero que se pregunta cuando la venta cambia: ¿de dónde
 * viene? Pulsar uno filtra todo el panel por él.
 */
export function DifferencePanel({ ctx, className }: { ctx: SalesContext; className: string }) {
  const [dimension, setDimension] = useState<DifferenceDimension>("rep");
  const differences = ctx.model.differences;
  if (!differences || !ctx.period.compare) return null;
  const list = differences[dimension];
  const ups = list.filter((item) => item.change > 0).slice(0, SIDE);
  const downs = list.filter((item) => item.change < 0).slice(-SIDE);
  const shown = [...ups, ...downs];
  const max = Math.max(...shown.map((item) => Math.abs(item.change)), 1);
  const now = list.reduce((sum, item) => sum + item.now, 0);
  const before = list.reduce((sum, item) => sum + item.before, 0);
  const activeKey = dimension === "rep" ? ctx.filters.repKey : dimension === "channel" ? ctx.filters.channel : ctx.filters.company === null ? null : String(ctx.filters.company);
  const select = (key: string) => {
    if (dimension === "rep") ctx.toggle("repKey", key);
    else if (dimension === "channel") ctx.toggle("channel", key);
    else ctx.toggle("company", Number(key));
  };

  return (
    <Panel
      title="Qué explica la diferencia"
      subtitle={`Quién sube y quién baja ${ctx.comparisonHelper}. Pulsa uno para filtrar todo el panel`}
      trailing={(
        <div className="sales-switch" role="group" aria-label="Explicar la diferencia por">
          {(Object.keys(dimensionLabels) as DifferenceDimension[]).map((key) => (
            <button key={key} type="button" className={dimension === key ? "is-active" : undefined} onClick={() => setDimension(key)} aria-pressed={dimension === key}>
              {dimensionLabels[key]}
            </button>
          ))}
        </div>
      )}
      className={className}
    >
      <p className="sales-diff-summary">
        La venta pasa de <strong>{euros(before)}</strong> a <strong>{euros(now)}</strong>:{" "}
        <strong className={now >= before ? "sales-up" : "sales-down"}>{signedEuros(now - before)}</strong>
        {variation(now, before) !== null ? <> ({percentChange(variation(now, before))})</> : null}
      </p>
      {shown.length === 0 ? <p className="muted">Nadie sube ni baja: las cifras son las mismas.</p> : (
        <ol className="sales-diff">
          {shown.map((item) => {
            const width = `${Math.max(2, (Math.abs(item.change) / max) * 100)}%`;
            const active = activeKey === item.key;
            return (
              <li key={item.key}>
                <button
                  type="button"
                  className={`sales-diff-row${active ? " is-active" : ""}${item.muted ? " is-muted" : ""}`}
                  onClick={() => select(item.key)}
                  aria-pressed={active}
                  title={`${item.label}: ${euros(item.before)} → ${euros(item.now)}`}
                >
                  <span className="sales-diff-who">
                    <span className="sales-diff-name">{item.label}</span>
                    <small className="sales-diff-detail">{euros(item.before)} → {euros(item.now)}</small>
                  </span>
                  <span className="sales-diff-track" aria-hidden="true">
                    <span className="sales-diff-half is-down">{item.change < 0 ? <i style={{ width }} /> : null}</span>
                    <span className="sales-diff-half is-up">{item.change > 0 ? <i style={{ width }} /> : null}</span>
                  </span>
                  <strong className={`sales-diff-value ${item.change >= 0 ? "sales-up" : "sales-down"}`}>{signedEuros(item.change)}</strong>
                </button>
              </li>
            );
          })}
        </ol>
      )}
      {list.length > shown.length ? (
        <p className="sales-section-note">
          Salen los {ups.length} que más suben y los {downs.length} que más bajan, de {numberFormatter.format(list.length)}.
        </p>
      ) : null}
    </Panel>
  );
}

/**
 * Cuando se miran varios años: la venta de cada año mes a mes, una línea
 * encima de otra, y el total de cada año con lo que crece.
 */
export function YearsPanels({ ctx }: { ctx: SalesContext }) {
  const { period } = ctx;
  const view = useMemo(
    () => yearlyView({ rows: ctx.rows, filters: ctx.filters, repOf: ctx.repOf, months: period.months, basePartial: period.basePartial }),
    [ctx.rows, ctx.filters, ctx.repOf, period.months, period.basePartial],
  );
  // Con un año o menos no hay años que poner uno encima de otro.
  if (period.months.length <= 12 || view.years.length < 2) return null;

  type YearRow = (typeof view.table)[number];
  const lastYear = view.years[view.years.length - 1];
  const columns: Column<YearRow>[] = [
    { key: "anio", header: "Año", text: true, render: (row) => (
      <span className="sales-article">
        <strong>{row.year}</strong>
        {row.complete ? null : <small>{row.year === lastYear && period.basePartial ? "en curso" : `${row.months} ${row.months === 1 ? "mes" : "meses"}`}</small>}
      </span>
    ), sort: (row) => row.year },
    { key: "ventas", header: "Ventas", render: (row) => euros(row.bucket.net), sort: (row) => row.bucket.net },
    { key: "var", header: "Crece", render: (row) => (
      <span title={row.span ? `Solo ${row.span}, los meses cerrados que tienen los dos años` : undefined}>
        {percentChange(row.change)}{row.span && row.change !== null ? <small className="muted"> {row.span}</small> : null}
      </span>
    ), sort: (row) => row.change ?? -Infinity },
    { key: "dto", header: "Dto.", render: (row) => { const discount = bucketDiscount(row.bucket); return discount ? formatPercent(discount.percent) : <span className="muted">—</span>; }, sort: (row) => bucketDiscount(row.bucket)?.percent ?? -Infinity },
    { key: "docs", header: "Albaranes", optional: true, render: (row) => numberFormatter.format(row.bucket.documents), sort: (row) => row.bucket.documents },
    { key: "ticket", header: "Ticket", optional: true, render: (row) => ticketFormatter.format(ticketOf(row.bucket)), sort: (row) => ticketOf(row.bucket) },
  ];
  return (
    <>
      <Panel
        title="Año contra año"
        subtitle={`La venta de cada mes, una línea por año${ctx.filters.month ? " (sin el filtro de mes)" : ""}. Donde un año no tiene datos, su línea se corta`}
        className="panel chart-panel sales-board-half"
      >
        <TrendChart data={view.points} series={view.series} ariaLabel="Venta mensual de cada año, uno encima de otro" />
      </Panel>
      <Panel
        title="Venta por año"
        subtitle="Pulsa un año para verlo entero. «Crece» compara con el año anterior solo los meses cerrados que tienen los dos"
        className="panel table-panel sales-board-half"
      >
        <DataTable
          rows={[...view.table].reverse()}
          columns={columns}
          rowKey={(row) => String(row.year)}
          onRowClick={(row) => ctx.choosePeriod({ kind: "year", year: row.year })}
        />
      </Panel>
    </>
  );
}

