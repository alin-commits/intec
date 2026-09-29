"use client";

import { TrendChart } from "@/components/charts/trend-chart";
import { formatPercent, numberFormatter } from "@/lib/format";
import {
  bucketMargin,
  channelLabel,
  emptyBucket,
  euros,
  filterRows,
  groupRows,
  monthName,
  previousYearMonth,
  ticketFormatter,
  UNASSIGNED_KEY,
  variation,
  type Bucket,
  type SummaryRow,
} from "@/lib/sales-model";
import { createClient } from "@/lib/supabase/client";
import { fetchAllPages } from "@/lib/supabase/fetch-all";
import type { SalesContext } from "./sales-context";
import { DataTable, LoadFailed, Panel, useSageQuery, type Column } from "./sales-ui";

/*
  Ventas y margen: el detalle de lo que el resumen enseña en grande. Tablas que
  se ordenan pulsando la cabecera y filtran pulsando la fila, y, al elegir un
  mes, su venta día a día y por semanas.
*/

const change = (now: number, before: number) => {
  const value = variation(now, before);
  if (value === null) return <span className="muted">—</span>;
  return <span className={value >= 0 ? "sales-up" : "sales-down"}>{value >= 0 ? "+" : ""}{value.toFixed(1).replace(".", ",")} %</span>;
};
const marginCell = (bucket: Bucket, kind: "amount" | "percent") => {
  const margin = bucketMargin(bucket);
  if (!margin) return <span className="muted">—</span>;
  return kind === "amount" ? euros(margin.amount) : formatPercent(margin.percent);
};
const ticket = (bucket: Bucket) => (bucket.documents ? ticketFormatter.format(bucket.net / bucket.documents) : "—");

