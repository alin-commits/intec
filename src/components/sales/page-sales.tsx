"use client";

import { TrendChart } from "@/components/charts/trend-chart";
import { formatPercent, numberFormatter } from "@/lib/format";
import {
  bucketDiscount,
  bucketMargin,
  channelLabel,
  emptyBucket,
  euros,
  filterRows,
  groupRows,
  mergeBucket,
  monthName,
  monthWithYear,
  pairOf,
  tenths,
  ticketFormatter,
  UNASSIGNED_KEY,
  variation,
  type Bucket,
  type SummaryRow,
} from "@/lib/sales-model";
import { addDays, dayCount } from "@/lib/sales-period";
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
  const raw = variation(now, before);
  if (raw === null) return <span className="muted">—</span>;
  // Sin "-0,0 %" en rojo: lo que no se mueve ni una décima va sin color.
  const value = tenths(raw);
  if (value === 0) return <span>0,0 %</span>;
  return <span className={value > 0 ? "sales-up" : "sales-down"}>{value > 0 ? "+" : ""}{value.toFixed(1).replace(".", ",")} %</span>;
};
const marginCell = (bucket: Bucket, kind: "amount" | "percent") => {
  const margin = bucketMargin(bucket);
  if (!margin) return <span className="muted">—</span>;
  return kind === "amount" ? euros(margin.amount) : formatPercent(margin.percent);
};
const ticket = (bucket: Bucket) => (bucket.documents ? ticketFormatter.format(bucket.net / bucket.documents) : "—");
/** Lo rebajado sobre tarifa; al pasar el ratón, cuánto de eso es descuento de línea (el del comercial). */
const discountCell = (bucket: Bucket) => {
  const discount = bucketDiscount(bucket);
  if (!discount) return <span className="muted">—</span>;
  return <span title={`${formatPercent(discount.linePercent)} en las líneas; el resto, descuento del cliente y pronto pago`}>{formatPercent(discount.percent)}</span>;
};
const discountSort = (bucket: Bucket) => bucketDiscount(bucket)?.percent ?? -Infinity;
const commissionCell = (bucket: Bucket) => (bucket.commission ? euros(bucket.commission) : <span className="muted">—</span>);

