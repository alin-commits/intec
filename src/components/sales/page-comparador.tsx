"use client";

import { BarChart } from "@/components/charts/bar-chart";
import { TrendChart, type TrendSeries } from "@/components/charts/trend-chart";
import { formatPercent, numberFormatter } from "@/lib/format";
import {
  type Bucket,
  addRow,
  bucketMargin,
  channelColors,
  channelLabel,
  emptyBucket,
  euros,
  filterRows,
  marcado,
  monthLabel,
  monthWithYear,
  pairOf,
  parejasDe,
  type SummaryRow,
  tenths,
  ticketFormatter,
  UNASSIGNED_KEY,
  variation,
} from "@/lib/sales-model";
import { createClient } from "@/lib/supabase/client";
import { fetchAllPages } from "@/lib/supabase/fetch-all";
import type { SalesContext } from "./sales-context";
import { DataTable, LoadFailed, Panel, useSageQuery, type Column } from "./sales-ui";

/*
  El comparador: lo marcado, uno contra otro.

  Las demás pantallas enseñan el total con los filtros puestos. Aquí no se
  suma: cada cosa marcada va por su lado, para poder decir "septiembre vendió
  esto y octubre esto otro", o "estos tres comerciales, uno al lado del otro".

  Dos decisiones que son las que lo hacen útil:

   · Solo sale lo marcado. Sin nada marcado no hay nada que comparar, y lo dice
     en vez de enseñar las veinte filas de siempre, que para eso están las
     otras pantallas.
   · Cada bloque respeta los demás filtros. Comparando comerciales con un canal
     marcado, se comparan en ese canal; el que se compara es el único que se
     suelta. Si no, las cifras de aquí no cuadrarían con las de al lado.

  Lo de familias va aparte porque Sage lo manda en otra tabla, mensual y sin
  comercial ni canal; se avisa debajo.
*/

/** Cuántos meses hacen falta para que una línea de evolución diga algo. */
const MESES_PARA_EVOLUCION = 2;

type Comparado = {
  clave: string;
  nombre: string;
  bucket: Bucket;
  antes: number;
  color: string;
};

const cambio = (ahora: number, antes: number) => {
  const valor = variation(ahora, antes);
  if (valor === null) return <span className="muted">—</span>;
  const redondo = tenths(valor);
  return <span className={redondo >= 0 ? "sales-up" : "sales-down"}>{redondo >= 0 ? "+" : ""}{redondo.toFixed(1).replace(".", ",")} %</span>;
};

const margenDe = (bucket: Bucket) => {
  const margen = bucketMargin(bucket);
  return margen === null ? <span className="muted">—</span> : formatPercent(margen.percent);
};

/** Las columnas son las mismas para todo lo que se compara. */
function columnas(total: number, conComparacion: boolean, queEs: string): Column<Comparado>[] {
  const lista: Column<Comparado>[] = [
    { key: "nombre", header: queEs, text: true, render: (fila) => <strong>{fila.nombre}</strong>, sort: (fila) => fila.nombre },
    { key: "ventas", header: "Ventas", render: (fila) => euros(fila.bucket.net), sort: (fila) => fila.bucket.net },
    { key: "peso", header: "% de lo marcado", render: (fila) => (total > 0 ? formatPercent((fila.bucket.net / total) * 100) : "—"), sort: (fila) => fila.bucket.net },
  ];
  if (conComparacion) {
    lista.push(
      { key: "antes", header: "Antes", render: (fila) => euros(fila.antes), sort: (fila) => fila.antes },
      { key: "variacion", header: "Variación", render: (fila) => cambio(fila.bucket.net, fila.antes), sort: (fila) => variation(fila.bucket.net, fila.antes) ?? -Infinity },
    );
  }
  lista.push(
    { key: "margen", header: "Margen %", render: (fila) => margenDe(fila.bucket), sort: (fila) => bucketMargin(fila.bucket)?.percent ?? -Infinity },
    { key: "albaranes", header: "Albaranes", render: (fila) => numberFormatter.format(fila.bucket.documents), sort: (fila) => fila.bucket.documents },
    { key: "ticket", header: "Ticket medio", render: (fila) => (fila.bucket.documents > 0 ? ticketFormatter.format(fila.bucket.net / fila.bucket.documents) : "—"), sort: (fila) => (fila.bucket.documents > 0 ? fila.bucket.net / fila.bucket.documents : -Infinity) },
  );
  return lista;
}

