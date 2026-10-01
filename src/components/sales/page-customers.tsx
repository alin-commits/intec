"use client";

import { useEffect, useState } from "react";
import { KpiCard } from "@/components/kpi-card";
import { TrendChart } from "@/components/charts/trend-chart";
import { CalendarIcon, ConversionIcon, EuroIcon, HeartIcon, RefreshIcon, UsuariosIcon, XCircleIcon } from "@/components/icons";
import { formatPercent, numberFormatter } from "@/lib/format";
import { familyMargin, trustedNewCustomersFrom } from "@/lib/sage-panel";
import { discountPercent, euros, monthLabel, monthName, monthWithYear, pairOf, ticketFormatter, variation, delta } from "@/lib/sales-model";
import { createClient } from "@/lib/supabase/client";
import { lostCustomers, type CustomerKind, type SalesContext } from "./sales-context";
import { snapshotTotal, useCustomerCounts, useCustomerTotals, type CustomerCounts } from "./sales-queries";
import { DataTable, LoadFailed, Panel, RankList, share, shortDate, useSageQuery, type Column } from "./sales-ui";
import type { CustomerRow } from "./sales-list-modal";

/*
  Clientes: cuántos compran, cuántos son nuevos, cuántos repiten y cuántos se
  han ido. Cada cifra abre la lista con nombre y teléfono, y el gráfico filtra
  por mes al pulsarlo ("¿quién compró en agosto?": pulsa agosto y luego la
  tarjeta).
*/

type MonthlyRow = { month: string; activos: number; nuevos: number; neto: number };

/** Los tipos de cliente de la ficha de Sage por los que se puede partir la venta. */
const segmentDimensions = [
  { key: "zona", label: "Zona" },
  { key: "sector", label: "Sector" },
  { key: "canal", label: "Canal" },
  { key: "forma_pago", label: "Forma de pago" },
  { key: "provincia", label: "Provincia" },
] as const;
type SegmentDimension = (typeof segmentDimensions)[number]["key"];
type SegmentRow = {
  code: string; name: string | null; customers: number; net_amount: number; gross_amount: number; gross_net: number;
  trusted_net: number; trusted_cost: number; trusted_without_cost: number;
};

/**
 * La venta partida por cómo es el cliente según su ficha de Sage: zona, sector,
 * canal, forma de pago o provincia. Respeta los filtros del panel; con una
 * familia elegida salen los clientes que la compraron, con todo lo que compraron.
 */
