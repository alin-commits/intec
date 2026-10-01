"use client";

import { useMemo, useState, type ReactNode } from "react";
import { TrendChart } from "@/components/charts/trend-chart";
import { Modal } from "@/components/ui/modal";
import { offerState, orderState, purchaseRhythm, type OfferState, type OrderState } from "@/lib/customer-sheet";
import { formatPercent, numberFormatter } from "@/lib/format";
import {
  bucketDiscount,
  bucketMargin,
  channelLabel,
  euros,
  groupRows,
  monthLabel,
  noFilters,
  sumRows,
  tenths,
  ticketFormatter,
  variation,
  yearlyView,
  type Bucket,
  type SummaryRow,
} from "@/lib/sales-model";
import { addDays, dateKey, monthsBetween, shortRange } from "@/lib/sales-period";
import { createClient } from "@/lib/supabase/client";
import { fetchAllPages } from "@/lib/supabase/fetch-all";
import type { CustomerRef, SalesContext } from "./sales-context";
import { DataTable, LoadFailed, shortDate, useSageQuery, type Column } from "./sales-ui";

/*
  La ficha de un cliente: quién es y a quién llamar, cuánto compra y cómo va
  (mes a mes o un año contra otro), qué familias compra y cuáles ha dejado,
  y sus pedidos y ofertas con cómo está cada uno.

  Es todo lo que compra el cliente, sin los filtros del panel (canal,
  comercial, familia): al mirar a un cliente se le quiere ver entero. Del
  panel solo toma el periodo y con qué se compara.
*/

type CustomerInfo = {
  name: string;
  trade_name: string | null;
  rep_code: number | null;
  province: string | null;
  municipality: string | null;
  activity: string | null;
  phone: string | null;
  email: string | null;
  created_on: string | null;
  payment_method: string | null;
  is_blocked: boolean | null;
  left_on: string | null;
  leave_reason: string | null;
};
type Contact = { position: number; name: string | null; phone: string | null; phone2: string | null; phone3: string | null; email: string | null; is_commercial: boolean | null };
type DayRow = { id: number; day: string; series: string; rep_code: number | null; documents: number; net_amount: number; cost_amount: number; net_without_cost: number; gross_amount: number | null };
type FamilyMonth = { id: number; month: string; family_code: string; net_amount: number; gross_amount: number | null };
type Order = {
  year: number; series: string; number: number; order_date: string; needed_on: string | null; first_delivery_on: string | null;
  rep_code: number | null; net_amount: number; pending_amount: number; from_offer: boolean | null;
};
type Offer = {
  year: number; series: string; number: number; offer_date: string; valid_until: string | null; rep_code: number | null;
  net_amount: number; ordered_amount: number; first_order_on: string | null; reject_reason: string | null; loss_detail: string | null;
};

const orderLabels: Record<OrderState, { label: string; tone: string }> = {
  pendiente: { label: "Por servir", tone: "is-warn" },
  retrasado: { label: "Retrasado", tone: "is-bad" },
  servido: { label: "Servido", tone: "is-good" },
  servido_tarde: { label: "Servido tarde", tone: "is-warn" },
};
const offerLabels: Record<OfferState, { label: string; tone: string }> = {
  convertida: { label: "Convertida", tone: "is-good" },
  viva: { label: "Viva", tone: "is-info" },
  caducada: { label: "Caducada", tone: "is-muted" },
  rechazada: { label: "Rechazada", tone: "is-bad" },
};
const pill = (label: string, tone: string, title?: string) => <span className={`sales-state ${tone}`} title={title}>{label}</span>;
const muted = (text = "—") => <span className="muted">{text}</span>;
/** Un cambio en %, en verde si sube; lo que no se mueve ni una décima, sin color. */
const percent = (raw: number | null): ReactNode => {
  if (raw === null) return null;
  const value = tenths(raw);
  return <span className={value > 0 ? "sales-up" : value < 0 ? "sales-down" : undefined}>{value > 0 ? "+" : ""}{value.toFixed(1).replace(".", ",")} %</span>;
};
const change = (now: number, before: number) => percent(variation(now, before));
const ticketOf = (bucket: Bucket) => (bucket.documents ? bucket.net / bucket.documents : 0);
const phoneLink = (value: string) => <a key={value} href={`tel:${value.replace(/\s+/g, "")}`}>{value}</a>;