/** Un bloque: las barras, la tabla y, si hay meses de sobra, la evolución. */
function Bloque({
  titulo, queEs, filas, meses, evolucion, lineas, conComparacion, nota,
}: {
  titulo: string;
  queEs: string;
  filas: Comparado[];
  meses: string[];
  evolucion: Record<string, number | string | null>[] | null;
  /** Qué líneas lleva la evolución. Comparando meses es una sola: ellos son el eje. */
  lineas: TrendSeries[];
  conComparacion: boolean;
  nota?: string;
}) {
  const total = filas.reduce((suma, fila) => suma + fila.bucket.net, 0);
  if (filas.length === 0) return null;

  return (
    <section className="sales-board">
      <Panel
        title={titulo}
        subtitle={`${filas.length} ${filas.length === 1 ? "marcado" : "marcados"}${conComparacion ? ", con lo que vendió cada uno en el periodo anterior" : ""}`}
        className={evolucion && meses.length >= MESES_PARA_EVOLUCION ? "panel chart-panel sales-board-half" : "panel chart-panel sales-board-full"}
      >
        <BarChart
          items={filas.map((fila) => ({ label: fila.nombre, value: Math.round(fila.bucket.net), color: fila.color }))}
          ariaLabel={`Ventas de ${titulo.toLowerCase()}`}
          title={titulo}
          valueFormatter={euros}
        />
      </Panel>

      {evolucion && meses.length >= MESES_PARA_EVOLUCION ? (
        <Panel title={`${titulo}, mes a mes`} subtitle={lineas.length === 1 ? "En orden de mes, no de quién vende más" : "Cada uno por su lado, en orden"} className="panel chart-panel sales-board-half">
          <TrendChart
            data={evolucion}
            series={lineas}
            ariaLabel={`Evolución mensual de ${titulo.toLowerCase()}`}
            title={`${titulo}, mes a mes`}
            valueFormatter={euros}
          />
        </Panel>
      ) : null}

      {/* La tabla, a lo ancho: con ocho columnas en media pantalla no se lee. */}
      <Panel title="Las cifras" subtitle={nota ?? "Ordena pulsando la cabecera"} className="panel table-panel sales-board-full">
        <DataTable rows={filas} columns={columnas(total, conComparacion, queEs)} rowKey={(fila) => fila.clave} initialSort={{ key: "ventas", desc: true }} />
      </Panel>
    </section>
  );
}

type FamilyDay = { day: string; company_code: number; family_code: string; net_amount: number; cost_amount: number };