function SegmentsPanel({ ctx, periodName }: { ctx: SalesContext; periodName: string }) {
  const [dimension, setDimension] = useState<SegmentDimension>("zona");
  const args = { p_dim: dimension, p_from: ctx.period.from, p_to: ctx.period.to, ...ctx.rpc };
  const segments = useSageQuery<SegmentRow[]>(JSON.stringify(["segmentos", args, ctx.reloadKey]), async () =>
    await createClient().rpc("sage_customer_segments", args));
  const rows = segments.data ?? [];
  const total = rows.reduce((sum, row) => sum + Math.max(Number(row.net_amount), 0), 0);
  const label = segmentDimensions.find((item) => item.key === dimension)?.label ?? "";
  // Si en Sage no se rellena ese campo, todo cae en "Sin asignar": se dice, en vez
  // de pintar una tabla de una sola fila al 100 %.
  const unfilled = rows.length > 0 && rows.every((row) => row.code === "");

  const columns: Column<SegmentRow>[] = [
    // Sin nombre en las tablas de códigos, un código numérico se dice como tal; uno
    // de texto ya se entiende solo (las formas de pago son "Giro a 60 días"...).
    { key: "nombre", header: label, text: true, render: (row) => (row.code === "" ? <span className="muted">Sin asignar en Sage</span> : row.name || (/^\d+$/.test(row.code) ? `Código ${row.code}` : row.code)), sort: (row) => row.name ?? row.code },
    { key: "clientes", header: "Clientes", render: (row) => numberFormatter.format(Number(row.customers)), sort: (row) => Number(row.customers) },
    { key: "ventas", header: "Ventas", render: (row) => euros(Number(row.net_amount)), sort: (row) => Number(row.net_amount) },
    { key: "peso", header: "Peso", optional: true, render: (row) => share(Math.max(Number(row.net_amount), 0), total), sort: (row) => Number(row.net_amount) },
    { key: "porcliente", header: "Por cliente", optional: true, render: (row) => (Number(row.customers) ? euros(Number(row.net_amount) / Number(row.customers)) : "—"), sort: (row) => (Number(row.customers) ? Number(row.net_amount) / Number(row.customers) : 0) },
    { key: "margen", header: "Margen %", render: (row) => { const value = familyMargin(row); return value === null ? <span className="muted">—</span> : formatPercent(value); }, sort: (row) => familyMargin(row) ?? -Infinity },
    { key: "dto", header: "Dto.", render: (row) => { const value = discountPercent(row.gross_amount, row.gross_net); return value === null ? <span className="muted">—</span> : formatPercent(value); }, sort: (row) => discountPercent(row.gross_amount, row.gross_net) ?? -Infinity },
  ];

  return (
    <Panel
      title={`Clientes por ${label.toLowerCase()} en ${periodName}`}
      subtitle={`Según la ficha del cliente en Sage, con los filtros puestos${ctx.filters.family ? ` (los que compran ${ctx.familyName(ctx.filters.family)}, con todo lo que compran)` : ""}. Dto.: rebaja sobre tarifa`}
      trailing={(
        <div className="sales-switch is-wrap" role="group" aria-label="Partir la venta por">
          {segmentDimensions.map((item) => (
            <button key={item.key} type="button" className={dimension === item.key ? "is-active" : undefined} onClick={() => setDimension(item.key)} aria-pressed={dimension === item.key}>
              {item.label}
            </button>
          ))}
        </div>
      )}
      className="panel table-panel sales-board-full"
    >
      {segments.failed ? <LoadFailed what={`la venta por ${label.toLowerCase()}`} /> : unfilled ? (
        <p className="muted">
          En Sage no está rellenado {dimension === "forma_pago" ? "la forma de pago" : `el campo ${label.toLowerCase()}`} de estos clientes, o todavía no
          ha llegado con la lectura de Sage. Prueba con otro.
        </p>
      ) : (
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(row) => row.code || "sin"}
          initialSort={{ key: "ventas", desc: true }}
          limit={12}
          empty={segments.loading ? "Cargando…" : "Sin ventas con estos filtros."}
        />
      )}
    </Panel>
  );
}

type FoundCustomer = { company_code: number; code: string; name: string; trade_name: string | null; municipality: string | null; province: string | null };

/** Busca un cliente por nombre, nombre comercial o código, y abre su ficha. */
function CustomerSearch({ ctx }: { ctx: SalesContext }) {
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  // Se pregunta a la base cuando se deja de escribir un momento, no a cada letra.
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(text.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [text]);
  // Sin comas ni paréntesis, que romperían el filtro de la base.
  const safe = query.replace(/[,()*%\\]/g, " ").replace(/\s+/g, " ").trim();
  const company = ctx.filters.company;
  const found = useSageQuery<FoundCustomer[]>(safe.length >= 2 ? JSON.stringify(["buscar-cliente", safe, company]) : null, async () => {
    let request = createClient().from("sage_customers")
      .select("company_code, code, name, trade_name, municipality, province")
      .or(`name.ilike.*${safe}*,trade_name.ilike.*${safe}*,code.ilike.${safe}*`)
      .order("name")
      .limit(12);
    if (company !== null) request = request.eq("company_code", company);
    return await request;
  });
  const multiCompany = ctx.companies.length > 1 && company === null;
  const companyName = (code: number) => ctx.companies.find((item) => item.code === code)?.name ?? `Sociedad ${code}`;
  const list = found.data ?? [];

  return (
    <div className="sales-customer-search">
      <input
        type="search"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="Nombre, nombre comercial o código…"
        aria-label="Buscar un cliente"
      />
      {safe.length >= 2 ? (
        <ul className="sales-customer-results" aria-live="polite">
          {found.failed ? <li className="muted">No se pudo buscar. Vuelve a intentarlo.</li>
            : found.loading && list.length === 0 ? <li className="muted">Buscando…</li>
              : list.length === 0 ? <li className="muted">Ningún cliente con «{safe}».</li>
                : list.map((row) => (
                  <li key={`${row.company_code}-${row.code}`}>
                    <button
                      type="button"
                      onClick={() => {
                        ctx.openCustomer({ company_code: row.company_code, customer_code: row.code, name: row.trade_name || row.name });
                        setText("");
                      }}
                    >
                      <strong>{row.trade_name || row.name}</strong>
                      <small>
                        {[row.trade_name ? row.name : null, row.code, [row.municipality, row.province].filter(Boolean).join(", "), multiCompany ? companyName(row.company_code) : null]
                          .filter(Boolean).join(" · ")}
                      </small>
                    </button>
                  </li>
                ))}
        </ul>
      ) : null}
    </div>
  );
}

