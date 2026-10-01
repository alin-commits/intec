"use client";

import { useState, type ReactNode } from "react";
import { Modal } from "@/components/ui/modal";
import { downloadCsv, type CsvColumn } from "@/lib/csv-export";
import { numberFormatter } from "@/lib/format";
import { channelLabel, euros } from "@/lib/sales-model";
import { createClient } from "@/lib/supabase/client";
import { lostCustomers, type ListRequest, type SalesContext } from "./sales-context";
import { DataTable, LoadFailed, shortDate, useSageQuery, type Column } from "./sales-ui";

/*
  La lista que hay detrás de una cifra: los clientes nuevos, los que han
  dejado de comprar, las ofertas vivas... Con buscador, orden por columnas,
  teléfono y correo a un clic, y descarga para Excel.
*/

export type CustomerRow = {
  company_code: number;
  customer_code: string;
  name: string;
  trade_name: string | null;
  phone: string | null;
  email: string | null;
  province: string | null;
  municipality: string | null;
  rep_code: number | null;
  first_purchase: string | null;
  last_purchase: string | null;
  net_amount: number;
  documents: number;
  days_since_last: number | null;
  /** La persona a la que llamar: el contacto comercial del cliente en Sage, o el primero con teléfono. */
  contact_name?: string | null;
  contact_phone?: string | null;
  contact_email?: string | null;
  /** El bruto y el neto de lo que lo trae, para el descuento de cada cliente. */
  gross_amount?: number;
  gross_net?: number;
};
type OfferRow = {
  company_code: number; year: number; series: string; number: number; offer_date: string; valid_until: string | null;
  customer_code: string | null; customer_name: string | null; rep_code: number | null; net_amount: number; ordered_amount: number;
  first_order_on: string | null; reason: string;
};
type OrderRow = {
  company_code: number; year: number; series: string; number: number; order_date: string; needed_on: string | null;
  customer_code: string | null; customer_name: string | null; rep_code: number | null; net_amount: number; pending_amount: number;
  first_delivery_on: string | null; from_offer: boolean;
};
type AnyRow = CustomerRow | OfferRow | OrderRow;

