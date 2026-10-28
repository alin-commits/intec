"use client";

import { TrendChart } from "@/components/charts/trend-chart";
import { formatPercent, numberFormatter } from "@/lib/format";
import { bucketDiscount, bucketMargin, channelLabel, euros, externasDelFiltro, externasPorMes, filterRows, groupRows, hayMesMarcado, monthName, monthWithYear, parejasDe, soloUnComercial, soloUnMes, soloUno, sumBuckets, targetsFor, ticketFormatter, type Bucket, type SummaryRow, UNASSIGNED_KEY, variation } from "@/lib/sales-model";
import { addDays, dayCount } from "@/lib/sales-period";
import { createClient } from "@/lib/supabase/client";
import { fetchAllPages } from "@/lib/supabase/fetch-all";
import type { SalesContext } from "./sales-context";
import { changeCell, DataTable, LoadFailed, Panel, useSageQuery, type Column } from "./sales-ui";

/*
  Ventas y margen: el detalle de lo que el resumen enseña en grande. Tablas que
  se ordenan pulsando la cabecera y filtran pulsando la fila, y, al elegir un
  mes, su venta día a día y por semanas.
*/

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
  const pairMonths = parejasDe(filters, period.selectionOffset);
  /** Mes a mes se compara si hay algo cargado al lado, aunque el total no se pueda comparar. */
  const monthCompared = period.baseCompare !== null;

  // Canales con su venta del periodo con el que se compara, para la columna de variación.
  const channelNow = model.byChannel.buckets;
  const channelBefore = groupRows(filterRows(ctx.comparisonAvailable ? ctx.previousRows : [], filters, ctx.repOf, ["channel"], pairMonths.length > 0 ? pairMonths : undefined), (row) => channelLabel(row.series));
  const channels = [...channelNow]
    .filter(([label]) => model.byChannel.real.has(label) || (channelNow.get(label)?.net ?? 0) !== 0)
    .map(([label, bucket]) => ({ label, bucket, before: channelBefore.get(label)?.net ?? 0 }));
  const versusHeader = `vs ${period.compareShort ?? ""}`;

  /*
    Lo que no pasó por Sage, mes a mes.

    Sin esto, una empresa que entró en Sage a mitad de camino dibuja ceros
    antes de entrar: Jender no tiene nada de enero a septiembre de 2025
    —entró el 6 de octubre— y esta tabla enseñaba nueve meses vacíos aunque
    el dinero estuviera facturado. Suma en la venta del mes y en la del año
    con el que se compara, cada una con la suya.
  */
  const fueraPorMes = externasPorMes(ctx.externalSales, filters, ctx.repOf);
  const fueraAntesPorMes = externasPorMes(ctx.previousExternalSales, filters, ctx.repOf);
  const hayDeFuera = fueraPorMes.size > 0 || fueraAntesPorMes.size > 0;
  const empresasDeFuera = [...new Set(externasDelFiltro(ctx.externalSales, filters, ctx.repOf).map((fila) => fila.source))];

  type MonthRow = (typeof model.monthly.months)[number];
  const ventaDelMes = (row: MonthRow) => row.bucket.net + (fueraPorMes.get(row.key) ?? 0);
  const ventaAnteriorDelMes = (row: MonthRow) => row.beforeNet + (row.pair ? fueraAntesPorMes.get(row.pair) ?? 0 : 0);

  /*
    El objetivo del mes y cómo se va respecto a él, en la misma columna.

    Se alimenta a mano desde Objetivos y respeta los filtros de sociedad y
    comercial, igual que en el resumen: sin nada marcado es el del grupo; con
    algo marcado, la suma de lo suyo. Un mes sin objetivo puesto se queda en
    raya, que es distinto de un objetivo de cero.
  */
  const objetivosDelAno = period.year !== null ? targetsFor(ctx.targets, period.year, filters.companies, filters.repKeys) : null;
  const objetivoDelMes = (row: MonthRow) => {
    if (!objetivosDelAno) return null;
    const mes = Number(row.key.slice(5, 7));
    return objetivosDelAno[mes - 1] ?? null;
  };
  const hayObjetivos = Boolean(objetivosDelAno?.some((valor) => valor !== null && valor > 0));
  /*
    Los totales de cada tabla se suman de sus propias filas y no del modelo:
    así la fila de Total es exactamente lo que hay encima, incluso cuando la
    tabla deja algo fuera. El margen y el descuento no se promedian, se
    recalculan sobre el bucket ya sumado.
  */
  const beforeOf = <T,>(rows: T[], pick: (row: T) => number) => rows.reduce((sum, row) => sum + pick(row), 0);
  const monthColumns: Column<MonthRow>[] = [
    { key: "mes", header: "Mes", text: true, render: (row) => <span className="sales-capitalize">{period.multiYear ? monthWithYear(row.key) : monthName(row.key)}</span>, sort: (row) => row.key },
    { key: "ventas", header: "Ventas", render: (row) => euros(ventaDelMes(row)), sort: (row) => ventaDelMes(row), total: (rows) => euros(rows.reduce((suma, row) => suma + ventaDelMes(row), 0)) },
    ...(monthCompared ? [
      // Cada fila lleva al lado su pareja: con un año contra el anterior, la columna es ese año.
      { key: "antes", header: period.year !== null && period.compareKind === "year" ? String(period.year - 1) : period.baseCompareShort ?? "", optional: true, render: (row: MonthRow) => (ventaAnteriorDelMes(row) ? euros(ventaAnteriorDelMes(row)) : <span className="muted">—</span>), sort: (row: MonthRow) => ventaAnteriorDelMes(row), total: (rows: MonthRow[]) => euros(beforeOf(rows, ventaAnteriorDelMes)) },
      { key: "var", header: "Variación", render: (row: MonthRow) => changeCell(ventaDelMes(row), ventaAnteriorDelMes(row)), sort: (row: MonthRow) => variation(ventaDelMes(row), ventaAnteriorDelMes(row)) ?? -Infinity, total: (rows: MonthRow[]) => changeCell(beforeOf(rows, ventaDelMes), beforeOf(rows, ventaAnteriorDelMes)) },
    ] : []),
    /*
      El objetivo del mes y cómo se va respecto a él, juntos en una columna:
      la cifra que se puso y debajo lo que falta o lo que sobra. Separados en
      dos columnas había que ir leyendo de una a otra para saber si un mes
      iba bien.

      La columna entera no sale si no hay ni un objetivo puesto en el año, en
      vez de una fila de rayas que no dice nada.
    */
    ...(hayObjetivos ? [{
      key: "objetivo",
      header: "Objetivo",
      render: (row: MonthRow) => {
        const objetivo = objetivoDelMes(row);
        if (objetivo === null || objetivo === 0) return <span className="muted">—</span>;
        return <>{euros(objetivo)}{changeCell(ventaDelMes(row), objetivo)}</>;
      },
      sort: (row: MonthRow) => {
        const objetivo = objetivoDelMes(row);
        return objetivo ? variation(ventaDelMes(row), objetivo) ?? -Infinity : -Infinity;
      },
      total: (rows: MonthRow[]) => {
        const objetivo = rows.reduce((suma, row) => suma + (objetivoDelMes(row) ?? 0), 0);
        if (objetivo === 0) return <span className="muted">—</span>;
        return <>{euros(objetivo)}{changeCell(beforeOf(rows, ventaDelMes), objetivo)}</>;
      },
    }] : []),
    { key: "margen", header: "Margen €", optional: true, render: (row) => marginCell(row.bucket, "amount"), sort: (row) => row.margin?.amount ?? -Infinity, total: (rows) => marginCell(sumBuckets(rows, (row) => row.bucket), "amount") },
    { key: "margenp", header: "Margen %", render: (row) => marginCell(row.bucket, "percent"), sort: (row) => row.margin?.percent ?? -Infinity, total: (rows) => marginCell(sumBuckets(rows, (row) => row.bucket), "percent") },
    { key: "dto", header: "Dto.", render: (row) => discountCell(row.bucket), sort: (row) => discountSort(row.bucket), total: (rows) => discountCell(sumBuckets(rows, (row) => row.bucket)) },
    { key: "docs", header: "Albaranes", optional: true, render: (row) => numberFormatter.format(row.bucket.documents), sort: (row) => row.bucket.documents, total: (rows) => numberFormatter.format(sumBuckets(rows, (row) => row.bucket).documents) },
    { key: "ticket", header: "Ticket", optional: true, render: (row) => ticket(row.bucket), sort: (row) => (row.bucket.documents ? row.bucket.net / row.bucket.documents : 0), total: (rows) => ticket(sumBuckets(rows, (row) => row.bucket)) },
  ];

  type RepRow = (typeof model.byRep)[number];
  const repColumns: Column<RepRow>[] = [
    { key: "nombre", header: "Comercial", text: true, render: (row) => <span className={row.key === UNASSIGNED_KEY ? "muted" : undefined}>{row.name}</span>, sort: (row) => row.name },
    { key: "ventas", header: "Ventas", render: (row) => euros(row.bucket.net), sort: (row) => row.bucket.net, total: (rows) => euros(sumBuckets(rows, (row) => row.bucket).net) },
    ...(ctx.comparisonAvailable
      ? [{ key: "var", header: versusHeader, render: (row: RepRow) => changeCell(row.bucket.net, row.beforeNet), sort: (row: RepRow) => variation(row.bucket.net, row.beforeNet) ?? -Infinity, total: (rows: RepRow[]) => changeCell(sumBuckets(rows, (row) => row.bucket).net, beforeOf(rows, (row) => row.beforeNet)) }]
      : []),
    { key: "margen", header: "Margen €", optional: true, render: (row) => marginCell(row.bucket, "amount"), sort: (row) => row.margin?.amount ?? -Infinity, total: (rows) => marginCell(sumBuckets(rows, (row) => row.bucket), "amount") },
    { key: "margenp", header: "Margen %", render: (row) => marginCell(row.bucket, "percent"), sort: (row) => row.margin?.percent ?? -Infinity, total: (rows) => marginCell(sumBuckets(rows, (row) => row.bucket), "percent") },
    { key: "dto", header: "Dto.", render: (row) => discountCell(row.bucket), sort: (row) => discountSort(row.bucket), total: (rows) => discountCell(sumBuckets(rows, (row) => row.bucket)) },
    // En Sage pueden no usarse comisiones: entonces la columna no sale, en vez de una fila de ceros.
    ...(model.hasCommissions
      ? [{ key: "comision", header: "Comisión", optional: true, render: (row: RepRow) => commissionCell(row.bucket), sort: (row: RepRow) => row.bucket.commission, total: (rows: RepRow[]) => commissionCell(sumBuckets(rows, (row) => row.bucket)) }]
      : []),
    { key: "docs", header: "Albaranes", optional: true, render: (row) => numberFormatter.format(row.bucket.documents), sort: (row) => row.bucket.documents, total: (rows) => numberFormatter.format(sumBuckets(rows, (row) => row.bucket).documents) },
    { key: "ticket", header: "Ticket", optional: true, render: (row) => ticket(row.bucket), sort: (row) => (row.bucket.documents ? row.bucket.net / row.bucket.documents : 0), total: (rows) => ticket(sumBuckets(rows, (row) => row.bucket)) },
  ];

  type ChannelRow = (typeof channels)[number];
  const channelColumns: Column<ChannelRow>[] = [
    { key: "canal", header: "Canal", text: true, render: (row) => row.label, sort: (row) => row.label },
    { key: "ventas", header: "Ventas", render: (row) => euros(row.bucket.net), sort: (row) => row.bucket.net, total: (rows) => euros(sumBuckets(rows, (row) => row.bucket).net) },
    ...(ctx.comparisonAvailable
      ? [{ key: "var", header: versusHeader, render: (row: ChannelRow) => changeCell(row.bucket.net, row.before), sort: (row: ChannelRow) => variation(row.bucket.net, row.before) ?? -Infinity, total: (rows: ChannelRow[]) => changeCell(sumBuckets(rows, (row) => row.bucket).net, beforeOf(rows, (row) => row.before)) }]
      : []),
    { key: "margenp", header: "Margen %", render: (row) => marginCell(row.bucket, "percent"), sort: (row) => bucketMargin(row.bucket)?.percent ?? -Infinity, total: (rows) => marginCell(sumBuckets(rows, (row) => row.bucket), "percent") },
    { key: "dto", header: "Dto.", render: (row) => discountCell(row.bucket), sort: (row) => discountSort(row.bucket), total: (rows) => discountCell(sumBuckets(rows, (row) => row.bucket)) },
    { key: "docs", header: "Albaranes", optional: true, render: (row) => numberFormatter.format(row.bucket.documents), sort: (row) => row.bucket.documents, total: (rows) => numberFormatter.format(sumBuckets(rows, (row) => row.bucket).documents) },
    { key: "ticket", header: "Ticket", optional: true, render: (row) => ticket(row.bucket), sort: (row) => (row.bucket.documents ? row.bucket.net / row.bucket.documents : 0), total: (rows) => ticket(sumBuckets(rows, (row) => row.bucket)) },
  ];

  return (
    <div className="page-stack">
      <MarginNotices ctx={ctx} />

      {soloUnMes(filters) ? <DailyPanel ctx={ctx} /> : null}

      <section className="sales-board">
        <Panel
          title={`Mes a mes en ${period.baseLabel}`}
          /*
            Esta tabla enseña todos los meses aunque haya unos marcados, para
            poder pulsar otro. Por eso su columna de comparación lleva las
            fechas del periodo entero y no las de lo marcado, que salen arriba:
            si no se dice, parece que una de las dos está mal.
          */
          subtitle={<>
            {hayMesMarcado(filters)
              ? `Salen todos los meses, no solo los marcados, para poder abrir otro. La columna compara con ${period.baseCompareShort ?? "el periodo anterior"}`
              : "Pulsa un mes para ver su ficha —quién vendió, qué familias, qué clientes—; pulsa una cabecera para ordenar"}
            {/* Si la venta de un mes lleva algo que no viene de Sage, se dice:
                cuando un número no cuadra manda Sage, y eso solo se sostiene
                sabiendo qué parte no es suya. */}
            {hayDeFuera && empresasDeFuera.length > 0
              ? `. La venta incluye lo de ${empresasDeFuera.join(" y ")}, que no pasa por Sage; el margen y el descuento son solo de Sage`
              : ""}
          </>}
          className="panel table-panel sales-board-full"
        >
          <DataTable
            rows={model.monthly.months}
            columns={monthColumns}
            rowKey={(row) => row.key}
            activeKey={soloUnMes(filters)}
            onRowClick={(row) => ctx.openMonth(row.key)}
          />
        </Panel>

        {/*
          Una encima de otra y no en dos columnas: la de comerciales lleva el
          nombre entero y ocho columnas más, y en media pantalla se cortaba por
          la derecha. A lo ancho caben todas, que es de lo que se trata.
        */}
        <Panel
          title="Comerciales"
          subtitle={`Venta, margen, descuento (Dto., rebaja sobre tarifa) y ticket de cada uno${hayMesMarcado(filters) ? ` en ${ctx.periodName}` : ""}. Pulsa uno para filtrar`}
          className="panel table-panel sales-board-full"
        >
          <DataTable
            rows={model.byRep}
            columns={repColumns}
            rowKey={(row) => row.key}
            activeKey={soloUnComercial(filters)}
            onRowClick={(row) => ctx.toggleRep(row.key)}
            initialSort={{ key: "ventas", desc: true }}
            limit={15}
          />
        </Panel>

        <Panel
          title="Canales"
          subtitle={`Venta y margen por canal${hayMesMarcado(filters) ? ` en ${ctx.periodName}` : ""}. Pulsa uno para filtrar`}
          className="panel table-panel sales-board-full"
        >
          <DataTable
            rows={channels}
            columns={channelColumns}
            rowKey={(row) => row.label}
            activeKey={soloUno(filters.channels)}
            onRowClick={(row) => model.byChannel.real.has(row.label) && ctx.toggleEnLista("channels", row.label)}
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
              <small>{changeCell(week.net, week.before)}</small>
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