export function SalesMarginPage({ ctx }: { ctx: SalesContext }) {
  const { model, filters, shownYear } = ctx;
  const previousMonth = previousYearMonth(filters.month);

  // Canales con su venta del año anterior, para la columna de variación.
  const channelNow = model.byChannel.buckets;
  const channelBefore = groupRows(filterRows(ctx.previousRows, filters, ctx.repOf, ["channel"], previousMonth), (row) => channelLabel(row.series));
  const channels = [...channelNow]
    .filter(([label]) => model.byChannel.real.has(label) || (channelNow.get(label)?.net ?? 0) !== 0)
    .map(([label, bucket]) => ({ label, bucket, before: channelBefore.get(label)?.net ?? 0 }));

  type MonthRow = (typeof model.monthly.months)[number];
  const monthColumns: Column<MonthRow>[] = [
    { key: "mes", header: "Mes", text: true, render: (row) => <span className="sales-capitalize">{monthName(row.key)}</span>, sort: (row) => row.key },
    { key: "ventas", header: "Ventas", render: (row) => euros(row.bucket.net), sort: (row) => row.bucket.net },
    { key: "antes", header: String(shownYear - 1), optional: true, render: (row) => (row.beforeNet ? euros(row.beforeNet) : <span className="muted">—</span>), sort: (row) => row.beforeNet },
    { key: "var", header: "Variación", render: (row) => change(row.bucket.net, row.beforeNet), sort: (row) => variation(row.bucket.net, row.beforeNet) ?? -Infinity },
    { key: "margen", header: "Margen €", optional: true, render: (row) => marginCell(row.bucket, "amount"), sort: (row) => row.margin?.amount ?? -Infinity },
    { key: "margenp", header: "Margen %", render: (row) => marginCell(row.bucket, "percent"), sort: (row) => row.margin?.percent ?? -Infinity },
    { key: "docs", header: "Albaranes", optional: true, render: (row) => numberFormatter.format(row.bucket.documents), sort: (row) => row.bucket.documents },
    { key: "ticket", header: "Ticket", optional: true, render: (row) => ticket(row.bucket), sort: (row) => (row.bucket.documents ? row.bucket.net / row.bucket.documents : 0) },
  ];

  type RepRow = (typeof model.byRep)[number];
  const repColumns: Column<RepRow>[] = [
    { key: "nombre", header: "Comercial", text: true, render: (row) => <span className={row.key === UNASSIGNED_KEY ? "muted" : undefined}>{row.name}</span>, sort: (row) => row.name },
    { key: "ventas", header: "Ventas", render: (row) => euros(row.bucket.net), sort: (row) => row.bucket.net },
    { key: "var", header: `vs ${shownYear - 1}`, render: (row) => change(row.bucket.net, row.beforeNet), sort: (row) => variation(row.bucket.net, row.beforeNet) ?? -Infinity },
    { key: "margen", header: "Margen €", optional: true, render: (row) => marginCell(row.bucket, "amount"), sort: (row) => row.margin?.amount ?? -Infinity },
    { key: "margenp", header: "Margen %", render: (row) => marginCell(row.bucket, "percent"), sort: (row) => row.margin?.percent ?? -Infinity },
    { key: "docs", header: "Albaranes", optional: true, render: (row) => numberFormatter.format(row.bucket.documents), sort: (row) => row.bucket.documents },
    { key: "ticket", header: "Ticket", optional: true, render: (row) => ticket(row.bucket), sort: (row) => (row.bucket.documents ? row.bucket.net / row.bucket.documents : 0) },
  ];

  type ChannelRow = (typeof channels)[number];
  const channelColumns: Column<ChannelRow>[] = [
    { key: "canal", header: "Canal", text: true, render: (row) => row.label, sort: (row) => row.label },
    { key: "ventas", header: "Ventas", render: (row) => euros(row.bucket.net), sort: (row) => row.bucket.net },
    { key: "var", header: `vs ${shownYear - 1}`, render: (row) => change(row.bucket.net, row.before), sort: (row) => variation(row.bucket.net, row.before) ?? -Infinity },
    { key: "margenp", header: "Margen %", render: (row) => marginCell(row.bucket, "percent"), sort: (row) => bucketMargin(row.bucket)?.percent ?? -Infinity },
    { key: "docs", header: "Albaranes", optional: true, render: (row) => numberFormatter.format(row.bucket.documents), sort: (row) => row.bucket.documents },
    { key: "ticket", header: "Ticket", optional: true, render: (row) => ticket(row.bucket), sort: (row) => (row.bucket.documents ? row.bucket.net / row.bucket.documents : 0) },
  ];

  const monthTotal = model.monthly.months.reduce((total, month) => {
    total.net += month.bucket.net;
    total.documents += month.bucket.documents;
    total.costNet += month.bucket.costNet;
    total.cost += month.bucket.cost;
    total.withoutCost += month.bucket.withoutCost;
    return total;
  }, emptyBucket());
  const monthBefore = model.monthly.months.reduce((sum, month) => sum + month.beforeNet, 0);

  return (
    <div className="page-stack">
      <MarginNotices ctx={ctx} />

      {filters.month ? <DailyPanel ctx={ctx} /> : null}

      <section className="sales-board">
        <Panel
          title={`Mes a mes en ${shownYear}`}
          subtitle="Pulsa un mes para filtrar todo el panel; pulsa una cabecera para ordenar"
          className="panel table-panel sales-board-full"
        >
          <DataTable
            rows={model.monthly.months}
            columns={monthColumns}
            rowKey={(row) => row.key}
            activeKey={filters.month}
            onRowClick={(row) => ctx.toggle("month", row.key)}
            footer={model.monthly.months.length > 1 ? (
              <tr>
                <td className="is-text"><strong>Total</strong></td>
                <td><strong>{euros(monthTotal.net)}</strong></td>
                <td className="is-optional">{monthBefore ? euros(monthBefore) : "—"}</td>
                <td>{change(monthTotal.net, monthBefore)}</td>
                <td className="is-optional">{marginCell(monthTotal, "amount")}</td>
                <td>{marginCell(monthTotal, "percent")}</td>
                <td className="is-optional">{numberFormatter.format(monthTotal.documents)}</td>
                <td className="is-optional">{ticket(monthTotal)}</td>
              </tr>
            ) : undefined}
          />
        </Panel>

        <Panel
          title="Comerciales"
          subtitle={`Venta, margen y ticket de cada uno${filters.month ? ` en ${monthName(filters.month)}` : ""}. Pulsa uno para filtrar`}
          className="panel table-panel sales-board-half"
        >
          <DataTable
            rows={model.byRep}
            columns={repColumns}
            rowKey={(row) => row.key}
            activeKey={filters.repKey}
            onRowClick={(row) => ctx.toggle("repKey", row.key)}
            initialSort={{ key: "ventas", desc: true }}
            limit={15}
          />
        </Panel>

        <Panel
          title="Canales"
          subtitle={`Venta y margen por canal${filters.month ? ` en ${monthName(filters.month)}` : ""}. Pulsa uno para filtrar`}
          className="panel table-panel sales-board-half"
        >
          <DataTable
            rows={channels}
            columns={channelColumns}
            rowKey={(row) => row.label}
            activeKey={filters.channel}
            onRowClick={(row) => model.byChannel.real.has(row.label) && ctx.toggle("channel", row.label)}
            initialSort={{ key: "ventas", desc: true }}
          />
        </Panel>
      </section>
    </div>
  );
}

type DailyRow = Omit<SummaryRow, "month"> & { day: string };