export function SalesMarginPage({ ctx }: { ctx: SalesContext }) {
  const { model, filters, period } = ctx;
  const pairMonth = pairOf(filters.month, period.monthOffset);
  /** Mes a mes se compara si hay algo cargado al lado, aunque el total no se pueda comparar. */
  const monthCompared = period.baseCompare !== null;

  // Canales con su venta del periodo con el que se compara, para la columna de variación.
  const channelNow = model.byChannel.buckets;
  const channelBefore = groupRows(filterRows(ctx.comparisonAvailable ? ctx.previousRows : [], filters, ctx.repOf, ["channel"], pairMonth), (row) => channelLabel(row.series));
  const channels = [...channelNow]
    .filter(([label]) => model.byChannel.real.has(label) || (channelNow.get(label)?.net ?? 0) !== 0)
    .map(([label, bucket]) => ({ label, bucket, before: channelBefore.get(label)?.net ?? 0 }));
  const versusHeader = `vs ${period.compareShort ?? ""}`;

  type MonthRow = (typeof model.monthly.months)[number];
  const monthColumns: Column<MonthRow>[] = [
    { key: "mes", header: "Mes", text: true, render: (row) => <span className="sales-capitalize">{period.multiYear ? monthWithYear(row.key) : monthName(row.key)}</span>, sort: (row) => row.key },
    { key: "ventas", header: "Ventas", render: (row) => euros(row.bucket.net), sort: (row) => row.bucket.net },
    ...(monthCompared ? [
      // Cada fila lleva al lado su pareja: con un año contra el anterior, la columna es ese año.
      { key: "antes", header: period.year !== null && period.compareKind === "year" ? String(period.year - 1) : period.baseCompareShort ?? "", optional: true, render: (row: MonthRow) => (row.beforeNet ? euros(row.beforeNet) : <span className="muted">—</span>), sort: (row: MonthRow) => row.beforeNet },
      { key: "var", header: "Variación", render: (row: MonthRow) => change(row.bucket.net, row.beforeNet), sort: (row: MonthRow) => variation(row.bucket.net, row.beforeNet) ?? -Infinity },
    ] : []),
    { key: "margen", header: "Margen €", optional: true, render: (row) => marginCell(row.bucket, "amount"), sort: (row) => row.margin?.amount ?? -Infinity },
    { key: "margenp", header: "Margen %", render: (row) => marginCell(row.bucket, "percent"), sort: (row) => row.margin?.percent ?? -Infinity },
    { key: "dto", header: "Dto.", render: (row) => discountCell(row.bucket), sort: (row) => discountSort(row.bucket) },
    { key: "docs", header: "Albaranes", optional: true, render: (row) => numberFormatter.format(row.bucket.documents), sort: (row) => row.bucket.documents },
    { key: "ticket", header: "Ticket", optional: true, render: (row) => ticket(row.bucket), sort: (row) => (row.bucket.documents ? row.bucket.net / row.bucket.documents : 0) },
  ];

  type RepRow = (typeof model.byRep)[number];
  const repColumns: Column<RepRow>[] = [
    { key: "nombre", header: "Comercial", text: true, render: (row) => <span className={row.key === UNASSIGNED_KEY ? "muted" : undefined}>{row.name}</span>, sort: (row) => row.name },
    { key: "ventas", header: "Ventas", render: (row) => euros(row.bucket.net), sort: (row) => row.bucket.net },
    ...(ctx.comparisonAvailable
      ? [{ key: "var", header: versusHeader, render: (row: RepRow) => change(row.bucket.net, row.beforeNet), sort: (row: RepRow) => variation(row.bucket.net, row.beforeNet) ?? -Infinity }]
      : []),
    { key: "margen", header: "Margen €", optional: true, render: (row) => marginCell(row.bucket, "amount"), sort: (row) => row.margin?.amount ?? -Infinity },
    { key: "margenp", header: "Margen %", render: (row) => marginCell(row.bucket, "percent"), sort: (row) => row.margin?.percent ?? -Infinity },
    { key: "dto", header: "Dto.", render: (row) => discountCell(row.bucket), sort: (row) => discountSort(row.bucket) },
    // En Sage pueden no usarse comisiones: entonces la columna no sale, en vez de una fila de ceros.
    ...(model.hasCommissions
      ? [{ key: "comision", header: "Comisión", optional: true, render: (row: RepRow) => commissionCell(row.bucket), sort: (row: RepRow) => row.bucket.commission }]
      : []),
    { key: "docs", header: "Albaranes", optional: true, render: (row) => numberFormatter.format(row.bucket.documents), sort: (row) => row.bucket.documents },
    { key: "ticket", header: "Ticket", optional: true, render: (row) => ticket(row.bucket), sort: (row) => (row.bucket.documents ? row.bucket.net / row.bucket.documents : 0) },
  ];

  type ChannelRow = (typeof channels)[number];
  const channelColumns: Column<ChannelRow>[] = [
    { key: "canal", header: "Canal", text: true, render: (row) => row.label, sort: (row) => row.label },
    { key: "ventas", header: "Ventas", render: (row) => euros(row.bucket.net), sort: (row) => row.bucket.net },
    ...(ctx.comparisonAvailable
      ? [{ key: "var", header: versusHeader, render: (row: ChannelRow) => change(row.bucket.net, row.before), sort: (row: ChannelRow) => variation(row.bucket.net, row.before) ?? -Infinity }]
      : []),
    { key: "margenp", header: "Margen %", render: (row) => marginCell(row.bucket, "percent"), sort: (row) => bucketMargin(row.bucket)?.percent ?? -Infinity },
    { key: "dto", header: "Dto.", render: (row) => discountCell(row.bucket), sort: (row) => discountSort(row.bucket) },
    { key: "docs", header: "Albaranes", optional: true, render: (row) => numberFormatter.format(row.bucket.documents), sort: (row) => row.bucket.documents },
    { key: "ticket", header: "Ticket", optional: true, render: (row) => ticket(row.bucket), sort: (row) => (row.bucket.documents ? row.bucket.net / row.bucket.documents : 0) },
  ];

  const monthTotal = model.monthly.months.reduce((total, month) => mergeBucket(total, month.bucket), emptyBucket());
  const monthBefore = model.monthly.months.reduce((sum, month) => sum + month.beforeNet, 0);

  return (
    <div className="page-stack">
      <MarginNotices ctx={ctx} />

      {filters.month ? <DailyPanel ctx={ctx} /> : null}

      <section className="sales-board">
        <Panel
          title={`Mes a mes en ${period.baseLabel}`}
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
                {monthCompared ? (
                  <>
                    <td className="is-optional">{monthBefore ? euros(monthBefore) : "—"}</td>
                    <td>{change(monthTotal.net, monthBefore)}</td>
                  </>
                ) : null}
                <td className="is-optional">{marginCell(monthTotal, "amount")}</td>
                <td>{marginCell(monthTotal, "percent")}</td>
                <td>{discountCell(monthTotal)}</td>
                <td className="is-optional">{numberFormatter.format(monthTotal.documents)}</td>
                <td className="is-optional">{ticket(monthTotal)}</td>
              </tr>
            ) : undefined}
          />
        </Panel>

        <Panel
          title="Comerciales"
          subtitle={`Venta, margen, descuento (Dto., rebaja sobre tarifa) y ticket de cada uno${filters.month ? ` en ${ctx.periodName}` : ""}. Pulsa uno para filtrar`}
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
          subtitle={`Venta y margen por canal${filters.month ? ` en ${ctx.periodName}` : ""}. Pulsa uno para filtrar`}
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

