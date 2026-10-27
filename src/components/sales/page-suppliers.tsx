"use client";

import { DonutChart } from "@/components/charts/donut-chart";
import { TrendChart } from "@/components/charts/trend-chart";
import { formatPercent, numberFormatter } from "@/lib/format";
import { familyMargin, partsOf, sumParts } from "@/lib/sage-panel";
import { channelColors, discountPercent, euros, monthLabel, pairOf, soloUnMes, soloUno, variation } from "@/lib/sales-model";
import { createClient } from "@/lib/supabase/client";
import type { SalesContext } from "./sales-context";
import { changeCell, DataTable, LoadFailed, Panel, PendingDetail, share, useSageQuery, type Column } from "./sales-ui";

/*
  Proveedores: cuánto se vende de lo de cada uno y si sube o baja.

  No es lo que les compramos —eso está en Compras— sino lo que sale por la
  puerta de lo suyo. Es la cifra con la que se va a una negociación anual:
  un proveedor puede estar creciendo en pedidos nuestros y cayendo en venta.

  La venta por artículo la manda Sage por mes, y cada artículo lleva su
  proveedor en la ficha; la base los junta. Pulsar un proveedor abre debajo
  sus artículos y su evolución, igual que una familia abre sus subfamilias.
*/

type SupplierRow = {
  supplier_code: string;
  supplier_name: string | null;
  articles: number;
  units: number;
  net_amount: number;
  trusted_net: number;
  trusted_cost: number;
  trusted_without_cost: number;
  gross_amount: number;
  gross_net: number;
};
type SupplierTableRow = SupplierRow & { name: string; before: number };

type SupplierArticle = {
  article_code: string; name: string | null; brand: string | null; family_code: string;
  units: number; documents: number; net_amount: number; trusted_net: number; trusted_cost: number;
  trusted_without_cost: number; gross_amount: number; gross_net: number;
};

const margin = (row: { trusted_net: number; trusted_cost: number; trusted_without_cost: number }) => {
  const value = familyMargin(row);
  return value === null ? <span className="muted">—</span> : formatPercent(value);
};
const discount = (row: { gross_amount: number; gross_net: number }) => {
  const value = discountPercent(row.gross_amount, row.gross_net);
  return value === null ? <span className="muted">—</span> : formatPercent(value);
};
const discountSort = (row: { gross_amount: number; gross_net: number }) => discountPercent(row.gross_amount, row.gross_net) ?? -Infinity;

/** Cómo se llama un proveedor cuando Sage no manda su ficha. */
const nombreDe = (row: SupplierRow) =>
  row.supplier_name?.trim() || (row.supplier_code ? `Proveedor ${row.supplier_code}` : "Sin proveedor");