/** Las familias marcadas, que Sage manda en otra tabla. */
function Familias({ ctx }: { ctx: SalesContext }) {
  const { filters, period } = ctx;
  const familias = filters.families;
  const compare = period.compare;
  const clave = JSON.stringify(["comparador-familias", familias, period.from, period.to, compare, filters.companies, ctx.reloadKey]);

  const datos = useSageQuery<{ ahora: FamilyDay[]; antes: FamilyDay[] }>(familias.length > 0 ? clave : null, async () => {
    const supabase = createClient();
    const pedir = (desde: string, hasta: string) =>
      fetchAllPages<FamilyDay>((inicio, fin) => {
        let consulta = supabase.from("sage_family_sales_daily")
          .select("day, company_code, family_code, net_amount, cost_amount")
          .in("family_code", familias).gte("day", desde).lte("day", hasta);
        if (filters.companies.length > 0) consulta = consulta.in("company_code", filters.companies);
        return consulta.order("id").range(inicio, fin);
      });
    const [ahora, antes] = await Promise.all([
      pedir(period.from, period.to),
      compare ? pedir(compare.from, compare.to) : Promise.resolve({ data: [] as FamilyDay[], error: null }),
    ]);
    const error = ahora.error ?? antes.error;
    return { data: error ? null : { ahora: ahora.data ?? [], antes: antes.data ?? [] }, error };
  });

  if (familias.length === 0) return null;
  if (datos.failed) return <LoadFailed what="la venta por familia" />;
  const filasAhora = datos.data?.ahora ?? [];
  const filasAntes = datos.data?.antes ?? [];

  // Los meses marcados, cuando dejan huecos, hay que aplicarlos a mano: el
  // tramo de fechas que los abarca trae los del medio.
  const dentro = (dia: string) => marcado(period.selectedMonths, dia.slice(0, 7));
  const sumar = (lista: FamilyDay[], filtrar: boolean) => {
    const mapa = new Map<string, number>();
    for (const fila of lista) {
      if (filtrar && !dentro(fila.day)) continue;
      mapa.set(fila.family_code, (mapa.get(fila.family_code) ?? 0) + Number(fila.net_amount));
    }
    return mapa;
  };
  const ahora = sumar(filasAhora, true);
  const antes = sumar(filasAntes, false);

  const filas: Comparado[] = familias.map((code, indice) => {
    const bucket = emptyBucket();
    bucket.net = ahora.get(code) ?? 0;
    return { clave: code, nombre: ctx.familyName(code), bucket, antes: antes.get(code) ?? 0, color: channelColors[indice % channelColors.length] };
  });

  // Mes a mes de cada familia.
  const meses = [...new Set(filasAhora.map((fila) => fila.day.slice(0, 7)))].filter((mes) => marcado(period.selectedMonths, mes)).sort();
  const porMes = new Map<string, Map<string, number>>();
  for (const fila of filasAhora) {
    const mes = fila.day.slice(0, 7);
    if (!marcado(period.selectedMonths, mes)) continue;
    const suyo = porMes.get(mes) ?? new Map<string, number>();
    suyo.set(fila.family_code, (suyo.get(fila.family_code) ?? 0) + Number(fila.net_amount));
    porMes.set(mes, suyo);
  }
  const evolucion = meses.map((mes) => ({
    label: monthLabel(mes, period.multiYear),
    ...Object.fromEntries(familias.map((code) => [code, Math.round(porMes.get(mes)?.get(code) ?? 0)])),
  }));

  return (
    <Bloque
      titulo="Familias"
      queEs="Familia"
      filas={filas}
      meses={meses}
      evolucion={evolucion}
      lineas={filas.map((fila) => ({ key: fila.clave, label: fila.nombre, color: fila.color }))}
      conComparacion={compare !== null}
      nota="El reparto por familia que manda Sage no trae comercial ni canal: aquí solo cuentan la sociedad y las fechas"
    />
  );
}

