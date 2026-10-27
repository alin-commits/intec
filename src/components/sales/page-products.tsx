"use client";

import { useState } from "react";
import { DonutChart } from "@/components/charts/donut-chart";
import { TrendChart } from "@/components/charts/trend-chart";
import { formatPercent, numberFormatter } from "@/lib/format";
import { familyMargin, partsOf, sumParts } from "@/lib/sage-panel";
import { channelColors, discountPercent, euros, hayComercialMarcado, marcado, monthLabel, pairOf, repFilterFor, soloUnMes, soloUno, variation } from "@/lib/sales-model";
import { createClient } from "@/lib/supabase/client";
import { fetchAllPages } from "@/lib/supabase/fetch-all";
import type { SalesContext } from "./sales-context";
import { changeCell, DataTable, LoadFailed, Panel, PendingDetail, share, useSageQuery, type Column } from "./sales-ui";

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
/** Una subfamilia o una marca, con lo que vendió en el periodo de al lado. */
type GroupTableRow = GroupRow & { before: number };

/**
 * Cruza los dos tramos por su clave.
 *
 * La clave es la pareja familia + código y no el código suelto: el de
 * subfamilia es correlativo dentro de cada familia y se repite entre ellas.
 * En las marcas la familia viene vacía y la pareja sigue valiendo.
 */
function juntarTramos(ahora: GroupRow[], antes: GroupRow[]): GroupTableRow[] {
  const llave = (row: GroupRow) => `${row.family_code}|${row.code}`;
  const deAntes = new Map(antes.map((row) => [llave(row), row]));
  const filas = ahora.map((row) => ({ ...row, before: Number(deAntes.get(llave(row))?.net_amount ?? 0) }));
  /*
    Y lo que vendió el año pasado y este no.

    Cruzando solo por lo de ahora, una subfamilia que ha caído a cero
    desaparecía de la tabla: ni fila, ni -100 %, y su importe tampoco entraba
    en el Total de la columna «antes», que salía corto sin decirlo. Lo que
    dejó de venderse es justo lo que hay que mirar.
  */
  const vistas = new Set(ahora.map(llave));
  for (const row of antes) {
    if (vistas.has(llave(row))) continue;
    filas.push({
      ...row,
      net_amount: 0, trusted_net: 0, trusted_cost: 0, trusted_without_cost: 0,
      gross_amount: 0, gross_net: 0, articles: 0,
      before: Number(row.net_amount),
    });
  }
  return filas;
}

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