const plain = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function SalesListModal({ request, ctx, onClose, hidden = false }: {
  request: ListRequest | null;
  ctx: SalesContext;
  onClose: () => void;
  /** Mientras se ve la ficha de un cliente: la lista sigue viva (con su búsqueda) para volver a ella. */
  hidden?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [lastRequest, setLastRequest] = useState<ListRequest | null>(request);
  // Una lista nueva empieza sin búsqueda.
  if (lastRequest !== request) {
    setLastRequest(request);
    setSearch("");
  }

  const { period, rpc } = ctx;
  const base = { p_from: period.from, p_to: period.to, p_company: rpc.p_company, p_reps: rpc.p_reps, p_series: rpc.p_series };
  const args = request?.type === "clientes"
    ? { ...base, p_kind: request.kind, p_family: rpc.p_family, p_days: request.days ?? 30 }
    : request ? { ...base, p_kind: request.kind } : null;
  const fn = request?.type === "clientes" ? "sage_customer_list" : request?.type === "ofertas" ? "sage_offer_list" : "sage_order_list";
  const key = request && args ? JSON.stringify([fn, args, ctx.reloadKey]) : null;
  const result = useSageQuery<AnyRow[]>(key, async () => await createClient().rpc(fn, args ?? {}));

  if (!request || hidden) return null;
  // Pulsar una fila abre la ficha de su cliente.
  const openCustomer = (row: { company_code: number; customer_code: string | null; name?: string | null; customer_name?: string | null }) => {
    if (row.customer_code) ctx.openCustomer({ company_code: row.company_code, customer_code: row.customer_code, name: row.name ?? row.customer_name ?? null });
  };

  const rep = (company: number, code: number | null) => (code === null ? "—" : ctx.repOf(company, code).label);
  const company = (code: number) => ctx.companies.find((item) => item.code === code)?.name ?? String(code);
  const rows = result.loading ? [] : result.data ?? [];
  const query = plain(search.trim());
  const text = (row: AnyRow) => {
    if (request.type === "clientes") {
      const customer = row as CustomerRow;
      return [customer.name, customer.trade_name, customer.customer_code, customer.municipality, customer.province, customer.phone, customer.email,
        customer.contact_name, customer.contact_phone, customer.contact_email, rep(customer.company_code, customer.rep_code)].join(" ");
    }
    const doc = row as OfferRow | OrderRow;
    return [doc.customer_name, doc.customer_code, `${doc.series}${doc.number}`, "reason" in doc ? doc.reason : "", rep(doc.company_code, doc.rep_code)].join(" ");
  };
  const visible = query ? rows.filter((row) => plain(text(row)).includes(query)) : rows;
  const amountOf = (row: AnyRow) => {
    if (request.type === "pedidos" && request.kind === "pendientes") return Number((row as OrderRow).pending_amount);
    return Number(row.net_amount);
  };
  const totalAmount = visible.reduce((sum, row) => sum + amountOf(row), 0);
  const multiCompany = new Set(rows.map((row) => row.company_code)).size > 1;

  let table: ReactNode;
  let csv: () => void;
  const filename = `${request.title.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}.csv`;

  if (request.type === "clientes") {
    const list = visible as CustomerRow[];
    const columns: Column<CustomerRow>[] = [
      { key: "cliente", header: "Cliente", text: true, render: (row) => (
        <span className="sales-article">
          <strong>{row.trade_name || row.name}</strong>
          <small>{[row.trade_name ? row.name : null, row.customer_code, multiCompany ? company(row.company_code) : null].filter(Boolean).join(" · ")}</small>
        </span>
      ), sort: (row) => row.trade_name || row.name },
      { key: "contacto", header: "Contacto", text: true, render: (row) => {
        // Primero la persona (con su teléfono directo) y luego los datos generales del
        // cliente, sin repetir el mismo número dos veces.
        const phones = [row.contact_phone, row.phone].filter((value, index, list): value is string => Boolean(value) && list.indexOf(value) === index);
        const email = row.contact_email || row.email;
        return (
          <span className="sales-contact">
            {row.contact_name ? <strong>{row.contact_name}</strong> : null}
            {phones.map((value) => <a key={value} href={`tel:${value.replace(/\s+/g, "")}`} onClick={(event) => event.stopPropagation()}>{value}</a>)}
            {email ? <a href={`mailto:${email}`} onClick={(event) => event.stopPropagation()}>{email}</a> : null}
            {!row.contact_name && phones.length === 0 && !email ? <span className="muted">Sin datos</span> : null}
          </span>
        );
      } },
      { key: "zona", header: "Zona", text: true, optional: true, render: (row) => [row.municipality, row.province].filter(Boolean).join(", ") || "—", sort: (row) => row.province ?? "" },
      { key: "comercial", header: "Comercial", text: true, optional: true, render: (row) => rep(row.company_code, row.rep_code), sort: (row) => rep(row.company_code, row.rep_code) },
      { key: "compra", header: request.kind === "perdidos" ? `En ${lostCustomers(ctx.period).previous}` : request.kind === "sin_compra" ? "Último año" : "Compra", render: (row) => euros(Number(row.net_amount)), sort: (row) => Number(row.net_amount) },
      { key: "ultima", header: "Última", render: (row) => (
        <span className="sales-article">
          <strong>{shortDate(row.last_purchase)}</strong>
          {row.days_since_last !== null ? <small>hace {numberFormatter.format(row.days_since_last)} días</small> : null}
        </span>
      ), sort: (row) => row.last_purchase ?? "" },
    ];
    table = <DataTable rows={list} columns={columns} rowKey={(row) => `${row.company_code}-${row.customer_code}`} onRowClick={openCustomer} initialSort={{ key: "compra", desc: true }} limit={100} empty={result.loading ? "Cargando…" : "Nadie con estos filtros."} />;
    const csvColumns: CsvColumn<CustomerRow>[] = [
      { header: "Sociedad", value: (row) => company(row.company_code) },
      { header: "Código", value: (row) => row.customer_code },
      { header: "Cliente", value: (row) => row.name },
      { header: "Nombre comercial", value: (row) => row.trade_name },
      { header: "Teléfono", value: (row) => row.phone },
      { header: "Correo", value: (row) => row.email },
      { header: "Persona de contacto", value: (row) => row.contact_name ?? null },
      { header: "Teléfono de contacto", value: (row) => row.contact_phone ?? null },
      { header: "Correo de contacto", value: (row) => row.contact_email ?? null },
      { header: "Municipio", value: (row) => row.municipality },
      { header: "Provincia", value: (row) => row.province },
      { header: "Comercial", value: (row) => rep(row.company_code, row.rep_code) },
      { header: "Primera compra", value: (row) => row.first_purchase },
      { header: "Última compra", value: (row) => row.last_purchase },
      { header: "Días sin comprar", value: (row) => row.days_since_last },
      { header: "Importe", value: (row) => Number(row.net_amount) },
      { header: "Albaranes", value: (row) => Number(row.documents) },
    ];
    csv = () => downloadCsv(filename, list, csvColumns);
  } else if (request.type === "ofertas") {
    const list = visible as OfferRow[];
    const columns: Column<OfferRow>[] = [
      { key: "oferta", header: "Oferta", text: true, render: (row) => (
        <span className="sales-article">
          <strong>{row.customer_name ?? row.customer_code ?? "Sin cliente"}</strong>
          <small>{row.series}/{row.number} · {channelLabel(row.series)}{multiCompany ? ` · ${company(row.company_code)}` : ""}</small>
        </span>
      ), sort: (row) => row.customer_name ?? "" },
      { key: "fecha", header: "Fecha", render: (row) => shortDate(row.offer_date), sort: (row) => row.offer_date },
      { key: "validez", header: "Válida hasta", optional: true, render: (row) => shortDate(row.valid_until), sort: (row) => row.valid_until ?? "" },
      { key: "comercial", header: "Comercial", text: true, optional: true, render: (row) => rep(row.company_code, row.rep_code), sort: (row) => rep(row.company_code, row.rep_code) },
      { key: "importe", header: "Importe", render: (row) => euros(Number(row.net_amount)), sort: (row) => Number(row.net_amount) },
      request.kind === "rechazadas"
        ? { key: "motivo", header: "Motivo", text: true, render: (row) => row.reason || "—", sort: (row) => row.reason }
        : { key: "pedido", header: "Pedido", render: (row) => (Number(row.ordered_amount) > 0 ? `${euros(Number(row.ordered_amount))} · ${shortDate(row.first_order_on)}` : <span className="muted">—</span>), sort: (row) => Number(row.ordered_amount) },
    ];
    table = <DataTable rows={list} columns={columns} rowKey={(row) => `${row.company_code}-${row.year}-${row.series}-${row.number}`} onRowClick={openCustomer} initialSort={{ key: "importe", desc: true }} limit={100} empty={result.loading ? "Cargando…" : "Ninguna oferta con estos filtros."} />;
    csv = () => downloadCsv(filename, list, [
      { header: "Sociedad", value: (row) => company(row.company_code) },
      { header: "Serie", value: (row) => row.series },
      { header: "Número", value: (row) => row.number },
      { header: "Fecha", value: (row) => row.offer_date },
      { header: "Válida hasta", value: (row) => row.valid_until },
      { header: "Código cliente", value: (row) => row.customer_code },
      { header: "Cliente", value: (row) => row.customer_name },
      { header: "Comercial", value: (row) => rep(row.company_code, row.rep_code) },
      { header: "Importe", value: (row) => Number(row.net_amount) },
      { header: "Pedido", value: (row) => Number(row.ordered_amount) },
      { header: "Fecha del pedido", value: (row) => row.first_order_on },
      { header: "Motivo", value: (row) => row.reason },
    ]);
  } else {
    const list = visible as OrderRow[];
    const columns: Column<OrderRow>[] = [
      { key: "pedido", header: "Pedido", text: true, render: (row) => (
        <span className="sales-article">
          <strong>{row.customer_name ?? row.customer_code ?? "Sin cliente"}</strong>
          <small>{row.series}/{row.number} · {channelLabel(row.series)}{row.from_offer ? " · desde oferta" : ""}{multiCompany ? ` · ${company(row.company_code)}` : ""}</small>
        </span>
      ), sort: (row) => row.customer_name ?? "" },
      { key: "fecha", header: "Fecha", render: (row) => shortDate(row.order_date), sort: (row) => row.order_date },
      { key: "pedida", header: "Para el", optional: true, render: (row) => shortDate(row.needed_on), sort: (row) => row.needed_on ?? "" },
      { key: "servido", header: "Servido", optional: true, render: (row) => shortDate(row.first_delivery_on), sort: (row) => row.first_delivery_on ?? "" },
      { key: "comercial", header: "Comercial", text: true, optional: true, render: (row) => rep(row.company_code, row.rep_code), sort: (row) => rep(row.company_code, row.rep_code) },
      { key: "importe", header: "Importe", render: (row) => euros(Number(row.net_amount)), sort: (row) => Number(row.net_amount) },
      { key: "pendiente", header: "Pendiente", render: (row) => (Number(row.pending_amount) > 0 ? euros(Number(row.pending_amount)) : <span className="muted">—</span>), sort: (row) => Number(row.pending_amount) },
    ];
    table = <DataTable rows={list} columns={columns} rowKey={(row) => `${row.company_code}-${row.year}-${row.series}-${row.number}`} onRowClick={openCustomer} initialSort={{ key: request.kind === "pendientes" ? "pendiente" : "importe", desc: true }} limit={100} empty={result.loading ? "Cargando…" : "Ningún pedido con estos filtros."} />;
    csv = () => downloadCsv(filename, list, [
      { header: "Sociedad", value: (row) => company(row.company_code) },
      { header: "Serie", value: (row) => row.series },
      { header: "Número", value: (row) => row.number },
      { header: "Fecha", value: (row) => row.order_date },
      { header: "Para el", value: (row) => row.needed_on },
      { header: "Primer albarán", value: (row) => row.first_delivery_on },
      { header: "Código cliente", value: (row) => row.customer_code },
      { header: "Cliente", value: (row) => row.customer_name },
      { header: "Comercial", value: (row) => rep(row.company_code, row.rep_code) },
      { header: "Importe", value: (row) => Number(row.net_amount) },
      { header: "Pendiente", value: (row) => Number(row.pending_amount) },
      { header: "Desde oferta", value: (row) => (row.from_offer ? "Sí" : "No") },
    ]);
  }

  const noun = request.type === "clientes" ? "clientes" : request.type === "ofertas" ? "ofertas" : "pedidos";
  const capped = request.type !== "clientes" && rows.length >= 500;

  return (
    <Modal open title={request.title} eyebrow={`${ctx.companyLabel} · del ${shortDate(period.from)} al ${shortDate(period.to)}`} onClose={onClose} scrollInside>
      <p className="sales-list-intro">{request.description}</p>
      <div className="sales-list-toolbar">
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={request.type === "clientes" ? "Buscar por nombre, población, teléfono…" : "Buscar por cliente, número o motivo…"}
          aria-label="Buscar en la lista"
        />
        <span className="sales-list-count">
          {result.loading ? "Cargando…" : `${numberFormatter.format(visible.length)} ${noun} · ${euros(totalAmount)}`}
        </span>
        <button type="button" className="button button-compact button-secondary" onClick={() => csv()} disabled={result.loading || visible.length === 0}>Descargar Excel</button>
      </div>
      {result.failed ? <LoadFailed what="la lista" /> : table}
      {capped ? <p className="sales-section-note">Se enseñan los 500 de mayor importe.</p> : null}
    </Modal>
  );
}
