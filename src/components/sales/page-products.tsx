"use client";

import { useState } from "react";
import { DonutChart } from "@/components/charts/donut-chart";
import { TrendChart } from "@/components/charts/trend-chart";
import { formatPercent, numberFormatter } from "@/lib/format";
import { familyMargin } from "@/lib/sage-panel";
import { channelColors, discountPercent, euros, monthLabel, pairOf, tenths, variation } from "@/lib/sales-model";
import { createClient } from "@/lib/supabase/client";
import { fetchAllPages } from "@/lib/supabase/fetch-all";
import type { SalesContext } from "./sales-context";
import { DataTable, LoadFailed, Panel, PendingDetail, share, useSageQuery, type Column } from "./sales-ui";

/*
  Productos: de la familia a la subfamilia y al artículo, y por marca. Pulsar
  una familia filtra todo el panel (también Clientes); la subfamilia y la marca
  filtran solo esta página, porque el resto del panel no las conoce.
*/

type FamilyRow = {
  company_code: number;
  family_code: string;
  family_name: string | null;
  units: number;
  net_amount: number;
  trusted_net: number;
  trusted_cost: number;
  trusted_without_cost: number;
  /** El bruto antes de descuentos y el neto de lo que lo trae. */
  gross_amount: number;
  gross_net: number;
};
type GroupRow = {
  code: string; family_code: string; name: string | null; articles: number; net_amount: number; trusted_net: number; trusted_cost: number;
  trusted_without_cost: number; gross_amount: number; gross_net: number;
};
type ArticleRow = {
  article_code: string; name: string | null; brand: string | null; family_code: string; subfamily_code: string;
  units: number; documents: number; net_amount: number; trusted_net: number; trusted_cost: number; trusted_without_cost: number;
  gross_amount: number; gross_net: number;
};

const margin = (row: { trusted_net: number; trusted_cost: number; trusted_without_cost: number }) => {
  const value = familyMargin(row);
  return value === null ? <span className="muted">—</span> : formatPercent(value);
};
/** Lo rebajado sobre tarifa en esas líneas (el de línea y el del cliente, que Sage reparte en ellas). */
const discount = (row: { gross_amount: number; gross_net: number }) => {
  const value = discountPercent(row.gross_amount, row.gross_net);
  return value === null ? <span className="muted">—</span> : formatPercent(value);
};
const discountSort = (row: { gross_amount: number; gross_net: number }) => discountPercent(row.gross_amount, row.gross_net) ?? -Infinity;
const change = (now: number, before: number) => {
  const raw = variation(now, before);
  if (raw === null) return <span className="muted">—</span>;
  // Sin "-0,0 %" en rojo: lo que no se mueve ni una décima va sin color.
  const value = tenths(raw);
  if (value === 0) return <span>0,0 %</span>;
  return <span className={value > 0 ? "sales-up" : "sales-down"}>{value > 0 ? "+" : ""}{value.toFixed(1).replace(".", ",")} %</span>;
};