export function ComparadorPage({ ctx }: { ctx: SalesContext }) {
  const { filters, period, repOf } = ctx;
  const pares = parejasDe(filters, period.monthOffset);
  const hayAlgoMarcado = filters.months.length > 0 || filters.companies.length > 0
    || filters.channels.length > 0 || filters.repKeys.length > 0 || filters.families.length > 0;

  /** El valor de una fila en la dimensión que se compara. */
  const valorDe = (fila: SummaryRow, dim: "month" | "company" | "channel" | "rep") => {
    if (dim === "month") return fila.month;
    if (dim === "company") return String(fila.company_code);
    if (dim === "channel") return channelLabel(fila.series);
    return repOf(fila.company_code, fila.rep_code).key;
  };

  /**
   * Lo marcado en una dimensión, cada uno con lo suyo.
   *
   * Se suelta esa dimensión del filtro —si no, comparar dos meses marcados
   * daría dos veces lo mismo— y se dejan puestas las demás.
   */
  const reparto = (
    dim: "month" | "company" | "channel" | "rep",
    marcados: string[],
    nombre: (clave: string) => string,
  ) => {
    const ahora = new Map<string, Bucket>();
    for (const fila of filterRows(ctx.rows, filters, repOf, [dim])) {
      const clave = valorDe(fila, dim);
      const bucket = ahora.get(clave) ?? emptyBucket();
      addRow(bucket, fila);
      ahora.set(clave, bucket);
    }
    const antes = new Map<string, number>();
    // Los meses se emparejan con el suyo del periodo anterior; lo demás, con
    // su mismo valor dentro de ese periodo.
    const filasAntes = dim === "month"
      ? filterRows(ctx.previousRows, filters, repOf, ["month"])
      : filterRows(ctx.previousRows, filters, repOf, [dim], pares.length > 0 ? pares : undefined);
    for (const fila of filasAntes) {
      const clave = valorDe(fila, dim);
      antes.set(clave, (antes.get(clave) ?? 0) + Number(fila.net_amount));
    }

    const filas: Comparado[] = marcados.map((clave, indice) => {
      const pareja = dim === "month" ? pairOf(clave, period.monthOffset) : clave;
      return {
        clave,
        nombre: nombre(clave),
        bucket: ahora.get(clave) ?? emptyBucket(),
        antes: pareja ? antes.get(pareja) ?? 0 : 0,
        color: channelColors[indice % channelColors.length],
      };
    });

    // Mes a mes de cada uno, en los meses que se miran.
    const meses = period.selectedMonths.length > 0 ? [...period.selectedMonths].sort() : period.months;
    const porMes = new Map<string, Map<string, number>>();
    for (const fila of filterRows(ctx.rows, filters, repOf, [dim])) {
      const suyo = porMes.get(fila.month) ?? new Map<string, number>();
      const clave = valorDe(fila, dim);
      suyo.set(clave, (suyo.get(clave) ?? 0) + Number(fila.net_amount));
      porMes.set(fila.month, suyo);
    }
    const evolucion: Record<string, number | string | null>[] = meses.map((mes) => ({
      label: monthLabel(mes, period.multiYear),
      ...(dim === "month"
        ? { ventas: Math.round(porMes.get(mes)?.get(mes) ?? 0) }
        : Object.fromEntries(marcados.map((clave) => [clave, Math.round(porMes.get(mes)?.get(clave) ?? 0)]))),
    }));
    /*
      Comparando meses, cada mes es un punto del eje: una línea por mes daría
      cuatro líneas que solo valen algo en su propio mes y cero en los demás,
      que es un dibujo sin sentido. Ahí va una sola línea que los recorre.
    */
    const lineas: TrendSeries[] = dim === "month"
      ? [{ key: "ventas", label: "Ventas", color: channelColors[0] }]
      : filas.map((fila) => ({ key: fila.clave, label: fila.nombre, color: fila.color }));

    return { filas, meses, evolucion, lineas };
  };

  const nombreDeSociedad = (code: string) => ctx.companies.find((item) => item.code === Number(code))?.name ?? `Sociedad ${code}`;
  const nombreDeComercial = (clave: string) => (clave === UNASSIGNED_KEY ? "Sin comercial asignado" : ctx.repName(clave));

  const bloques = [
    { dim: "month" as const, titulo: "Meses", queEs: "Mes", marcados: filters.months, nombre: monthWithYear },
    { dim: "company" as const, titulo: "Sociedades", queEs: "Sociedad", marcados: filters.companies.map(String), nombre: nombreDeSociedad },
    { dim: "channel" as const, titulo: "Canales", queEs: "Canal", marcados: filters.channels, nombre: (clave: string) => clave },
    { dim: "rep" as const, titulo: "Comerciales", queEs: "Comercial", marcados: filters.repKeys, nombre: nombreDeComercial },
  ].filter((bloque) => bloque.marcados.length > 0);

  return (
    <div className="page-stack">
      <section className="section-heading">
        <div>
          <span className="eyebrow">Comparador</span>
          <h2>Lo marcado, uno contra otro</h2>
          <p>
            Aquí no se suma: cada cosa que marcas arriba va por su lado, con lo que vendió, lo que vendió antes y
            cómo le ha ido mes a mes. Cada bloque respeta los demás filtros, así que comparando comerciales con un
            canal marcado se comparan dentro de ese canal.
          </p>
        </div>
      </section>

      {!hayAlgoMarcado ? (
        <section className="panel panel-padded">
          <h3>Todavía no has marcado nada</h3>
          <p className="muted">
            Marca arriba meses, sociedades, canales, comerciales o familias —puedes marcar de varios a la vez— y
            aquí salen uno al lado del otro. Para ver el total con los filtros puestos están las demás pestañas.
          </p>
        </section>
      ) : null}

      {bloques.map((bloque) => {
        const { filas, meses, evolucion, lineas } = reparto(bloque.dim, bloque.marcados, bloque.nombre);
        return (
          <Bloque
            key={bloque.dim}
            titulo={bloque.titulo}
            queEs={bloque.queEs}
            filas={filas}
            meses={meses}
            evolucion={evolucion}
            lineas={lineas}
            conComparacion={period.compare !== null}
          />
        );
      })}

      <Familias ctx={ctx} />
    </div>
  );
}