export function CustomersPage({ ctx }: { ctx: SalesContext }) {
  const { filters, period } = ctx;
  const counts = useCustomerCounts(ctx);
  const before = useCustomerCounts(ctx, true);
  const totals = useCustomerTotals(ctx);
  const reload = ctx.reloadKey;
  // Del periodo y de lo que se le pone al lado, para comparar mes a mes.
  const spanFrom = period.baseCompare && period.baseCompare.from < period.base.from ? period.baseCompare.from : period.base.from;
  const spanTo = period.baseCompare && period.baseCompare.to > period.base.to ? period.baseCompare.to : period.base.to;
  const monthlyArgs = { p_from: spanFrom, p_to: spanTo, p_company: ctx.rpc.p_company, p_reps: ctx.rpc.p_reps, p_series: ctx.rpc.p_series };
  const monthly = useSageQuery<{ rows: MonthlyRow[]; firstDay: string | null }>(ctx.detail.customers ? JSON.stringify(["clientes-mes", monthlyArgs, reload]) : null, async () => {
    const supabase = createClient();
    const [rows, first] = await Promise.all([
      supabase.rpc("sage_customer_monthly", monthlyArgs),
      supabase.from("sage_customer_days").select("day").order("day").limit(1),
    ]);
    const error = rows.error ?? first.error;
    return { data: error ? null : { rows: (rows.data ?? []) as MonthlyRow[], firstDay: ((first.data ?? [])[0] as { day: string } | undefined)?.day ?? null }, error };
  });
  const listArgs = { p_kind: "activos", p_from: period.from, p_to: period.to, ...ctx.rpc };
  const top = useSageQuery<CustomerRow[]>(ctx.detail.customers ? JSON.stringify(["clientes-top", listArgs, reload]) : null, async () =>
    await createClient().rpc("sage_customer_list", listArgs));

  const monthKeys = period.months;
  const selectedMonthIndex = filters.month ? monthKeys.indexOf(filters.month) : -1;
  const periodName = ctx.periodName;
  const lost = lostCustomers(period);
  const pair = (key: string) => pairOf(key, period.monthOffset) ?? "";

  // En los primeros meses del histórico todos parecen nuevos: no hay nada antes.
  const firstMonth = ctx.detail.customers ? monthly.data?.firstDay?.slice(0, 7) ?? null : totals.data?.firstMonth?.slice(0, 7) ?? null;
  const trustedFrom = trustedNewCustomersFrom(firstMonth);
  const newTrusted = (month: string) => trustedFrom !== null && month >= trustedFrom;

  // ---- Gráfico por mes ----
  const points = (() => {
    if (ctx.detail.customers) {
      const byMonth = new Map((monthly.data?.rows ?? []).map((row) => [row.month, row]));
      return monthKeys.map((key) => ({
        label: monthLabel(key, period.multiYear),
        activos: Number(byMonth.get(key)?.activos ?? 0),
        nuevos: newTrusted(key) ? Number(byMonth.get(key)?.nuevos ?? 0) : 0,
        anterior: Number(byMonth.get(pair(key))?.activos ?? 0),
      }));
    }
    const inCompany = (row: { company_code: number }) => filters.company === null || row.company_code === filters.company;
    const byMonth = new Map<string, { active: number; fresh: number }>();
    for (const row of (totals.data?.monthly ?? []).filter(inCompany)) {
      const key = row.month.slice(0, 7);
      const entry = byMonth.get(key) ?? { active: 0, fresh: 0 };
      entry.active += Number(row.active_customers);
      entry.fresh += Number(row.new_customers);
      byMonth.set(key, entry);
    }
    return monthKeys.map((key) => ({
      label: monthLabel(key, period.multiYear),
      activos: byMonth.get(key)?.active ?? 0,
      nuevos: newTrusted(key) ? byMonth.get(key)?.fresh ?? 0 : 0,
      anterior: byMonth.get(pair(key))?.active ?? 0,
    }));
  })();
  const showNew = monthKeys.some(newTrusted);
  const hasBefore = points.some((point) => point.anterior > 0);

  const open = (kind: CustomerKind, title: string, description: string, days?: number) =>
    ctx.openList({ type: "clientes", kind, days, title, description });
  const card = (data: CustomerCounts | null, field: keyof CustomerCounts) => (data ? numberFormatter.format(data[field]) : "…");
  const compare = (field: keyof CustomerCounts) =>
    counts.data && before.data && ctx.comparisonAvailable ? delta(variation(counts.data[field], before.data[field])) : { delta: "Sin comparación", positive: true };

  type TopRow = CustomerRow;
  const topColumns: Column<TopRow>[] = [
    { key: "cliente", header: "Cliente", text: true, render: (row) => (
      <span className="sales-article">
        <strong>{row.trade_name || row.name}</strong>
        <small>{[row.trade_name ? row.name : null, row.municipality, row.province].filter(Boolean).join(" · ")}</small>
      </span>
    ), sort: (row) => row.trade_name || row.name },
    { key: "compra", header: "Compra", render: (row) => euros(Number(row.net_amount)), sort: (row) => Number(row.net_amount) },
    { key: "dto", header: "Dto.", render: (row) => { const value = discountPercent(row.gross_amount, row.gross_net); return value === null ? <span className="muted">—</span> : formatPercent(value); }, sort: (row) => discountPercent(row.gross_amount, row.gross_net) ?? -Infinity },
    { key: "albaranes", header: "Albaranes", optional: true, render: (row) => numberFormatter.format(Number(row.documents)), sort: (row) => Number(row.documents) },
    { key: "comercial", header: "Comercial", text: true, optional: true, render: (row) => (row.rep_code === null ? <span className="muted">—</span> : ctx.repOf(row.company_code, row.rep_code).label), sort: (row) => (row.rep_code === null ? "" : ctx.repOf(row.company_code, row.rep_code).label) },
    { key: "contacto", header: "Contacto", text: true, optional: true, render: (row) => {
      const phone = row.contact_phone || row.phone;
      if (!row.contact_name && !phone) return <span className="muted">—</span>;
      return (
        <span className="sales-contact">
          {row.contact_name ? <strong>{row.contact_name}</strong> : null}
          {phone ? <a href={`tel:${phone.replace(/\s+/g, "")}`} onClick={(event) => event.stopPropagation()}>{phone}</a> : null}
        </span>
      );
    } },
    { key: "ultima", header: "Última compra", render: (row) => shortDate(row.last_purchase), sort: (row) => row.last_purchase ?? "" },
  ];

  const dormant = totals.data ? snapshotTotal(totals.data.snapshots, "clientes_dormidos", filters.company) : null;

  return (
    <div className="page-stack">
      <section className="panel sales-customer-finder">
        <div>
          <h2>Ficha de un cliente</h2>
          <p className="muted">Busca uno para ver cómo compra, sus pedidos y sus ofertas. También se abre pulsando cualquier cliente de las listas.</p>
        </div>
        <CustomerSearch ctx={ctx} />
      </section>

      {ctx.detail.customers ? (
        <>
          <section className="sales-section">
            <div className="sales-section-heading">
              <h2>Clientes de {periodName}</h2>
              <p>
                Pulsa una cifra para ver quiénes son. {filters.family ? `Solo los que compran ${ctx.familyName(filters.family)}. ` : ""}
                {ctx.comparisonAvailable ? `Las flechas comparan ${ctx.comparisonHelper}.` : ""}
              </p>
            </div>
            {counts.failed ? <LoadFailed what="las cifras de clientes" /> : null}
            <div className="kpi-grid kpi-grid-sales">
              <KpiCard label="Con compra" value={card(counts.data, "activos")} helper="clientes distintos" icon={<UsuariosIcon />} tone="sky" {...compare("activos")}
                onClick={() => open("activos", `Clientes con compra en ${periodName}`, "Todos los que han comprado en el periodo, de más a menos venta.")} actionLabel="Ver lista" />
              <KpiCard label="Nuevos" value={card(counts.data, "nuevos")} helper="primera compra de su vida" icon={<CalendarIcon />} tone="emerald" {...compare("nuevos")}
                onClick={() => open("nuevos", `Clientes nuevos en ${periodName}`, "Su primera compra de siempre cae en el periodo.")} actionLabel="Ver lista" />
              <KpiCard label="Recurrentes" value={counts.data ? share(counts.data.recurrentes, counts.data.activos) : "…"} helper={counts.data ? `${numberFormatter.format(counts.data.recurrentes)} ya compraban el año anterior` : "cargando"} delta="Sin comparación" icon={<HeartIcon />} tone="indigo"
                onClick={() => open("recurrentes", `Clientes recurrentes en ${periodName}`, "Compran en el periodo y también compraron en los 12 meses anteriores.")} actionLabel="Ver lista" />
              <KpiCard label="Recuperados" value={card(counts.data, "recuperados")} helper="vuelven tras 6 meses o más sin comprar" delta="Sin comparación" icon={<RefreshIcon />} tone="emerald"
                onClick={() => open("recuperados", `Clientes recuperados en ${periodName}`, "Vuelven a comprar después de 180 días o más sin hacerlo.")} actionLabel="Ver lista" />
              <KpiCard label="Venta por cliente" value={counts.data && counts.data.activos ? ticketFormatter.format(counts.data.neto_activos / counts.data.activos) : "…"} helper="de media en el periodo" icon={<EuroIcon />} tone="amber"
                {...(counts.data && before.data && counts.data.activos && before.data.activos && ctx.comparisonAvailable
                  ? delta(variation(counts.data.neto_activos / counts.data.activos, before.data.neto_activos / before.data.activos))
                  : { delta: "Sin comparación", positive: true })} />
            </div>
          </section>

          <section className="sales-section">
            <div className="sales-section-heading">
              <h2>A quién llamar</h2>
              <p>Contado hasta el {shortDate(period.to)}. Clientes habituales (con compras en 2 días o más) que han dejado de comprar o llevan tiempo sin hacerlo. Los de una sola compra no cuentan aquí.</p>
            </div>
            <div className="kpi-grid kpi-grid-sales">
              <KpiCard label="Han dejado de comprar" value={card(counts.data, "perdidos")} helper={counts.data ? `compraban ${euros(counts.data.neto_perdidos)} en ${lost.previous}; en ${lost.year}, nada` : "cargando"} delta="Sin comparación" icon={<XCircleIcon />} tone="rose"
                onClick={() => open("perdidos", lost.title, lost.description)} actionLabel="Ver a quién llamar" />
              <KpiCard label="Más de 30 días sin comprar" value={card(counts.data, "sin_compra_30")} helper="habituales del último año" delta="Sin comparación" icon={<CalendarIcon />} tone="amber"
                onClick={() => open("sin_compra", "Clientes con más de 30 días sin comprar", "Clientes habituales del último año (compraron en 2 días o más) que no compran desde hace más de 30 días.", 30)} actionLabel="Ver lista" />
              <KpiCard label="Más de 60 días" value={card(counts.data, "sin_compra_60")} helper="habituales del último año" delta="Sin comparación" icon={<CalendarIcon />} tone="amber"
                onClick={() => open("sin_compra", "Clientes con más de 60 días sin comprar", "Clientes habituales del último año (compraron en 2 días o más) que no compran desde hace más de 60 días.", 60)} actionLabel="Ver lista" />
              <KpiCard label="Más de 90 días" value={card(counts.data, "sin_compra_90")} helper="habituales del último año" delta="Sin comparación" icon={<CalendarIcon />} tone="rose"
                onClick={() => open("sin_compra", "Clientes con más de 90 días sin comprar", "Clientes habituales del último año (compraron en 2 días o más) que no compran desde hace más de 90 días.", 90)} actionLabel="Ver lista" />
            </div>
          </section>
        </>
      ) : (
        <section className="panel sales-warning">
          <div>
            <strong>Las listas de clientes con nombre llegarán con la próxima lectura completa de Sage</strong>
            <span>
              Mientras, se ven los totales que ya había: cuántos compran y cuántos son nuevos cada mes
              {dormant ? `, y ${numberFormatter.format(dormant.count)} clientes que han dejado de comprar (compraban ${euros(dormant.amount)} al año)` : ""}.
              En cuanto el servidor de Sage mande el detalle, cada cifra se podrá pulsar para ver quiénes son.
            </span>
          </div>
        </section>
      )}

      <section className="sales-board">
        <Panel
          title={`Clientes por mes en ${period.baseLabel}`}
          subtitle={`Cuántos compran cada mes${showNew ? " y cuántos por primera vez" : ""}${hasBefore ? `, con ${period.baseCompareShort} en gris` : ""}${!ctx.detail.customers && filters.company === null ? " (suma de sociedades)" : ""}. Pulsa un mes para ver sus clientes`}
          className="panel chart-panel sales-board-wide"
        >
          {monthly.failed ? <LoadFailed what="los clientes por mes" /> : (
            <TrendChart
              data={points}
              series={[
                ...(hasBefore ? [{ key: "anterior", label: period.baseCompareShort ?? "", color: "#cbd5e1" }] : []),
                { key: "activos", label: "Con compra", color: "#0ea5e9" },
                ...(showNew ? [{ key: "nuevos", label: "Nuevos", color: "#10b981" }] : []),
              ]}
              ariaLabel={`Clientes por mes en ${period.baseLabel}`}
              onSelect={(index) => ctx.toggle("month", monthKeys[index] ?? null)}
              selectedIndex={selectedMonthIndex >= 0 ? selectedMonthIndex : null}
            />
          )}
          {!ctx.detail.customers && (filters.channel || filters.repKey || filters.family) ? (
            <p className="sales-section-note">Estos totales no se pueden partir por canal, comercial ni familia: son de la sociedad entera.</p>
          ) : null}
        </Panel>

        <Panel
          title="Mes a mes"
          subtitle={showNew ? "Clientes con compra y, a la derecha, cuántos son nuevos. Pulsa uno para filtrar" : "Clientes con compra. Pulsa uno para filtrar"}
          className="panel panel-padded sales-board-narrow"
        >
          <RankList
            items={monthKeys.map((key, index) => ({
              key,
              label: (period.multiYear ? monthWithYear(key) : monthName(key)).replace(/^./, (letter) => letter.toUpperCase()),
              value: points[index].activos,
              valueLabel: numberFormatter.format(points[index].activos),
              extra: newTrusted(key) ? `+${numberFormatter.format(points[index].nuevos)}` : "",
            })).reverse()}
            activeKey={filters.month}
            onSelect={(key) => ctx.toggle("month", key)}
            empty="Sin clientes en este periodo."
          />
        </Panel>

        {ctx.detail.customers ? (
          <Panel
            title={`Mejores clientes de ${periodName}`}
            subtitle="Por venta en el periodo, con los filtros puestos. Dto.: rebaja sobre tarifa"
            trailing={<button type="button" className="sales-chip sales-chip-pick" onClick={() => open("activos", `Clientes con compra en ${periodName}`, "Todos los que han comprado en el periodo, de más a menos venta.")}>Ver todos con teléfono</button>}
            className="panel table-panel sales-board-full"
          >
            {top.failed ? <LoadFailed what="los mejores clientes" /> : (
              <DataTable
                rows={(top.data ?? []).slice(0, 200)}
                columns={topColumns}
                rowKey={(row) => `${row.company_code}-${row.customer_code}`}
                onRowClick={(row) => ctx.openCustomer({ company_code: row.company_code, customer_code: row.customer_code, name: row.trade_name || row.name })}
                initialSort={{ key: "compra", desc: true }}
                limit={15}
                empty={top.loading ? "Cargando…" : "Ningún cliente con compra con estos filtros."}
              />
            )}
          </Panel>
        ) : null}
        {ctx.detail.customers ? <SegmentsPanel ctx={ctx} periodName={periodName} /> : null}
      </section>

      {ctx.detail.customers && counts.data ? (
        <p className="sales-section-note">
          <ConversionIcon /> Concentración: los 10 mejores clientes suman {share((top.data ?? []).slice(0, 10).reduce((sum, row) => sum + Number(row.net_amount), 0), counts.data.neto_activos)} de la venta a clientes del periodo.
        </p>
      ) : null}
    </div>
  );
}