export function SuppliersPage({ ctx }: { ctx: SalesContext }) {
  const { filters, period } = ctx;
  const reload = ctx.reloadKey;
  const compare = period.compare;
  const months = ctx.rpc.p_months;
  const compareMonths = ctx.rpcCompare.p_months;

  const conMeses = (lista: string[] | undefined) => (lista ? { p_months: lista } : {});
  const conSociedades = ctx.rpc.p_companies ? { p_companies: ctx.rpc.p_companies } : {};
  const conFamilias = ctx.rpc.p_families ? { p_families: ctx.rpc.p_families } : {};
  const conSubfamilias = ctx.rpc.p_subfamilies ? { p_subfamilies: ctx.rpc.p_subfamilies } : {};
  // Como en productos: va siempre, aunque sea nulo, para que no haya dos
  // versiones de la función entre las que PostgREST no sepa elegir.
  const conComerciales = { p_reps: ctx.rpc.p_reps ?? null };

  const args = { p_from: period.from, p_to: period.to, ...conSociedades, ...conFamilias, ...conSubfamilias, ...conMeses(months), ...conComerciales };
  const argsAntes = compare ? { ...args, p_from: compare.from, p_to: compare.to, ...conMeses(compareMonths) } : null;

  const proveedores = useSageQuery<SupplierTableRow[]>(
    ctx.detail.articles ? JSON.stringify(["proveedores", args, argsAntes, reload]) : null,
    async () => {
      const supabase = createClient();
      const [ahora, antes] = await Promise.all([
        supabase.rpc("sage_supplier_summary", args),
        argsAntes ? supabase.rpc("sage_supplier_summary", argsAntes) : Promise.resolve({ data: [], error: null }),
      ]);
      const error = ahora.error ?? antes.error;
      if (error) return { data: null, error };
      const deAntes = new Map(((antes.data ?? []) as SupplierRow[]).map((row) => [row.supplier_code, Number(row.net_amount)]));
      return {
        data: ((ahora.data ?? []) as SupplierRow[]).map((row) => ({
          ...row, name: nombreDe(row), before: deAntes.get(row.supplier_code) ?? 0,
        })),
        error: null,
      };
    },
  );

  /*
    Lo marcado manda sobre la tabla.

    Con uno marcado se abre su detalle debajo; con dos o más no hay detalle
    que abrir —serían dos tablas— pero la tabla sí se queda con ellos, que es
    lo que promete la etiqueta de arriba. Antes, con dos marcados, no pasaba
    absolutamente nada y la etiqueta seguía diciendo que el filtro estaba
    puesto.
  */
  const todasLasFilas = proveedores.data ?? [];
  const filas = filters.suppliers.length > 0
    ? todasLasFilas.filter((fila) => filters.suppliers.includes(fila.supplier_code))
    : todasLasFilas;
  const total = filas.reduce((suma, fila) => suma + Math.max(Number(fila.net_amount), 0), 0);
  const marcado = soloUno(filters.suppliers);
  /*
    Cómo se llama el marcado, aunque se haya caído de la tabla.

    Pasa al cambiar de periodo: el proveedor sigue marcado pero en ese tramo
    no vendió nada, así que no viene en las filas. Sin esto, el título pasaba
    a ser el código pelado y el detalle desaparecía sin decir por qué.
  */
  const nombreDelMarcado = marcado === null
    ? null
    : todasLasFilas.find((fila) => fila.supplier_code === marcado)?.name
      ?? `Proveedor ${marcado || "sin asignar"}`;
  const marcadoSinVenta = marcado !== null && !todasLasFilas.some((fila) => fila.supplier_code === marcado);

  // Los artículos y la evolución del proveedor marcado, que se abren debajo
  // de su fila. Solo se piden cuando hay uno: son dos consultas más.
  const articulos = useSageQuery<SupplierArticle[]>(
    marcado !== null ? JSON.stringify(["proveedor-articulos", marcado, args, reload]) : null,
    async () => await createClient().rpc("sage_supplier_articles", { p_supplier: marcado, ...args, p_limit: 50 }),
  );
  const spanFrom = period.baseCompare && period.baseCompare.from < period.base.from ? period.baseCompare.from : period.base.from;
  const spanTo = period.baseCompare && period.baseCompare.to > period.base.to ? period.baseCompare.to : period.base.to;
  const meses = useSageQuery<{ month: string; net_amount: number }[]>(
    marcado !== null ? JSON.stringify(["proveedor-meses", marcado, spanFrom, spanTo, ctx.rpc.p_reps, ctx.rpc.p_companies, conFamilias, conSubfamilias, reload]) : null,
    // Con la familia y la subfamilia marcadas, como la fila que tiene encima:
    // si no, el gráfico enseñaba la venta del proveedor entero debajo de una
    // fila que decía otra cosa.
    async () => await createClient().rpc("sage_supplier_months", {
      p_supplier: marcado, p_from: spanFrom, p_to: spanTo, ...conSociedades, ...conComerciales,
      ...conFamilias, ...conSubfamilias,
    }),
  );

  const sumaDe = (rows: SupplierTableRow[]) => sumParts(rows, (row) => ({
    net: Number(row.net_amount), units: Number(row.units),
    trusted_net: Number(row.trusted_net), trusted_cost: Number(row.trusted_cost),
    trusted_without_cost: Number(row.trusted_without_cost),
    gross_amount: Number(row.gross_amount), gross_net: Number(row.gross_net),
  }));

  const columnas: Column<SupplierTableRow>[] = [
    { key: "proveedor", header: "Proveedor", text: true, render: (row) => row.name, sort: (row) => row.name },
    { key: "ventas", header: "Ventas", render: (row) => euros(Number(row.net_amount)), sort: (row) => Number(row.net_amount), total: (rows) => euros(sumaDe(rows).net) },
    ...(compare
      ? [
        { key: "antes", header: period.compareShort ?? "Antes", render: (row: SupplierTableRow) => euros(row.before), sort: (row: SupplierTableRow) => row.before, total: (rows: SupplierTableRow[]) => euros(rows.reduce((suma, row) => suma + row.before, 0)) },
        { key: "var", header: `vs ${period.compareShort}`, render: (row: SupplierTableRow) => changeCell(Number(row.net_amount), row.before), sort: (row: SupplierTableRow) => variation(Number(row.net_amount), row.before) ?? -Infinity, total: (rows: SupplierTableRow[]) => changeCell(sumaDe(rows).net, rows.reduce((suma, row) => suma + row.before, 0)) },
      ]
      : []),
    { key: "peso", header: "Peso", optional: true, render: (row) => share(Math.max(Number(row.net_amount), 0), total), sort: (row) => Number(row.net_amount), total: () => share(total, total) },
    { key: "margen", header: "Margen %", render: (row) => margin(row), sort: (row) => familyMargin(row) ?? -Infinity, total: (rows) => margin(sumaDe(rows)) },
    { key: "dto", header: "Dto.", render: (row) => discount(row), sort: discountSort, total: (rows) => discount(sumaDe(rows)) },
    { key: "articulos", header: "Artículos", optional: true, render: (row) => numberFormatter.format(Number(row.articles)), sort: (row) => Number(row.articles), total: (rows) => numberFormatter.format(rows.reduce((suma, row) => suma + Number(row.articles), 0)) },
    { key: "unidades", header: "Unidades", optional: true, render: (row) => numberFormatter.format(Math.round(Number(row.units))), sort: (row) => Number(row.units), total: (rows) => numberFormatter.format(Math.round(sumaDe(rows).units)) },
  ];

  const articleColumns: Column<SupplierArticle>[] = [
    { key: "articulo", header: "Artículo", text: true, render: (row) => row.name || row.article_code, sort: (row) => row.name ?? row.article_code },
    { key: "codigo", header: "Código", text: true, optional: true, render: (row) => row.article_code, sort: (row) => row.article_code },
    { key: "marca", header: "Marca", text: true, optional: true, render: (row) => row.brand || "—", sort: (row) => row.brand ?? "" },
    { key: "ventas", header: "Ventas", render: (row) => euros(Number(row.net_amount)), sort: (row) => Number(row.net_amount), total: (rows) => euros(sumParts(rows, partsOf).net) },
    { key: "margen", header: "Margen %", render: (row) => margin(row), sort: (row) => familyMargin(row) ?? -Infinity, total: (rows) => margin(sumParts(rows, partsOf)) },
    { key: "unidades", header: "Unidades", optional: true, render: (row) => numberFormatter.format(Math.round(Number(row.units))), sort: (row) => Number(row.units), total: (rows) => numberFormatter.format(Math.round(sumParts(rows, partsOf).units)) },
  ];

  const mayores = [...filas].sort((a, b) => Number(b.net_amount) - Number(a.net_amount)).filter((row) => Number(row.net_amount) > 0);
  const donutItems = [
    ...mayores.slice(0, 8).map((row, indice) => ({ label: row.name, value: Math.round(Number(row.net_amount)), color: channelColors[indice % channelColors.length] })),
    ...(mayores.length > 8
      ? [{ label: `Otros ${mayores.length - 8} proveedores`, value: Math.round(mayores.slice(8).reduce((suma, row) => suma + Number(row.net_amount), 0)), color: "#cbd5e1" }]
      : []),
  ];
  const codigoPorNombre = new Map(mayores.map((row) => [row.name, row.supplier_code]));

  // La evolución del proveedor marcado, mes a mes del periodo que se mira.
  const monthKeys = period.months;
  const porMes = new Map<string, number>();
  for (const fila of meses.data ?? []) porMes.set(String(fila.month).slice(0, 7), Number(fila.net_amount));
  const puntos = monthKeys.map((clave) => {
    const pareja = pairOf(clave, period.monthOffset);
    return {
      label: monthLabel(clave, period.multiYear),
      ventas: Math.round(porMes.get(clave) ?? 0),
      anterior: pareja ? Math.round(porMes.get(pareja) ?? 0) : 0,
    };
  });
  const mesMarcado = soloUnMes(filters) ? monthKeys.indexOf(soloUnMes(filters)!) : -1;

  const detalle = marcado === null ? null : (
    <div className="sales-row-detail-inner">
      <p className="sales-row-detail-title">
        Lo más vendido de {nombreDelMarcado}
        {/* Sigue marcado pero en este tramo no vendió: sin esto, el detalle
            salía vacío y parecía que algo no había cargado. */}
        {marcadoSinVenta ? " · sin venta en este periodo" : ""}
        {/* El Total de esta tabla no puede llegar al de la fila del proveedor:
            son los 50 que más venden, no todos. Decirlo donde se lee. */}
        {(articulos.data ?? []).length >= 50 ? " · los 50 que más venden, así que su Total no llega al de la fila" : ""}
        {" · pulsa otra vez para cerrar"}
      </p>
      {articulos.failed ? <LoadFailed what="los artículos del proveedor" /> : (
        <DataTable
          rows={articulos.data ?? []}
          columns={articleColumns}
          rowKey={(row) => `${row.article_code}-${row.family_code}`}
          initialSort={{ key: "ventas", desc: true }}
          limit={12}
          empty={articulos.loading ? "Cargando…" : "Sin artículos vendidos de este proveedor."}
        />
      )}
    </div>
  );

  if (!ctx.detail.articles) {
    return (
      <div className="page-stack">
        <PendingDetail what="La venta por proveedor" />
      </div>
    );
  }

  return (
    <div className="page-stack">
      {proveedores.failed ? <LoadFailed what="la venta por proveedor" /> : null}

      <section className="sales-board">
        {marcado !== null ? (
          <Panel
            title={`${nombreDelMarcado} mes a mes`}
            subtitle={`${period.baseCompare ? `Con ${period.baseCompareShort} en gris. ` : ""}Pulsa un mes para filtrar`}
            className="panel chart-panel sales-board-full"
          >
            <TrendChart
              data={puntos}
              series={[
                ...(period.baseCompare ? [{ key: "anterior", label: period.baseCompareShort ?? "", color: "#cbd5e1" }] : []),
                { key: "ventas", label: "Ventas", color: "#4f46e5" },
              ]}
              ariaLabel={`Venta mensual del proveedor ${nombreDelMarcado}`}
              valueFormatter={euros}
              onSelect={(indice) => ctx.toggleMonth(monthKeys[indice] ?? null)}
              selectedIndex={mesMarcado >= 0 ? mesMarcado : null}
            />
          </Panel>
        ) : (
          <Panel title="Peso de cada proveedor" subtitle="Pulsa uno para ver lo suyo" className="panel chart-panel sales-channel sales-board-full">
            <DonutChart
              items={donutItems}
              centerLabel="ventas"
              ariaLabel="Reparto de la venta por proveedor"
              valueFormatter={(valor) => euros(valor)}
              onSelect={(etiqueta) => {
                const codigo = codigoPorNombre.get(etiqueta);
                if (codigo !== undefined) ctx.toggleEnLista("suppliers", codigo);
              }}
              selectedLabel={null}
            />
          </Panel>
        )}

        <Panel
          title={`Proveedores en ${ctx.periodName}`}
          subtitle="Lo que se ha vendido de cada uno, no lo que se le ha comprado. Pulsa uno para ver sus artículos"
          className="panel table-panel sales-board-full"
        >
          <DataTable
            rows={filas}
            columns={columnas}
            rowKey={(row) => row.supplier_code}
            activeKey={marcado}
            onRowClick={(row) => ctx.toggleEnLista("suppliers", row.supplier_code)}
            expand={(row) => (row.supplier_code === marcado ? detalle : null)}
            initialSort={{ key: "ventas", desc: true }}
            limit={25}
            empty={proveedores.loading ? "Cargando…" : "Sin venta por proveedor en este periodo."}
          />
        </Panel>
      </section>
    </div>
  );
}