export function ProductsPage({ ctx }: { ctx: SalesContext }) {
  const { filters, period } = ctx;
  const [brand, setBrand] = useState<string | null>(null);
  /*
    Las subfamilias y la evolución son de UNA familia: con dos marcadas no se
    sabe de cuál serían las subfamilias, así que esos paneles solo salen cuando
    hay una sola. Lo demás —el reparto por familia, las marcas, los artículos—
    funciona con las que haya.
  */
  const familia = soloUno(filters.families);
  /*
    La subfamilia es un filtro del panel, no un apaño de esta pantalla: se
    marca aquí —es el único sitio donde hay una tabla de subfamilias— pero
    viaja con los demás, se ve en su etiqueta y sigue puesta al cambiar de
    página. Va como «familia:subfamilia» porque el código es correlativo
    dentro de cada familia y suelto no identifica nada.

    De una en una: la tabla resalta una sola fila, y marcar varias sin poder
    verlas marcadas es peor que no poder. Al cambiar de familia, las que ya no
    son suyas las quita quien cambia el filtro.
  */
  const subfamilyKeys = familia === null ? [] : filters.subfamilies.filter((key) => key.startsWith(`${familia}:`));
  const subfamily = subfamilyKeys.length === 1 ? subfamilyKeys[0].slice(familia!.length + 1) : null;
  const marcarSubfamilia = (code: string) => {
    const key = `${familia}:${code}`;
    ctx.setFilters({ subfamilies: filters.subfamilies.includes(key) ? [] : [key] });
  };

  const reload = ctx.reloadKey;
  const compare = period.compare;
  // Los meses marcados viajan a la base: si dejan huecos, el tramo de fechas
  // traería de más. Los de la comparación son sus parejas.
  const months = ctx.rpc.p_months;
  const compareMonths = ctx.rpcCompare.p_months;
  /** Lo que se le pasa a la base solo cuando hay algo marcado. */
  const conMeses = (lista: string[] | undefined) => (lista ? { p_months: lista } : {});
  const conSociedades = ctx.rpc.p_companies ? { p_companies: ctx.rpc.p_companies } : {};
  const conFamilias = ctx.rpc.p_families ? { p_families: ctx.rpc.p_families } : {};
  /*
    El comercial del albarán, que el agente manda desde la versión
    «2026-10-22 productos-por-comercial». Va SIEMPRE, aunque no haya ninguno
    marcado y valga null: en la base conviven la función de antes y la que
    lleva p_reps, y sin ese argumento PostgREST no sabe cuál de las dos llamar
    y responde 300 (PGRST203) en vez de datos. Mientras se omitía, las
    subfamilias, las marcas y los artículos no salían nunca salvo con un
    comercial marcado. La migración 202610260003 quita la función vieja; esto
    aguanta igual si vuelve a aparecer.
  */
  const conComerciales = { p_reps: ctx.rpc.p_reps ?? null };
  /*
    Las subfamilias marcadas, y solo cuando hay alguna.

    Aquí al revés que p_reps, a propósito: p_subfamilies lo añade la migración
    202610260004, y mandarlo a una base que todavía no la tiene no es que
    filtre de menos, es que la función no existe con esa firma y se cae la
    pantalla entera. Sin nada marcado no se manda y todo funciona como antes;
    marcando una subfamilia sin la migración puesta, falla esa tabla y se
    arregla desmarcando. La migración borra la versión anterior, así que no
    quedan dos candidatas de las que dan 300.
  */
  const conSubfamilias = ctx.rpc.p_subfamilies ? { p_subfamilies: ctx.rpc.p_subfamilies } : {};
  /*
    El comercial lo trae el agente desde su versión de 2026-10-22, y lo que ya
    estaba cargado se quedó sin él. Entre aplicar la migración y releer el
    histórico, filtrar por comercial aquí no devuelve nada, y sin avisar
    parecería que esa persona no vende productos. Esto mira si ya hay algún
    reparto con comercial: una fila basta para saberlo.
  */
  const hayComercial = useSageQuery<boolean>(hayComercialMarcado(filters) ? JSON.stringify(["familias-con-comercial", reload]) : null, async () => {
    const { data, error } = await createClient().from("sage_family_sales_daily").select("rep_code").not("rep_code", "is", null).limit(1);
    return { data: error ? null : (data ?? []).length > 0, error };
  });
  const faltaRelectura = hayComercialMarcado(filters) && hayComercial.data === false;
  const families = useSageQuery<{ now: FamilyRow[]; before: FamilyRow[] }>(JSON.stringify(["familias", period.from, period.to, compare, months, compareMonths, ctx.rpc.p_reps, reload]), async () => {
    const supabase = createClient();
    const [now, before] = await Promise.all([
      supabase.rpc("sage_family_summary", { p_from: period.from, p_to: period.to, ...conMeses(months), ...conComerciales }),
      compare ? supabase.rpc("sage_family_summary", { p_from: compare.from, p_to: compare.to, ...conMeses(compareMonths), ...conComerciales }) : Promise.resolve({ data: [], error: null }),
    ]);
    const error = now.error ?? before.error;
    return { data: error ? null : { now: (now.data ?? []) as FamilyRow[], before: (before.data ?? []) as FamilyRow[] }, error };
  });
  // La evolución de la familia elegida, mes a mes (sin el filtro de mes, para poder
  // pulsar otro), del periodo y de lo que se le pone al lado.
  const spanFrom = period.baseCompare && period.baseCompare.from < period.base.from ? period.baseCompare.from : period.base.from;
  const spanTo = period.baseCompare && period.baseCompare.to > period.base.to ? period.baseCompare.to : period.base.to;
  const familyMonths = useSageQuery<{ day: string; company_code: number; net_amount: number }[]>(
    familia !== null && subfamilyKeys.length === 0
      ? JSON.stringify(["familia-meses", familia, spanFrom, spanTo, ctx.rpc.p_reps, reload])
      : null,
    async () => {
      const supabase = createClient();
      return fetchAllPages<{ day: string; company_code: number; net_amount: number }>((start, end) => {
        let consulta = supabase.from("sage_family_sales_daily").select("day, company_code, net_amount")
          .eq("family_code", familia ?? "").gte("day", spanFrom).lte("day", spanTo);
        const porComercial = repFilterFor(ctx.rpc.p_reps);
        if (porComercial) consulta = consulta.or(porComercial);
        return consulta.order("id").range(start, end);
      });
    },
  );
  /*
    Y la misma evolución cuando hay una subfamilia marcada.

    El diario por familia no baja a la subfamilia, así que esta sale del
    reparto por artículo, que sí la tiene. Es mensual, que es justo lo que
    pinta el gráfico. Las sociedades se filtran en la propia función y no
    después, porque aquí ya vienen sumadas por mes.
  */
  const subfamilyMonths = useSageQuery<{ month: string; net_amount: number }[]>(
    subfamilyKeys.length > 0
      ? JSON.stringify(["subfamilia-meses", subfamilyKeys, spanFrom, spanTo, ctx.rpc.p_reps, ctx.rpc.p_companies, reload])
      : null,
    async () => await createClient().rpc("sage_subfamily_months", {
      p_subfamilies: subfamilyKeys, p_from: spanFrom, p_to: spanTo, ...conSociedades, ...conComerciales,
    }),
  );
  const articleArgs = { p_from: period.from, p_to: period.to, ...conSociedades, ...conFamilias, ...conMeses(months), ...conComerciales, ...conSubfamilias };
  /*
    Las subfamilias y las marcas, del periodo y del de al lado.

    El de al lado se pide aparte porque la función de la base devuelve un
    tramo de fechas, no dos. Cuesta una consulta más y a cambio cada fila
    puede decir si sube o baja, que es lo que se mira.
  */
  const compareArgs = compare ? { ...articleArgs, p_from: compare.from, p_to: compare.to, ...conMeses(compareMonths) } : null;
  const dosTramos = (grupo: "subfamilia" | "marca") => async () => {
    const supabase = createClient();
    const [ahora, antes] = await Promise.all([
      supabase.rpc("sage_article_groups", { p_group: grupo, ...articleArgs }),
      compareArgs ? supabase.rpc("sage_article_groups", { p_group: grupo, ...compareArgs }) : Promise.resolve({ data: [], error: null }),
    ]);
    const error = ahora.error ?? antes.error;
    return { data: error ? null : juntarTramos((ahora.data ?? []) as GroupRow[], (antes.data ?? []) as GroupRow[]), error };
  };
  const subfamilies = useSageQuery<GroupTableRow[]>(
    ctx.detail.articles && familia !== null ? JSON.stringify(["subfamilias", articleArgs, compareArgs, reload]) : null,
    dosTramos("subfamilia"));
  const brands = useSageQuery<GroupTableRow[]>(
    ctx.detail.articles ? JSON.stringify(["marcas", articleArgs, compareArgs, reload]) : null,
    dosTramos("marca"));
  const articles = useSageQuery<ArticleRow[]>(ctx.detail.articles ? JSON.stringify(["articulos", articleArgs, brand, reload]) : null, async () =>
    await createClient().rpc("sage_article_summary", { ...articleArgs, p_brand: brand, p_limit: 100 }));

  // ---- Familias, juntando las que se llaman igual en cada sociedad ----
  const inCompany = (row: { company_code: number }) => marcado(filters.companies, row.company_code);
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
  /** La fila de Total: se suman los sumandos y el margen y el Dto. se recalculan sobre ellos. */
  const totalFamilies = (rows: FamilyTableRow[]) => sumParts(rows, (row) => row);
  const familyColumns: Column<FamilyTableRow>[] = [
    { key: "familia", header: "Familia", text: true, render: (row) => row.name, sort: (row) => row.name },
    { key: "ventas", header: "Ventas", render: (row) => euros(row.net), sort: (row) => row.net, total: (rows) => euros(totalFamilies(rows).net) },
    // Lo que vendió en el periodo de al lado. El porcentaje de la siguiente
    // dice cuánto se mueve; esta dice desde dónde, que es lo que hace falta
    // para saber si un +550 % son dos mil euros o doscientos mil.
    ...(compare
      ? [{ key: "antes", header: period.compareShort ?? "Antes", render: (row: FamilyTableRow) => euros(row.before), sort: (row: FamilyTableRow) => row.before, total: (rows: FamilyTableRow[]) => euros(rows.reduce((sum, row) => sum + row.before, 0)) }]
      : []),
    ...(compare
      ? [{ key: "var", header: `vs ${period.compareShort}`, render: (row: FamilyTableRow) => changeCell(row.net, row.before), sort: (row: FamilyTableRow) => variation(row.net, row.before) ?? -Infinity, total: (rows: FamilyTableRow[]) => changeCell(totalFamilies(rows).net, rows.reduce((sum, row) => sum + row.before, 0)) }]
      : []),
    { key: "peso", header: "Peso", optional: true, render: (row) => share(Math.max(row.net, 0), familyTotal), sort: (row) => row.net, total: () => share(familyTotal, familyTotal) },
    { key: "margen", header: "Margen %", render: (row) => margin(row), sort: (row) => familyMargin(row) ?? -Infinity, total: (rows) => margin(totalFamilies(rows)) },
    { key: "dto", header: "Dto.", render: (row) => discount(row), sort: discountSort, total: (rows) => discount(totalFamilies(rows)) },
    { key: "unidades", header: "Unidades", optional: true, render: (row) => numberFormatter.format(Math.round(row.units)), sort: (row) => row.units, total: (rows) => numberFormatter.format(Math.round(totalFamilies(rows).units)) },
  ];

  // ---- Evolución de la familia elegida ----
  const monthKeys = period.months;
  /*
    El gráfico es de la subfamilia marcada o de la familia, nunca de las dos.

    Las dos consultas guardan lo último que trajeron aunque se les quite la
    clave, así que al marcar una subfamilia los datos de la familia siguen
    ahí: sumando los dos mapas, el gráfico contaba la subfamilia dos veces
    —una suelta y otra dentro de su familia— y enseñaba más venta de la que
    hay.
  */
  const familyByMonth = new Map<string, number>();
  if (subfamilyKeys.length > 0) {
    for (const row of subfamilyMonths.data ?? []) {
      const key = row.month.slice(0, 7);
      familyByMonth.set(key, (familyByMonth.get(key) ?? 0) + Number(row.net_amount));
    }
  } else {
    for (const row of (familyMonths.data ?? []).filter(inCompany)) {
      const key = row.day.slice(0, 7);
      familyByMonth.set(key, (familyByMonth.get(key) ?? 0) + Number(row.net_amount));
    }
  }
  const familyPoints = monthKeys.map((key) => {
    const pair = pairOf(key, period.monthOffset);
    return {
      label: monthLabel(key, period.multiYear),
      ventas: Math.round(familyByMonth.get(key) ?? 0),
      anterior: pair ? Math.round(familyByMonth.get(pair) ?? 0) : 0,
    };
  });
  const selectedMonthIndex = soloUnMes(filters) ? monthKeys.indexOf(soloUnMes(filters)!) : -1;

  // ---- Subfamilias, marcas y artículos ----
  const groupTotal = (rows: GroupRow[]) => sumParts(rows, partsOf);
  /** Las columnas de subfamilias y marcas. El peso es sobre lo que suma la propia tabla. */
  const groupColumns = (label: string, rows: GroupTableRow[]): Column<GroupTableRow>[] => [
    { key: "nombre", header: label, text: true, render: (row) => row.name || (row.code ? `Código ${row.code}` : "Sin asignar"), sort: (row) => row.name ?? row.code },
    { key: "ventas", header: "Ventas", render: (row) => euros(Number(row.net_amount)), sort: (row) => Number(row.net_amount), total: (rows) => euros(groupTotal(rows).net) },
    // Lo mismo que en familias: el importe de antes y cuánto se ha movido.
    ...(compare
      ? [
        { key: "antes", header: period.compareShort ?? "Antes", optional: true, render: (row: GroupTableRow) => euros(row.before), sort: (row: GroupTableRow) => row.before, total: (rows: GroupTableRow[]) => euros(rows.reduce((sum, row) => sum + row.before, 0)) },
        { key: "var", header: `vs ${period.compareShort}`, render: (row: GroupTableRow) => changeCell(Number(row.net_amount), row.before), sort: (row: GroupTableRow) => variation(Number(row.net_amount), row.before) ?? -Infinity, total: (rows: GroupTableRow[]) => changeCell(groupTotal(rows).net, rows.reduce((sum, row) => sum + row.before, 0)) },
      ]
      : []),
    { key: "peso", header: "Peso", optional: true, render: (row) => share(Number(row.net_amount), groupTotal(rows).net), sort: (row) => Number(row.net_amount) },
    { key: "margen", header: "Margen %", render: (row) => margin(row), sort: (row) => familyMargin(row) ?? -Infinity, total: (rows) => margin(groupTotal(rows)) },
    { key: "dto", header: "Dto.", render: (row) => discount(row), sort: discountSort, total: (rows) => discount(groupTotal(rows)) },
    { key: "articulos", header: "Artículos", optional: true, render: (row) => numberFormatter.format(Number(row.articles)), sort: (row) => Number(row.articles), total: (rows) => numberFormatter.format(groupTotal(rows).articles) },
  ];
  const articleTotal = (rows: ArticleRow[]) => sumParts(rows, partsOf);
  const articleColumns: Column<ArticleRow>[] = [
    { key: "articulo", header: "Artículo", text: true, render: (row) => (
      <span className="sales-article">
        <strong>{row.name ?? row.article_code}</strong>
        <small>{row.article_code}{row.brand ? ` · ${row.brand}` : ""}{filters.families.length === 0 ? ` · ${ctx.familyName(row.family_code)}` : ""}</small>
      </span>
    ), sort: (row) => row.name ?? row.article_code, total: (rows) => `Total · ${numberFormatter.format(rows.length)} artículos` },
    { key: "ventas", header: "Ventas", render: (row) => euros(Number(row.net_amount)), sort: (row) => Number(row.net_amount), total: (rows) => euros(articleTotal(rows).net) },
    { key: "unidades", header: "Unidades", render: (row) => numberFormatter.format(Math.round(Number(row.units))), sort: (row) => Number(row.units), total: (rows) => numberFormatter.format(Math.round(articleTotal(rows).units)) },
    { key: "margen", header: "Margen %", render: (row) => margin(row), sort: (row) => familyMargin(row) ?? -Infinity, total: (rows) => margin(articleTotal(rows)) },
    { key: "dto", header: "Dto.", render: (row) => discount(row), sort: discountSort, total: (rows) => discount(articleTotal(rows)) },
    { key: "albaranes", header: "Albaranes", optional: true, render: (row) => numberFormatter.format(Number(row.documents)), sort: (row) => Number(row.documents), total: (rows) => numberFormatter.format(articleTotal(rows).documents) },
  ];
  const brandRows = (brands.data ?? []).filter((row) => row.code !== "");
  /*
    El nivel de abajo: al marcar una familia, sus subfamilias se abren debajo
    de su propia fila. Antes vivían en un cuadro aparte, y había que buscar con
    la vista a qué familia pertenecía lo que se estaba mirando.
  */
  const subfamilyDetail = familia === null ? null : (
    <div className="sales-row-detail-inner">
      <p className="sales-row-detail-title">
        Subfamilias de {ctx.familyName(familia)}
        {ctx.detail.articles ? <> · {subfamily ? "pulsa otra vez para quitar el filtro" : "pulsa una para filtrar esta pantalla"}</> : null}
      </p>
      {ctx.detail.articles ? (
        <DataTable
          rows={subfamilies.data ?? []}
          columns={groupColumns("Subfamilia", subfamilies.data ?? [])}
          rowKey={(row) => row.code}
          activeKey={subfamily}
          onRowClick={(row) => marcarSubfamilia(row.code)}
          initialSort={{ key: "ventas", desc: true }}
          limit={12}
          empty={subfamilies.loading ? "Cargando…" : "Sin subfamilias con venta en este periodo."}
        />
      ) : <PendingDetail what="La venta por subfamilia" />}
    </div>
  );
  const periodName = ctx.periodName;
  /** Cómo se llama la subfamilia marcada, con el nombre que trae su propia tabla. */
  const nombreSubfamilia = subfamily === null
    ? null
    : (subfamilies.data ?? []).find((row) => row.code === subfamily)?.name ?? `Código ${subfamily}`;
  const scope = [familia !== null ? ctx.familyName(familia) : null, nombreSubfamilia, brand].filter(Boolean).join(" · ");

  return (
    <div className="page-stack">
      {families.failed ? <LoadFailed what="la venta por familia" /> : null}

      {faltaRelectura ? (
        <section className="panel panel-padded">
          <h3>El reparto por producto todavía no sabe de comerciales</h3>
          <p className="muted">
            Lo que hay cargado se leyó de Sage antes de que el agente mandara el comercial de cada albarán, así que
            filtrar por comercial aquí no devuelve nada. Se arregla copiando al servidor de Sage la versión{" "}
            <code>2026-10-22 productos-por-comercial</code> del agente y pidiéndole una lectura del histórico entero.
            Lo demás del panel no se ve afectado.
          </p>
        </section>
      ) : null}

      <section className="sales-board">
        {familia !== null ? (
          <Panel
            title={`${nombreSubfamilia ?? ctx.familyName(familia)} mes a mes`}
            subtitle={`${period.baseCompare ? `Con ${period.baseCompareShort} en gris. ` : ""}Pulsa un mes para filtrar`}
            className="panel chart-panel sales-board-full"
          >
            <TrendChart
              data={familyPoints}
              series={[
                ...(period.baseCompare ? [{ key: "anterior", label: period.baseCompareShort ?? "", color: "#cbd5e1" }] : []),
                { key: "ventas", label: "Ventas", color: "#4f46e5" },
              ]}
              ariaLabel={nombreSubfamilia
                ? `Venta mensual de la subfamilia ${nombreSubfamilia}`
                : `Venta mensual de la familia ${ctx.familyName(familia)}`}
              valueFormatter={euros}
              onSelect={(index) => ctx.toggleMonth(monthKeys[index] ?? null)}
              selectedIndex={selectedMonthIndex >= 0 ? selectedMonthIndex : null}
            />
          </Panel>
        ) : (
          <Panel title="Peso de cada familia" subtitle="Pulsa una para filtrar" className="panel chart-panel sales-channel sales-board-full">
            <DonutChart
              items={donutItems}
              centerLabel="ventas"
              ariaLabel="Reparto de la venta por familia"
              valueFormatter={(value) => euros(value)}
              onSelect={(label) => { const code = codeByName.get(label); if (code !== undefined) ctx.toggleEnLista("families", code); }}
              selectedLabel={null}
            />
          </Panel>
        )}

        <Panel
          title={`Familias en ${periodName}`}
          subtitle="Suma de las líneas de albarán (puede no cuadrar al euro con el total por los descuentos de cabecera). Dto.: rebaja sobre tarifa. Pulsa una para filtrar todo el panel"
          className="panel table-panel sales-board-full"
        >
          <DataTable
            rows={familyRows}
            columns={familyColumns}
            rowKey={(row) => row.code}
            activeKey={familia}
            onRowClick={(row) => ctx.toggleEnLista("families", row.code)}
            expand={(row) => (row.code === familia ? subfamilyDetail : null)}
            initialSort={{ key: "ventas", desc: true }}
            /*
              Quince, salvo con una familia marcada: entonces salen todas.

              Sus subfamilias se abren desplegadas debajo de su fila, y si la
              familia no entra en las quince primeras no hay fila donde
              abrirlas — se marcaba desde el gráfico o desde la etiqueta y la
              tabla de subfamilias no aparecía por ningún lado. Quien ha
              marcado una familia no se asusta de ver la lista entera.
            */
            limit={familia !== null ? Math.max(familyRows.length, 15) : 15}
            empty={families.data ? "Sin ventas por familia en este periodo." : "Cargando…"}
          />
        </Panel>

        <Panel title="Marcas" subtitle={brand ? "Pulsa otra vez para quitar el filtro" : "Pulsa una para ver sus artículos"} className="panel table-panel sales-board-full">
          {ctx.detail.articles ? (
            <DataTable
              rows={brandRows}
              columns={groupColumns("Marca", brandRows)}
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
            <button type="button" className="sales-chip sales-chip-clear"
              onClick={() => { ctx.setFilters({ subfamilies: [] }); setBrand(null); }}>Quitar subfamilia y marca</button>
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