/** La venta de un mes día a día y por semanas, contra el mismo mes del año anterior. */
function DailyPanel({ ctx }: { ctx: SalesContext }) {
  const { filters, shownYear } = ctx;
  const month = filters.month as string;
  const before = previousYearMonth(month) as string;
  const key = JSON.stringify([ctx.basis, month, ctx.reloadKey]);
  const daily = useSageQuery<{ now: SummaryRow[]; before: SummaryRow[] }>(key, async () => {
    const supabase = createClient();
    const load = (from: string, to: string) =>
      fetchAllPages<DailyRow>((start, end) =>
        supabase.from("sage_sales_daily")
          .select("day, company_code, series, rep_code, documents, net_amount, cost_amount, net_without_cost")
          .eq("basis", ctx.basis).gte("day", from).lte("day", to)
          .order("id").range(start, end));
    const [now, then] = await Promise.all([load(`${month}-01`, ctx.period.to), load(`${before}-01`, ctx.period.previousTo)]);
    const error = now.error ?? then.error;
    // El día hace de "mes" para poder usar los mismos filtros y sumas.
    const asRows = (list: DailyRow[]) => list.map(({ day, ...rest }) => ({ ...rest, month: day }));
    return { data: error ? null : { now: asRows(now.data), before: asRows(then.data) }, error };
  });

  if (daily.failed) return <section className="panel panel-padded"><LoadFailed what="la venta día a día" /></section>;
  if (!daily.data) return <section className="panel panel-padded"><p className="muted">Cargando la venta día a día…</p></section>;

  const nowByDay = groupRows(filterRows(daily.data.now, filters, ctx.repOf, ["month"]), (row) => Number(row.month.slice(8, 10)));
  const beforeByDay = groupRows(filterRows(daily.data.before, filters, ctx.repOf, ["month"]), (row) => Number(row.month.slice(8, 10)));
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = ctx.period.partial ? Number(ctx.period.to.slice(8, 10)) : new Date(year, monthNumber, 0).getDate();
  const points = Array.from({ length: lastDay }, (_, index) => ({
    label: String(index + 1),
    ventas: Math.round(nowByDay.get(index + 1)?.net ?? 0),
    anterior: Math.round(beforeByDay.get(index + 1)?.net ?? 0),
  }));

  // Semanas de lunes a domingo dentro del mes.
  const weeks: { start: number; end: number; net: number; before: number }[] = [];
  for (let day = 1; day <= lastDay; day += 1) {
    const weekday = new Date(year, monthNumber - 1, day).getDay();
    if (day === 1 || weekday === 1) weeks.push({ start: day, end: day, net: 0, before: 0 });
    const week = weeks[weeks.length - 1];
    week.end = day;
    week.net += nowByDay.get(day)?.net ?? 0;
    week.before += beforeByDay.get(day)?.net ?? 0;
  }
  const sellingDays = points.filter((point) => point.ventas !== 0).length;
  const total = points.reduce((sum, point) => sum + point.ventas, 0);
  const best = points.reduce((top, point) => (point.ventas > top.ventas ? point : top), points[0] ?? { label: "—", ventas: 0, anterior: 0 });
  const weekMax = Math.max(...weeks.map((week) => Math.max(week.net, week.before)), 1);

  return (
    <section className="sales-board">
      <Panel
        title={`${monthName(month).replace(/^./, (letter) => letter.toUpperCase())} día a día`}
        subtitle={`Con ${monthName(month)} de ${shownYear - 1} en gris${ctx.period.partial ? ", hasta hoy" : ""}`}
        className="panel chart-panel sales-board-wide"
      >
        <TrendChart
          data={points}
          series={[
            { key: "anterior", label: String(shownYear - 1), color: "#cbd5e1" },
            { key: "ventas", label: "Ventas", color: "#4f46e5" },
          ]}
          ariaLabel={`Venta diaria de ${monthName(month)} de ${shownYear}`}
        />
        <div className="sales-inline-stats">
          <span>Días con venta <strong>{sellingDays}</strong></span>
          <span>Media por día con venta <strong>{euros(sellingDays ? total / sellingDays : 0)}</strong></span>
          <span>Mejor día <strong>{best.ventas > 0 ? `${best.label} · ${euros(best.ventas)}` : "—"}</strong></span>
        </div>
      </Panel>
      <Panel title="Por semanas" subtitle="De lunes a domingo, dentro del mes" className="panel panel-padded sales-board-narrow">
        <ul className="sales-weeks">
          {weeks.map((week) => (
            <li key={week.start}>
              <span className="sales-weeks-label">{week.start === week.end ? `Día ${week.start}` : `Días ${week.start}–${week.end}`}</span>
              <span className="sales-weeks-bars" aria-hidden="true">
                <i style={{ width: `${Math.max(1, (Math.max(week.net, 0) / weekMax) * 100)}%` }} />
                <i className="is-before" style={{ width: `${Math.max(1, (Math.max(week.before, 0) / weekMax) * 100)}%` }} />
              </span>
              <strong>{euros(week.net)}</strong>
              <small>{change(week.net, week.before)}</small>
            </li>
          ))}
        </ul>
      </Panel>
    </section>
  );
}

/** Los avisos de por qué el margen no cubre todo: se repiten en Resumen y aquí. */
export function MarginNotices({ ctx }: { ctx: SalesContext }) {
  const { current, currentMargin, marginCoversEverything, netBeforeSeriesChange, withoutCostShare } = ctx.model;
  return (
    <>
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
              entonces sí es buena y está contada; el coste no, así que esa parte se queda fuera del margen.
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
    </>
  );
}