/**
 * La venta de un mes día a día y por semanas, contra su pareja en la
 * comparación: el mismo mes del año anterior, o el mes que le toca en el otro
 * periodo. Los días se emparejan por su posición: el primero con el primero.
 */
function DailyPanel({ ctx }: { ctx: SalesContext }) {
  const { filters, period } = ctx;
  const compare = period.compare;
  const key = JSON.stringify([ctx.basis, period.from, period.to, compare, ctx.reloadKey]);
  const daily = useSageQuery<{ now: SummaryRow[]; before: SummaryRow[] }>(key, async () => {
    const supabase = createClient();
    const load = (from: string, to: string) =>
      fetchAllPages<DailyRow>((start, end) =>
        supabase.from("sage_sales_daily")
          .select("day, company_code, series, rep_code, documents, net_amount, cost_amount, net_without_cost")
          .eq("basis", ctx.basis).gte("day", from).lte("day", to)
          .order("id").range(start, end));
    const [now, then] = await Promise.all([
      load(period.from, period.to),
      compare ? load(compare.from, compare.to) : Promise.resolve({ data: [] as DailyRow[], error: null }),
    ]);
    const error = now.error ?? then.error;
    // El día hace de "mes" para poder usar los mismos filtros y sumas.
    const asRows = (list: DailyRow[]) => list.map(({ day, ...rest }) => ({ ...rest, month: day }));
    return { data: error ? null : { now: asRows(now.data), before: asRows(then.data) }, error };
  });

  if (daily.failed) return <section className="panel panel-padded"><LoadFailed what="la venta día a día" /></section>;
  if (!daily.data) return <section className="panel panel-padded"><p className="muted">Cargando la venta día a día…</p></section>;

  const nowByDay = groupRows(filterRows(daily.data.now, filters, ctx.repOf, ["month"]), (row) => dayCount(period.from, row.month));
  const beforeByDay = compare
    ? groupRows(filterRows(daily.data.before, filters, ctx.repOf, ["month"]), (row) => dayCount(compare.from, row.month))
    : new Map<number, Bucket>();
  const length = dayCount(period.from, period.to);
  const days = Array.from({ length }, (_, index) => addDays(period.from, index));
  const points = days.map((day, index) => ({
    label: String(Number(day.slice(8, 10))),
    ventas: Math.round(nowByDay.get(index + 1)?.net ?? 0),
    anterior: Math.round(beforeByDay.get(index + 1)?.net ?? 0),
  }));

  // Semanas de lunes a domingo dentro del mes.
  const weeks: { start: number; end: number; net: number; before: number }[] = [];
  days.forEach((day, index) => {
    const number = Number(day.slice(8, 10));
    const weekday = new Date(`${day}T12:00:00`).getDay();
    if (index === 0 || weekday === 1) weeks.push({ start: number, end: number, net: 0, before: 0 });
    const week = weeks[weeks.length - 1];
    week.end = number;
    week.net += nowByDay.get(index + 1)?.net ?? 0;
    week.before += beforeByDay.get(index + 1)?.net ?? 0;
  });
  const sellingDays = points.filter((point) => point.ventas !== 0).length;
  const total = points.reduce((sum, point) => sum + point.ventas, 0);
  const best = points.reduce((top, point) => (point.ventas > top.ventas ? point : top), points[0] ?? { label: "—", ventas: 0, anterior: 0 });
  const weekMax = Math.max(...weeks.map((week) => Math.max(week.net, week.before)), 1);

  return (
    <section className="sales-board">
      <Panel
        title={`${ctx.periodName.replace(/^./, (letter) => letter.toUpperCase())} día a día`}
        subtitle={`${compare ? `Con ${period.compareShort} en gris` : "Sin comparar"}${period.partial ? ", hasta hoy" : ""}`}
        className="panel chart-panel sales-board-wide"
      >
        <TrendChart
          data={points}
          series={[
            ...(compare ? [{ key: "anterior", label: period.compareShort ?? "", color: "#cbd5e1" }] : []),
            { key: "ventas", label: "Ventas", color: "#4f46e5" },
          ]}
          ariaLabel={`Venta diaria de ${ctx.periodName}`}
          valueFormatter={euros}
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