function Stat({ label, value, detail, tone }: { label: string; value: ReactNode; detail?: ReactNode; tone?: "bad" }) {
  return (
    <div className={`sales-sheet-stat${tone === "bad" ? " is-bad" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </div>
  );
}

export function CustomerSheet({ customer, ctx, onClose, onBack }: {
  customer: CustomerRef;
  ctx: SalesContext;
  onClose: () => void;
  /** Si se abrió desde una lista, para volver a ella. */
  onBack?: () => void;
}) {
  const [chart, setChart] = useState<"meses" | "anios">("meses");
  const { period } = ctx;
  const company = customer.company_code;
  const code = customer.customer_code;
  const today = dateKey(ctx.today);
  const key = (what: string) => JSON.stringify([what, company, code, ctx.reloadKey]);

  const info = useSageQuery<{ customer: CustomerInfo | null; contacts: Contact[] }>(key("ficha"), async () => {
    const supabase = createClient();
    const [one, people] = await Promise.all([
      supabase.from("sage_customers")
        .select("name, trade_name, rep_code, province, municipality, activity, phone, email, created_on, payment_method, is_blocked, left_on, leave_reason")
        .eq("company_code", company).eq("code", code).maybeSingle(),
      supabase.from("sage_customer_contacts")
        .select("position, name, phone, phone2, phone3, email, is_commercial")
        .eq("company_code", company).eq("customer_code", code).order("position"),
    ]);
    const error = one.error ?? people.error;
    return { data: error ? null : { customer: (one.data as CustomerInfo | null) ?? null, contacts: (people.data ?? []) as Contact[] }, error };
  });
  // Toda su historia de compra, día a día: el cliente más grande pasa de 3.000 filas.
  const history = useSageQuery<DayRow[]>(key("dias"), () => {
    const supabase = createClient();
    return fetchAllPages<DayRow>((start, end) =>
      supabase.from("sage_customer_days")
        .select("id, day, series, rep_code, documents, net_amount, cost_amount, net_without_cost, gross_amount")
        .eq("company_code", company).eq("customer_code", code)
        .order("id").range(start, end));
  });
  const families = useSageQuery<FamilyMonth[]>(key("familias"), () => {
    const supabase = createClient();
    return fetchAllPages<FamilyMonth>((start, end) =>
      supabase.from("sage_customer_families_monthly")
        .select("id, month, family_code, net_amount, gross_amount")
        .eq("company_code", company).eq("customer_code", code)
        .order("id").range(start, end));
  });
  const orders = useSageQuery<Order[]>(ctx.detail.orders ? key("pedidos") : null, () => {
    const supabase = createClient();
    return fetchAllPages<Order>((start, end) =>
      supabase.from("sage_order_documents")
        .select("year, series, number, order_date, needed_on, first_delivery_on, rep_code, net_amount, pending_amount, from_offer")
        .eq("company_code", company).eq("customer_code", code)
        .order("order_date", { ascending: false }).order("year").order("series").order("number")
        .range(start, end));
  });
  const offers = useSageQuery<Offer[]>(ctx.detail.offers ? key("ofertas") : null, () => {
    const supabase = createClient();
    return fetchAllPages<Offer>((start, end) =>
      supabase.from("sage_offer_documents")
        .select("year, series, number, offer_date, valid_until, rep_code, net_amount, ordered_amount, first_order_on, reject_reason, loss_detail")
        .eq("company_code", company).eq("customer_code", code)
        .order("offer_date", { ascending: false }).order("year").order("series").order("number")
        .range(start, end));
  });

  // ---- Lo que compra ----
  // Cada día hace de "mes" para sumar con las mismas reglas que el panel (el
  // coste solo cuenta desde el cambio de series, el descuento solo con bruto).
  const rows = useMemo<SummaryRow[]>(() => (history.data ?? []).map((row) => ({
    month: row.day,
    company_code: company,
    series: row.series,
    rep_code: row.rep_code,
    documents: Number(row.documents),
    net_amount: Number(row.net_amount),
    cost_amount: Number(row.cost_amount),
    net_without_cost: Number(row.net_without_cost),
    gross_amount: row.gross_amount === null ? 0 : Number(row.gross_amount),
    gross_net: row.gross_amount === null ? 0 : Number(row.net_amount),
  })), [history.data, company]);
  const within = (range: { from: string; to: string }) => rows.filter((row) => row.month >= range.from && row.month <= range.to);
  const now = sumRows(within(period));
  const before = period.compare ? sumRows(within(period.compare)) : null;
  const lastYear = sumRows(within({ from: addDays(today, -364), to: today }));
  const yearBefore = sumRows(within({ from: addDays(today, -729), to: addDays(today, -365) }));
  const rhythm = purchaseRhythm(rows.map((row) => row.month), today);
  const margin = bucketMargin(now);
  const discount = bucketDiscount(now);

  // ---- La evolución: desde su primera compra que haya en Sage hasta hoy ----
  const chartView = (() => {
    if (rows.length === 0) return null;
    const first = rows.reduce((min, row) => (row.month < min ? row.month : min), rows[0].month);
    const months = monthsBetween(first, today);
    const monthly = groupRows(rows, (row) => row.month.slice(0, 7));
    const multiYear = months[0].slice(0, 4) !== months[months.length - 1].slice(0, 4);
    const points = months.map((month) => ({ label: monthLabel(month, multiYear), compra: Math.round(monthly.get(month)?.net ?? 0) }));
    const years = yearlyView({
      rows: rows.map((row) => ({ ...row, month: row.month.slice(0, 7) })),
      filters: noFilters,
      repOf: ctx.repOf,
      months,
      basePartial: true,
    });
    return { points, years, months };
  })();

  // ---- Familias del periodo, y las que compraba y ya no ----
  const familyView = (() => {
    const inRange = (range: { from: string; to: string }) => (row: FamilyMonth) => row.month >= `${range.from.slice(0, 7)}-01` && row.month <= range.to;
    const nowByFamily = groupFamily((families.data ?? []).filter(inRange(period)));
    const beforeByFamily = period.compare ? groupFamily((families.data ?? []).filter(inRange(period.compare))) : new Map<string, number>();
    const total = [...nowByFamily.values()].reduce((sum, value) => sum + Math.max(value, 0), 0);
    const list = [...nowByFamily].map(([familyCode, net]) => ({ code: familyCode, name: ctx.familyName(familyCode), net, before: beforeByFamily.get(familyCode) ?? 0 }))
      .sort((a, b) => b.net - a.net);
    const dropped = [...beforeByFamily]
      .filter(([familyCode, net]) => net > 0 && (nowByFamily.get(familyCode) ?? 0) <= 0)
      .sort((a, b) => b[1] - a[1])
      .map(([familyCode, net]) => ({ name: ctx.familyName(familyCode), net }));
    return { list, total, dropped };
  })();

  // ---- Pedidos y ofertas ----
  const orderList = orders.data ?? [];
  const inPeriod = (day: string) => day >= period.from && day <= period.to;
  const periodOrders = orderList.filter((order) => inPeriod(order.order_date));
  const pending = orderList.filter((order) => Number(order.pending_amount) > 0);
  const late = orderList.filter((order) => orderState(order, today) === "retrasado");
  const offerList = offers.data ?? [];
  const periodOffers = offerList.filter((offer) => inPeriod(offer.offer_date));
  const converted = periodOffers.filter((offer) => offerState(offer, today).state === "convertida").length;
  const alive = offerList.filter((offer) => offerState(offer, today).state === "viva");

  const orderColumns: Column<Order>[] = [
    { key: "fecha", header: "Fecha", text: true, render: (row) => shortDate(row.order_date), sort: (row) => row.order_date },
    { key: "pedido", header: "Pedido", text: true, render: (row) => (
      <span className="sales-article"><strong>{row.series}/{row.number}</strong><small>{channelLabel(row.series)}{row.from_offer ? " · desde oferta" : ""}</small></span>
    ), sort: (row) => `${row.year}-${row.series}-${String(row.number).padStart(8, "0")}` },
    { key: "importe", header: "Importe", render: (row) => euros(Number(row.net_amount)), sort: (row) => Number(row.net_amount) },
    { key: "pendiente", header: "Por servir", optional: true, render: (row) => (Number(row.pending_amount) > 0 ? euros(Number(row.pending_amount)) : muted()), sort: (row) => Number(row.pending_amount) },
    { key: "estado", header: "Estado", text: true, render: (row) => { const state = orderLabels[orderState(row, today)]; return pill(state.label, state.tone); }, sort: (row) => orderState(row, today) },
    { key: "para", header: "Para el", optional: true, render: (row) => shortDate(row.needed_on), sort: (row) => row.needed_on ?? "" },
  ];
  const offerColumns: Column<Offer>[] = [
    { key: "fecha", header: "Fecha", text: true, render: (row) => shortDate(row.offer_date), sort: (row) => row.offer_date },
    { key: "oferta", header: "Oferta", text: true, render: (row) => <strong>{row.series}/{row.number}</strong>, sort: (row) => `${row.year}-${row.series}-${String(row.number).padStart(8, "0")}` },
    { key: "importe", header: "Importe", render: (row) => euros(Number(row.net_amount)), sort: (row) => Number(row.net_amount) },
    { key: "estado", header: "Estado", text: true, render: (row) => {
      const { state, reason } = offerState(row, today);
      return pill(state === "rechazada" && reason ? `Rechazada: ${reason}` : offerLabels[state].label, offerLabels[state].tone, reason || undefined);
    }, sort: (row) => offerState(row, today).state },
    { key: "validez", header: "Válida hasta", optional: true, render: (row) => shortDate(row.valid_until), sort: (row) => row.valid_until ?? "" },
  ];
  type FamilyLine = (typeof familyView.list)[number];
  const familyColumns: Column<FamilyLine>[] = [
    { key: "familia", header: "Familia", text: true, render: (row) => row.name, sort: (row) => row.name },
    { key: "compra", header: "Compra", render: (row) => euros(row.net), sort: (row) => row.net },
    { key: "peso", header: "Peso", optional: true, render: (row) => (familyView.total > 0 ? formatPercent((Math.max(row.net, 0) / familyView.total) * 100) : "—"), sort: (row) => row.net },
    ...(period.compare
      ? [{ key: "antes", header: `vs ${period.compareShort}`, render: (row: FamilyLine) => change(row.net, row.before) ?? muted(), sort: (row: FamilyLine) => variation(row.net, row.before) ?? -Infinity }]
      : []),
  ];

  const data = info.data?.customer ?? null;
  const title = data ? data.trade_name || data.name : customer.name || `Cliente ${code}`;
  const companyName = ctx.companies.find((item) => item.code === company)?.name ?? `Sociedad ${company}`;
  const rep = data?.rep_code !== null && data?.rep_code !== undefined ? ctx.repOf(company, data.rep_code).label : null;
  const contacts = (info.data?.contacts ?? []).filter((contact) => contact.name || contact.phone || contact.email);
  const loading = history.loading && !history.data;

  return (
    <Modal open large title={title} eyebrow={`Cliente ${code} · ${companyName}`} onClose={onClose} scrollInside>
      <div className="sales-sheet">
        {onBack ? <button type="button" className="sales-chip sales-chip-clear sales-sheet-back" onClick={onBack}>← Volver a la lista</button> : null}

        <div className="sales-sheet-top">
          <section className="sales-sheet-info" aria-label="Datos del cliente">
            {info.failed ? <LoadFailed what="los datos del cliente" /> : (
              <dl>
                {data?.trade_name && data.trade_name !== data.name ? <><dt>Razón social</dt><dd>{data.name}</dd></> : null}
                <dt>Dónde</dt><dd>{[data?.municipality, data?.province].filter(Boolean).join(", ") || "—"}</dd>
                {data?.activity ? <><dt>Actividad</dt><dd>{data.activity}</dd></> : null}
                <dt>Comercial</dt><dd>{rep ?? "—"}</dd>
                {data?.payment_method ? <><dt>Forma de pago</dt><dd>{data.payment_method}</dd></> : null}
                {data?.phone || data?.email ? (
                  <><dt>Cliente</dt><dd className="sales-contact">{data.phone ? phoneLink(data.phone) : null}{data.email ? <a href={`mailto:${data.email}`}>{data.email}</a> : null}</dd></>
                ) : null}
                {contacts.length > 0 ? (
                  <>
                    <dt>A quién llamar</dt>
                    <dd>
                      <ul className="sales-sheet-contacts">
                        {contacts.slice(0, 4).map((contact) => {
                          const phones = [contact.phone, contact.phone2, contact.phone3].filter((value): value is string => Boolean(value));
                          return (
                            <li key={contact.position} className="sales-contact">
                              <strong>{contact.name ?? "Sin nombre"}{contact.is_commercial ? <small> · comercial</small> : null}</strong>
                              {phones.map(phoneLink)}
                              {contact.email ? <a href={`mailto:${contact.email}`}>{contact.email}</a> : null}
                            </li>
                          );
                        })}
                      </ul>
                    </dd>
                  </>
                ) : null}
                {data?.created_on ? <><dt>Alta en Sage</dt><dd>{shortDate(data.created_on)}</dd></> : null}
                {data?.is_blocked ? <><dt>En Sage</dt><dd className="sales-down">Bloqueado para albaranes o pedidos</dd></> : null}
                {data?.left_on ? <><dt>Baja</dt><dd className="sales-down">{shortDate(data.left_on)}{data.leave_reason ? ` · ${data.leave_reason}` : ""}</dd></> : null}
              </dl>
            )}
          </section>

          <section className="sales-sheet-stats" aria-label="Cifras del cliente">
            {history.failed ? <LoadFailed what="la compra del cliente" /> : (
              <>
                <Stat
                  label={`Compra en ${ctx.periodName}`}
                  value={loading ? "…" : euros(now.net)}
                  detail={before ? <>{change(now.net, before.net) ?? "—"} frente a {period.compareShort} ({euros(before.net)})</> : "sin comparar"}
                />
                <Stat
                  label="Últimos 12 meses"
                  value={loading ? "…" : euros(lastYear.net)}
                  detail={<>{change(lastYear.net, yearBefore.net) ?? "—"} frente a los 12 anteriores</>}
                />
                <Stat
                  label="Última compra"
                  value={rhythm ? shortDate(rhythm.last) : loading ? "…" : "Nunca"}
                  detail={rhythm ? `hace ${numberFormatter.format(rhythm.daysSinceLast)} días${rhythm.late ? ", más del doble de lo normal" : ""}` : undefined}
                  tone={rhythm?.late ? "bad" : undefined}
                />
                <Stat
                  label="Cada cuánto compra"
                  value={rhythm?.every ? `Cada ${numberFormatter.format(Math.round(rhythm.every))} días` : loading ? "…" : "Poco"}
                  detail={rhythm ? `${numberFormatter.format(rhythm.purchaseDaysLastYear)} días con compra en el último año` : undefined}
                />
                <Stat label="Albaranes" value={numberFormatter.format(now.documents)} detail={`ticket medio ${ticketFormatter.format(ticketOf(now))}`} />
                <Stat
                  label="Descuento medio"
                  value={discount ? formatPercent(discount.percent) : "—"}
                  detail={margin ? `margen ${formatPercent(margin.percent)}` : "sobre tarifa"}
                />
                {ctx.detail.orders ? (
                  <Stat
                    label="Por servir ahora"
                    value={orders.data ? euros(pending.reduce((sum, order) => sum + Number(order.pending_amount), 0)) : "…"}
                    detail={orders.data ? `${numberFormatter.format(pending.length)} pedidos${late.length ? `, ${numberFormatter.format(late.length)} retrasados` : ""}` : undefined}
                    tone={late.length ? "bad" : undefined}
                  />
                ) : null}
                <Stat label="Primera compra en Sage" value={rhythm ? shortDate(rhythm.first) : "—"} detail="hay datos desde agosto de 2022" />
              </>
            )}
          </section>
        </div>

        <section className="sales-sheet-section">
          <div className="sales-sheet-heading">
            <div>
              <h3>Evolución de compra</h3>
              <p className="muted">{chart === "meses" ? "Lo que compra cada mes, desde su primera compra en Sage" : "Cada año en una línea, mes a mes"}</p>
            </div>
            <div className="sales-switch" role="group" aria-label="Cómo ver la evolución">
              <button type="button" className={chart === "meses" ? "is-active" : undefined} onClick={() => setChart("meses")} aria-pressed={chart === "meses"}>Mes a mes</button>
              <button type="button" className={chart === "anios" ? "is-active" : undefined} onClick={() => setChart("anios")} aria-pressed={chart === "anios"}>Año contra año</button>
            </div>
          </div>
          {loading ? <p className="muted">Cargando…</p> : !chartView ? <p className="muted">Este cliente no tiene compras en Sage.</p> : chart === "meses" ? (
            <TrendChart data={chartView.points} series={[{ key: "compra", label: "Compra", color: "#4f46e5" }]} ariaLabel={`Compra mensual de ${title}`} />
          ) : (
            <>
              <TrendChart data={chartView.years.points} series={chartView.years.series} ariaLabel={`Compra de ${title}, un año contra otro`} />
              <ul className="sales-sheet-years">
                {[...chartView.years.table].reverse().map((row) => (
                  <li key={row.year}>
                    <strong>{row.year}</strong>
                    <span>{euros(row.bucket.net)}</span>
                    <small>{row.change !== null ? <>{percent(row.change)}{row.span ? ` (${row.span})` : ""}</> : row.complete ? "" : `${row.months} meses`}</small>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section className="sales-sheet-section">
          <div className="sales-sheet-heading">
            <div>
              <h3>Qué compra en {ctx.periodName}</h3>
              <p className="muted">Por familia, sin IVA</p>
            </div>
          </div>
          {families.failed ? <LoadFailed what="las familias" /> : (
            <DataTable
              rows={familyView.list}
              columns={familyColumns}
              rowKey={(row) => row.code}
              initialSort={{ key: "compra", desc: true }}
              limit={8}
              empty={families.loading ? "Cargando…" : "No compró nada en este periodo."}
            />
          )}
          {familyView.dropped.length > 0 ? (
            <p className="sales-sheet-dropped">
              <strong>Ha dejado de comprar</strong> {familyView.dropped.slice(0, 5).map((item) => `${item.name} (${euros(item.net)})`).join(", ")}
              {familyView.dropped.length > 5 ? ` y ${familyView.dropped.length - 5} familias más` : ""}, que sí compraba en {period.compareShort}.
            </p>
          ) : null}
        </section>

        <div className="sales-sheet-two">
          <section className="sales-sheet-section">
            <div className="sales-sheet-heading">
              <div>
                <h3>Pedidos</h3>
                <p className="muted">
                  {orders.data
                    ? `${numberFormatter.format(periodOrders.length)} en ${ctx.periodName} por ${euros(periodOrders.reduce((sum, order) => sum + Number(order.net_amount), 0))}. Los más recientes primero`
                    : "Los más recientes primero"}
                </p>
              </div>
            </div>
            {!ctx.detail.orders ? <p className="muted">Los pedidos llegarán con la próxima lectura completa de Sage.</p>
              : orders.failed ? <LoadFailed what="los pedidos" /> : (
                <DataTable
                  rows={orderList}
                  columns={orderColumns}
                  rowKey={(row) => `${row.year}-${row.series}-${row.number}`}
                  initialSort={{ key: "fecha", desc: true }}
                  limit={8}
                  empty={orders.loading ? "Cargando…" : "Ningún pedido en Sage (hay pedidos desde mayo de 2025)."}
                />
              )}
          </section>

          <section className="sales-sheet-section">
            <div className="sales-sheet-heading">
              <div>
                <h3>Ofertas</h3>
                <p className="muted">
                  {offers.data
                    ? `${numberFormatter.format(periodOffers.length)} en ${ctx.periodName}${periodOffers.length ? `, ${formatPercent((converted / periodOffers.length) * 100)} pasan a pedido` : ""}${alive.length ? ` · ${numberFormatter.format(alive.length)} vivas por ${euros(alive.reduce((sum, offer) => sum + Number(offer.net_amount), 0))}` : ""}`
                    : "Las más recientes primero"}
                </p>
              </div>
            </div>
            {!ctx.detail.offers ? <p className="muted">Las ofertas llegarán con la próxima lectura completa de Sage.</p>
              : offers.failed ? <LoadFailed what="las ofertas" /> : (
                <DataTable
                  rows={offerList}
                  columns={offerColumns}
                  rowKey={(row) => `${row.year}-${row.series}-${row.number}`}
                  initialSort={{ key: "fecha", desc: true }}
                  limit={8}
                  empty={offers.loading ? "Cargando…" : "Ninguna oferta en Sage (hay ofertas desde octubre de 2025)."}
                />
              )}
          </section>
        </div>

        <p className="sales-section-note">
          Es todo lo que compra el cliente, sin los filtros del panel. Periodo: {shortRange(period.from, period.to)}
          {period.compare ? `, comparado con ${shortRange(period.compare.from, period.compare.to)}` : ""}.
        </p>
      </div>
    </Modal>
  );
}

function groupFamily(list: FamilyMonth[]) {
  const map = new Map<string, number>();
  for (const row of list) map.set(row.family_code, (map.get(row.family_code) ?? 0) + Number(row.net_amount));
  return map;
}