export function ProductsPage({ ctx }: { ctx: SalesContext }) {
  const { filters, period } = ctx;
  const [subfamily, setSubfamily] = useState<string | null>(null);
  const [brand, setBrand] = useState<string | null>(null);
  // La subfamilia es de una familia: al cambiar de familia deja de tener sentido.
  const [subfamilyOf, setSubfamilyOf] = useState<string | null>(filters.family);
  if (subfamilyOf !== filters.family) {
    setSubfamilyOf(filters.family);
    setSubfamily(null);
  }

  const reload = ctx.reloadKey;
  const compare = period.compare;
  const families = useSageQuery<{ now: FamilyRow[]; before: FamilyRow[] }>(JSON.stringify(["familias", period.from, period.to, compare, reload]), async () => {
    const supabase = createClient();
    const [now, before] = await Promise.all([
      supabase.rpc("sage_family_summary", { p_from: period.from, p_to: period.to }),
      compare ? supabase.rpc("sage_family_summary", { p_from: compare.from, p_to: compare.to }) : Promise.resolve({ data: [], error: null }),
    ]);
    const error = now.error ?? before.error;
    return { data: error ? null : { now: (now.data ?? []) as FamilyRow[], before: (before.data ?? []) as FamilyRow[] }, error };
  });
  // La evolución de la familia elegida, mes a mes (sin el filtro de mes, para poder
  // pulsar otro), del periodo y de lo que se le pone al lado.
  const spanFrom = period.baseCompare && period.baseCompare.from < period.base.from ? period.baseCompare.from : period.base.from;
  const spanTo = period.baseCompare && period.baseCompare.to > period.base.to ? period.baseCompare.to : period.base.to;
  const familyMonths = useSageQuery<{ day: string; company_code: number; net_amount: number }[]>(
    filters.family !== null ? JSON.stringify(["familia-meses", filters.family, spanFrom, spanTo, reload]) : null,
    async () => {
      const supabase = createClient();
      return fetchAllPages<{ day: string; company_code: number; net_amount: number }>((start, end) =>
        supabase.from("sage_family_sales_daily").select("day, company_code, net_amount")
          .eq("family_code", filters.family ?? "").gte("day", spanFrom).lte("day", spanTo)
          .order("id").range(start, end));
    },
  );
  const articleArgs = { p_from: period.from, p_to: period.to, p_company: filters.company, p_family: filters.family };
  const subfamilies = useSageQuery<GroupRow[]>(ctx.detail.articles && filters.family !== null ? JSON.stringify(["subfamilias", articleArgs, reload]) : null, async () =>
    await createClient().rpc("sage_article_groups", { p_group: "subfamilia", ...articleArgs }));
  const brands = useSageQuery<GroupRow[]>(ctx.detail.articles ? JSON.stringify(["marcas", articleArgs, reload]) : null, async () =>
    await createClient().rpc("sage_article_groups", { p_group: "marca", ...articleArgs }));
  const articles = useSageQuery<ArticleRow[]>(ctx.detail.articles ? JSON.stringify(["articulos", articleArgs, subfamily, brand, reload]) : null, async () =>
    await createClient().rpc("sage_article_summary", { ...articleArgs, p_subfamily: subfamily, p_brand: brand, p_limit: 100 }));

  // ---- Familias, juntando las que se llaman igual en cada sociedad ----
  const inCompany = (row: { company_code: number }) => filters.company === null || row.company_code === filters.company;
  const groupFamilies = (list: FamilyRow[]) => {
    const map = new Map<string, { code: string; net: number; units: number; trusted_net: number; trusted_cost: number; trusted_without_cost: number; gross_amount: number; gross_net: number }>();
    for (const row of list.filter(inCompany)) {
      const entry = map.get(row.family_code) ?? { code: row.family_code, net: 0, units: 0, trusted_net: 0, trusted_cost: 0, trusted_without_cost: 0, gross_amount: 0, gross_net: 0 };
      entry.net += Number(row.net_amount);
      entry.units += Number(row.units);
      entry.trusted_net += Number(row.trusted_net);
      entry.trusted_cost += Number(row.trusted_cost);
      entry.trusted_without_cost += Number(row.trusted_without_cost);
      entry.gross_amount += Number(row.gross_amount ?? 0);
      entry.gross_net += Number(row.gross_net ?? 0);
      map.set(row.family_code, entry);
    }
    return map;
  };
  const familyNow = groupFamilies(families.data?.now ?? []);
  const familyBefore = groupFamilies(families.data?.before ?? []);
  const familyRows = [...familyNow.values()].map((row) => ({ ...row, name: ctx.familyName(row.code), before: familyBefore.get(row.code)?.net ?? 0 }));
  const familyTotal = familyRows.reduce((sum, row) => sum + Math.max(row.net, 0), 0);
  const topFamilies = [...familyRows].sort((a, b) => b.net - a.net).filter((row) => row.net > 0);
  const donutItems = [
    ...topFamilies.slice(0, 8).map((row, index) => ({ label: row.name, value: Math.round(row.net), color: channelColors[index % channelColors.length] })),
    ...(topFamilies.length > 8 ? [{ label: `Otras ${topFamilies.length - 8} familias`, value: Math.round(topFamilies.slice(8).reduce((sum, row) => sum + row.net, 0)), color: "#cbd5e1" }] : []),
  ];
  const codeByName = new Map(topFamilies.map((row) => [row.name, row.code]));

  type FamilyTableRow = (typeof familyRows)[number];
  const familyColumns: Column<FamilyTableRow>[] = [
    { key: "familia", header: "Familia", text: true, render: (row) => row.name, sort: (row) => row.name },
    { key: "ventas", header: "Ventas", render: (row) => euros(row.net), sort: (row) => row.net },
    ...(compare
      ? [{ key: "var", header: `vs ${period.compareShort}`, render: (row: FamilyTableRow) => change(row.net, row.before), sort: (row: FamilyTableRow) => variation(row.net, row.before) ?? -Infinity }]
      : []),
    { key: "peso", header: "Peso", optional: true, render: (row) => share(Math.max(row.net, 0), familyTotal), sort: (row) => row.net },
    { key: "margen", header: "Margen %", render: (row) => margin(row), sort: (row) => familyMargin(row) ?? -Infinity },
    { key: "dto", header: "Dto.", render: (row) => discount(row), sort: discountSort },
    { key: "unidades", header: "Unidades", optional: true, render: (row) => numberFormatter.format(Math.round(row.units)), sort: (row) => row.units },
  ];

  // ---- Evolución de la familia elegida ----
  const monthKeys = period.months;
  const familyByMonth = new Map<string, number>();
  for (const row of (familyMonths.data ?? []).filter(inCompany)) {
    const key = row.day.slice(0, 7);
    familyByMonth.set(key, (familyByMonth.get(key) ?? 0) + Number(row.net_amount));
  }
  const familyPoints = monthKeys.map((key) => {
    const pair = pairOf(key, period.monthOffset);
    return {
      label: monthLabel(key, period.multiYear),
      ventas: Math.round(familyByMonth.get(key) ?? 0),
      anterior: pair ? Math.round(familyByMonth.get(pair) ?? 0) : 0,
    };
  });
  const selectedMonthIndex = filters.month ? monthKeys.indexOf(filters.month) : -1;

  // ---- Subfamilias, marcas y artículos ----
  const groupColumns = (label: string): Column<GroupRow>[] => [
    { key: "nombre", header: label, text: true, render: (row) => row.name || (row.code ? `Código ${row.code}` : "Sin asignar"), sort: (row) => row.name ?? row.code },
    { key: "ventas", header: "Ventas", render: (row) => euros(Number(row.net_amount)), sort: (row) => Number(row.net_amount) },
    { key: "margen", header: "Margen %", render: (row) => margin(row), sort: (row) => familyMargin(row) ?? -Infinity },
    { key: "dto", header: "Dto.", render: (row) => discount(row), sort: discountSort },
    { key: "articulos", header: "Artículos", optional: true, render: (row) => numberFormatter.format(Number(row.articles)), sort: (row) => Number(row.articles) },
  ];
  const articleColumns: Column<ArticleRow>[] = [
    { key: "articulo", header: "Artículo", text: true, render: (row) => (
      <span className="sales-article">
        <strong>{row.name ?? row.article_code}</strong>
        <small>{row.article_code}{row.brand ? ` · ${row.brand}` : ""}{filters.family === null ? ` · ${ctx.familyName(row.family_code)}` : ""}</small>
      </span>
    ), sort: (row) => row.name ?? row.article_code },
    { key: "ventas", header: "Ventas", render: (row) => euros(Number(row.net_amount)), sort: (row) => Number(row.net_amount) },
    { key: "unidades", header: "Unidades", render: (row) => numberFormatter.format(Math.round(Number(row.units))), sort: (row) => Number(row.units) },
    { key: "margen", header: "Margen %", render: (row) => margin(row), sort: (row) => familyMargin(row) ?? -Infinity },
    { key: "dto", header: "Dto.", render: (row) => discount(row), sort: discountSort },
    { key: "albaranes", header: "Albaranes", optional: true, render: (row) => numberFormatter.format(Number(row.documents)), sort: (row) => Number(row.documents) },
  ];
  const periodName = ctx.periodName;
  const scope = [filters.family !== null ? ctx.familyName(filters.family) : null, subfamily !== null ? (subfamilies.data ?? []).find((row) => row.code === subfamily)?.name ?? subfamily : null, brand].filter(Boolean).join(" · ");

  return (
    <div className="page-stack">
      {families.failed ? <LoadFailed what="la venta por familia" /> : null}

      <section className="sales-board">
        <Panel
          title={`Familias en ${periodName}`}
          subtitle="Suma de las líneas de albarán (puede no cuadrar al euro con el total por los descuentos de cabecera). Dto.: rebaja sobre tarifa. Pulsa una para filtrar todo el panel"
          className="panel table-panel sales-board-wide"
        >
          <DataTable
            rows={familyRows}
            columns={familyColumns}
            rowKey={(row) => row.code}
            activeKey={filters.family}
            onRowClick={(row) => ctx.toggle("family", row.code)}
            initialSort={{ key: "ventas", desc: true }}
            limit={15}
            empty={families.data ? "Sin ventas por familia en este periodo." : "Cargando…"}
          />
        </Panel>

        {filters.family !== null ? (
          <Panel
            title={`${ctx.familyName(filters.family)} mes a mes`}
            subtitle={`${period.baseCompare ? `Con ${period.baseCompareShort} en gris. ` : ""}Pulsa un mes para filtrar`}
            className="panel chart-panel sales-board-narrow"
          >
            <TrendChart
              data={familyPoints}
              series={[
                ...(period.baseCompare ? [{ key: "anterior", label: period.baseCompareShort ?? "", color: "#cbd5e1" }] : []),
                { key: "ventas", label: "Ventas", color: "#4f46e5" },
              ]}
              ariaLabel={`Venta mensual de la familia ${ctx.familyName(filters.family)}`}
              onSelect={(index) => ctx.toggle("month", monthKeys[index] ?? null)}
              selectedIndex={selectedMonthIndex >= 0 ? selectedMonthIndex : null}
            />
          </Panel>
        ) : (
          <Panel title="Peso de cada familia" subtitle="Pulsa una para filtrar" className="panel chart-panel sales-channel sales-board-narrow">
            <DonutChart
              items={donutItems}
              centerLabel="ventas"
              ariaLabel="Reparto de la venta por familia"
              valueFormatter={(value) => euros(value)}
              onSelect={(label) => { const code = codeByName.get(label); if (code !== undefined) ctx.toggle("family", code); }}
              selectedLabel={null}
            />
          </Panel>
        )}

        {filters.family !== null ? (
          <Panel title="Subfamilias" subtitle={subfamily ? "Pulsa otra vez para quitar el filtro" : "Pulsa una para ver sus artículos"} className="panel table-panel sales-board-half">
            {ctx.detail.articles ? (
              <DataTable
                rows={subfamilies.data ?? []}
                columns={groupColumns("Subfamilia")}
                rowKey={(row) => row.code}
                activeKey={subfamily}
                onRowClick={(row) => setSubfamily((current) => (current === row.code ? null : row.code))}
                initialSort={{ key: "ventas", desc: true }}
                limit={12}
                empty={subfamilies.loading ? "Cargando…" : "Sin subfamilias con venta en este periodo."}
              />
            ) : <PendingDetail what="La venta por subfamilia" />}
          </Panel>
        ) : null}

        <Panel title="Marcas" subtitle={brand ? "Pulsa otra vez para quitar el filtro" : "Pulsa una para ver sus artículos"} className={`panel table-panel ${filters.family !== null ? "sales-board-half" : "sales-board-full"}`}>
          {ctx.detail.articles ? (
            <DataTable
              rows={(brands.data ?? []).filter((row) => row.code !== "")}
              columns={groupColumns("Marca")}
              rowKey={(row) => row.code}
              activeKey={brand}
              onRowClick={(row) => setBrand((current) => (current === row.code ? null : row.code))}
              initialSort={{ key: "ventas", desc: true }}
              limit={12}
              empty={brands.loading ? "Cargando…" : "Sin marcas con venta en este periodo."}
            />
          ) : <PendingDetail what="La venta por marca" />}
        </Panel>

        <Panel
          title="Artículos más vendidos"
          subtitle={scope ? `De ${scope}, en ${periodName}. Ordena pulsando la cabecera` : `En ${periodName}. Ordena pulsando la cabecera`}
          trailing={subfamily || brand ? (
            <button type="button" className="sales-chip sales-chip-clear" onClick={() => { setSubfamily(null); setBrand(null); }}>Quitar subfamilia y marca</button>
          ) : undefined}
          className="panel table-panel sales-board-full"
        >
          {ctx.detail.articles ? (
            articles.failed ? <LoadFailed what="los artículos" /> : (
              <DataTable
                rows={articles.data ?? []}
                columns={articleColumns}
                rowKey={(row) => `${row.article_code}-${row.family_code}`}
                initialSort={{ key: "ventas", desc: true }}
                limit={25}
                empty={articles.loading ? "Cargando…" : "Sin artículos vendidos con estos filtros."}
              />
            )
          ) : <PendingDetail what="La venta por artículo" />}
        </Panel>
      </section>
    </div>
  );
}
