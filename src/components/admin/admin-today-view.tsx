"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { KpiCard } from "@/components/kpi-card";
import { CalendarIcon, DocumentIcon, EuroIcon, UsuariosIcon, WalletIcon, XCircleIcon } from "@/components/icons";
import { SageRefreshButton } from "@/components/sage-refresh-button";
import { DataTable, Panel, shortDate, type Column } from "@/components/sales/sales-ui";
import { Modal } from "@/components/ui/modal";
import { PageLoader } from "@/components/ui/page-loader";
import { Toast } from "@/components/ui/toast";
import {
  daysBetween,
  isToChase,
  nextWeek,
  summarizeBanks,
  summarizePayables,
  summarizeReceivables,
  summarizeUninvoiced,
  type BankAccount,
  type BankBalance,
  type CustomerDebt,
  type Payable,
  type Receivable,
  type SupplierDebt,
  type UninvoicedCustomer,
  type UninvoicedNote,
} from "@/lib/admin-today";
import { hasAnyRole, PAYMENTS_ROLES } from "@/lib/constants";
import { downloadCsv } from "@/lib/csv-export";
import { shiftDateKey, todayKey } from "@/lib/dates";
import { currencyFormatter, numberFormatter } from "@/lib/format";
import { SageFreshness } from "@/components/sage-freshness";
import { createClient } from "@/lib/supabase/client";
import { fetchAllPages } from "@/lib/supabase/fetch-all";
import { loadCurrentProfile } from "@/lib/supabase/current-profile";

/*
  Hoy en Administración: lo que hay que atender cada día sin ir a Sage cliente
  por cliente. Arriba, lo importante en grande; debajo, cada lista con quién,
  cuánto, desde cuándo y a quién llamar, y su descarga a Excel.

  Todo sale de lo que manda el agente de Sage; aquí no se escribe nada.
*/

type Tab = "cobros" | "pagos" | "facturar" | "bancos";
const tabs: { key: Tab; label: string }[] = [
  { key: "cobros", label: "Cobros" },
  { key: "pagos", label: "Pagos" },
  { key: "facturar", label: "Sin facturar" },
  { key: "bancos", label: "Bancos" },
];
type ChaseFilter = "vencidos" | "devueltos" | "limite" | "todos";
type PayFilter = "sin_remesa" | "en_remesa" | "semana" | "todos";
type Detail = { kind: "cliente"; customer: CustomerDebt } | { kind: "proveedor"; supplier: SupplierDebt } | { kind: "albaranes"; customer: UninvoicedCustomer };
type Company = { code: number; name: string };
type Rep = { company_code: number; code: number; name: string };
type Data = {
  receivables: Receivable[];
  payables: Payable[];
  uninvoiced: UninvoicedNote[];
  accounts: BankAccount[];
  balances: BankBalance[];
  companies: Company[];
  reps: Rep[];
  /** De qué día es la última foto de cobros y pagos que mandó el agente de Sage. */
  takenOn: string | null;
};

const money = (value: number) => currencyFormatter.format(value);
const muted = (text = "—") => <span className="muted">{text}</span>;
const count = (value: number, one: string, many: string) => `${numberFormatter.format(value)} ${value === 1 ? one : many}`;
const weekday = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" });
const telephone = (value: string | null) => (value ? <a href={`tel:${value.replace(/\s+/g, "")}`} onClick={(event) => event.stopPropagation()}>{value}</a> : null);

export function AdminTodayView() {
  const [stage, setStage] = useState<"loading" | "denied" | "ready" | "failed">("loading");
  const [data, setData] = useState<Data | null>(null);
  // El día de hoy en Madrid, y se vuelve a mirar al volver a la pestaña: si se
  // deja abierta de un día para otro, lo vencido se contaba con el día anterior.
  const [today, setToday] = useState(todayKey);
  useEffect(() => {
    const update = () => setToday(todayKey());
    document.addEventListener("visibilitychange", update);
    window.addEventListener("focus", update);
    return () => {
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("focus", update);
    };
  }, []);
  const [reloadKey, setReloadKey] = useState(0);
  const [tab, setTab] = useState<Tab>("cobros");
  const [chase, setChase] = useState<ChaseFilter>("vencidos");
  const [payFilter, setPayFilter] = useState<PayFilter>("sin_remesa");
  const [onlyPrevious, setOnlyPrevious] = useState(true);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      const profile = await loadCurrentProfile();
      if (!active) return;
      if (!profile || !hasAnyRole(profile.roles, PAYMENTS_ROLES)) {
        setStage("denied");
        return;
      }
      const supabase = createClient();
      // Las funciones devuelven como mucho mil filas por vez: se piden por páginas,
      // ordenadas por columnas que juntas no se repiten. Con solo la fecha, los
      // recibos que vencen el mismo día se repetían o se perdían entre páginas.
      const [receivables, payables, uninvoiced, accounts, balances, companies, reps, snapshot] = await Promise.all([
        fetchAllPages<Receivable>((from, to) => supabase.rpc("admin_receivables").order("due_date").order("company_code").order("customer_code").order("invoice_number").order("invoice_date").order("amount").order("pending").range(from, to)),
        fetchAllPages<Payable>((from, to) => supabase.rpc("admin_payables").order("due_date").order("company_code").order("supplier_code").order("invoice_number").order("invoice_date").order("amount").order("pending").range(from, to)),
        fetchAllPages<UninvoicedNote>((from, to) => supabase.rpc("admin_uninvoiced").order("note_date").order("company_code").order("year").order("series").order("number").range(from, to)),
        supabase.from("sage_bank_accounts").select("company_code, account_code, bank_code, bank_name, description, iban, credit_limit, credit_used"),
        fetchAllPages<BankBalance>((from, to) => supabase.from("sage_bank_balances").select("company_code, account_code, day, balance, movement").order("day").order("company_code").order("account_code").range(from, to)),
        supabase.from("sage_companies").select("code, name").order("code"),
        supabase.from("sage_reps").select("company_code, code, name"),
        supabase.from("sage_open_items").select("taken_on").order("taken_on", { ascending: false }).limit(1),
      ]);
      if (!active) return;
      const failure = receivables.error ?? payables.error ?? uninvoiced.error ?? accounts.error ?? balances.error ?? companies.error ?? reps.error;
      if (failure) {
        console.error("No se pudo cargar Hoy en Administración:", failure);
        setStage("failed");
        return;
      }
      setData({
        receivables: receivables.data,
        payables: payables.data,
        uninvoiced: uninvoiced.data,
        accounts: (accounts.data ?? []) as BankAccount[],
        balances: balances.data,
        companies: (companies.data ?? []) as Company[],
        reps: (reps.data ?? []) as Rep[],
        takenOn: ((snapshot.data ?? [])[0] as { taken_on: string } | undefined)?.taken_on ?? null,
      });
      setStage("ready");
    })();
    return () => { active = false; };
  }, [reloadKey]);

  const receivables = useMemo(() => summarizeReceivables(data?.receivables ?? [], today), [data, today]);
  const payables = useMemo(() => summarizePayables(data?.payables ?? [], today), [data, today]);
  const uninvoiced = useMemo(() => summarizeUninvoiced(data?.uninvoiced ?? [], today), [data, today]);
  const banks = useMemo(() => summarizeBanks(data?.accounts ?? [], data?.balances ?? []), [data]);
  const week = useMemo(() => nextWeek(data?.receivables ?? [], data?.payables ?? [], today), [data, today]);

  const multiCompany = (data?.companies.length ?? 0) > 1;
  const companyName = useCallback((code: number) => data?.companies.find((company) => company.code === code)?.name ?? `Sociedad ${code}`, [data]);
  const repName = useCallback((company: number, code: number | null) => {
    if (code === null) return null;
    return data?.reps.find((rep) => rep.company_code === company && rep.code === code)?.name ?? `Comercial ${code}`;
  }, [data]);

  if (stage === "denied") {
    return (
      <div className="page-stack">
        <section className="panel panel-padded">
          <h2>No tienes acceso a esta página</h2>
          <p>Hoy en Administración la ven Administración y quien administra el Hub.</p>
        </section>
      </div>
    );
  }
  if (stage === "failed") {
    return <div className="page-stack"><section className="panel panel-padded"><h2>No se pudo cargar</h2><p>Recarga la página para intentarlo otra vez.</p></section></div>;
  }
  if (stage === "loading" || !data) return <PageLoader label="Preparando el día de Administración…" />;

  const open = (next: Tab) => { setTab(next); window.requestAnimationFrame(() => document.getElementById("administracion-listas")?.scrollIntoView({ behavior: "smooth", block: "start" })); };
  const companyTag = (code: number) => (multiCompany ? ` · ${companyName(code)}` : "");
  const agentPending = (what: string) => (
    <p className="muted">{what} llega con la copia nueva del agente de Sage. En cuanto la lea, esta lista se rellena sola.</p>
  );

  // ---- Cobros ----
  const chaseRows = receivables.customers.filter((customer) => (
    chase === "vencidos" ? customer.overdue > 0
      : chase === "devueltos" ? customer.returned > 0
        : chase === "limite" ? customer.overLimit !== null
          : customer.exposure > 0
  ));
  const customerColumns: Column<CustomerDebt>[] = [
    { key: "cliente", header: "Cliente", text: true, render: (row) => (
      <span className="sales-article">
        <strong>{row.name}</strong>
        <small>{row.customer_code}{companyTag(row.company_code)}{row.isBlocked ? " · bloqueado en Sage" : ""}</small>
      </span>
    ), sort: (row) => row.name },
    { key: "comercial", header: "Comercial", text: true, optional: true, render: (row) => repName(row.company_code, row.rep_code) ?? muted(), sort: (row) => repName(row.company_code, row.rep_code) ?? "" },
    { key: "contacto", header: "A quién llamar", text: true, render: (row) => {
      const phone = row.contact_phone || row.phone;
      if (!row.contact_name && !phone) return muted("Sin contacto");
      return <span className="sales-contact">{row.contact_name ? <strong>{row.contact_name}</strong> : null}{telephone(phone)}</span>;
    } },
    { key: "vencido", header: "Vencido", render: (row) => (row.overdue > 0 ? money(row.overdue) : muted()), sort: (row) => row.overdue },
    { key: "dias", header: "Días", render: (row) => (row.overdue > 0 ? <span className={row.oldestDays > 90 ? "sales-down" : undefined}>{numberFormatter.format(row.oldestDays)}</span> : muted()), sort: (row) => row.oldestDays },
    { key: "devuelto", header: "Devuelto", optional: true, render: (row) => (row.returned > 0 ? <span className="sales-down">{money(row.returned)}</span> : muted()), sort: (row) => row.returned },
    { key: "riesgo", header: "Debe / límite", optional: true, render: (row) => (
      row.creditLimit ? <span className={row.overLimit !== null ? "sales-down" : undefined}>{money(row.exposure)} / {money(row.creditLimit)}</span> : <span>{money(row.exposure)}</span>
    ), sort: (row) => row.overLimit ?? row.exposure - (row.creditLimit ?? Infinity) },
  ];
  const receiptsCsv = (customers: CustomerDebt[]) => downloadCsv(`cobros-${chase}-${today}.csv`, customers.flatMap((customer) => customer.receipts.map((receipt) => ({ customer, receipt }))), [
    { header: "Sociedad", value: ({ customer }) => companyName(customer.company_code) },
    { header: "Código", value: ({ customer }) => customer.customer_code },
    { header: "Cliente", value: ({ customer }) => customer.name },
    { header: "Comercial", value: ({ customer }) => repName(customer.company_code, customer.rep_code) },
    { header: "Persona de contacto", value: ({ customer }) => customer.contact_name },
    { header: "Teléfono", value: ({ customer }) => customer.contact_phone || customer.phone },
    { header: "Correo", value: ({ customer }) => customer.email },
    { header: "Factura", value: ({ receipt }) => receipt.invoice_number },
    { header: "Fecha factura", value: ({ receipt }) => receipt.invoice_date },
    { header: "Vencimiento", value: ({ receipt }) => receipt.due_date },
    { header: "Días vencido", value: ({ receipt }) => (receipt.due_date && receipt.due_date < today ? daysBetween(receipt.due_date, today) : 0) },
    { header: "Pendiente", value: ({ receipt }) => Number(receipt.pending) },
    { header: "En remesa", value: ({ receipt }) => (receipt.remittance_number ? `Sí (${receipt.remittance_number})` : "No") },
    { header: "Devuelto", value: ({ receipt }) => (receipt.is_returned ? `Sí${receipt.returned_on ? ` (${receipt.returned_on})` : ""}` : "No") },
    { header: "Límite de riesgo", value: ({ customer }) => customer.creditLimit },
  ]);

  // ---- Pagos ----
  const payRows = payables.suppliers.filter((supplier) => (
    payFilter === "sin_remesa" ? supplier.overdueFree > 0
      : payFilter === "en_remesa" ? supplier.overdueInRemittance > 0
        : payFilter === "semana" ? supplier.dueThisWeek > 0
          : supplier.pending > 0
  ));
  const supplierColumns: Column<SupplierDebt>[] = [
    { key: "proveedor", header: "Proveedor", text: true, render: (row) => (
      <span className="sales-article"><strong>{row.name}</strong><small>{row.supplier_code}{companyTag(row.company_code)}</small></span>
    ), sort: (row) => row.name },
    { key: "libre", header: "Vencido sin remesa", render: (row) => (row.overdueFree > 0 ? <span className="sales-down">{money(row.overdueFree)}</span> : muted()), sort: (row) => row.overdueFree },
    { key: "remesa", header: "Vencido en remesa", optional: true, render: (row) => (row.overdueInRemittance > 0 ? money(row.overdueInRemittance) : muted()), sort: (row) => row.overdueInRemittance },
    { key: "semana", header: "Vence esta semana", render: (row) => (row.dueThisWeek > 0 ? money(row.dueThisWeek) : muted()), sort: (row) => row.dueThisWeek },
    { key: "dias", header: "Días", optional: true, render: (row) => (row.oldestDays > 0 ? numberFormatter.format(row.oldestDays) : muted()), sort: (row) => row.oldestDays },
  ];
  const paymentsCsv = (suppliers: SupplierDebt[]) => downloadCsv(`pagos-${payFilter}-${today}.csv`, suppliers.flatMap((supplier) => supplier.items.map((item) => ({ supplier, item }))), [
    { header: "Sociedad", value: ({ supplier }) => companyName(supplier.company_code) },
    { header: "Código", value: ({ supplier }) => supplier.supplier_code },
    { header: "Proveedor", value: ({ supplier }) => supplier.name },
    { header: "Factura", value: ({ item }) => item.invoice_number },
    { header: "Fecha factura", value: ({ item }) => item.invoice_date },
    { header: "Vencimiento", value: ({ item }) => item.due_date },
    { header: "Pendiente", value: ({ item }) => Number(item.pending) },
    { header: "Remesa", value: ({ item }) => item.remittance_number },
    { header: "Banco", value: ({ item }) => item.bank_code },
  ]);

  // ---- Sin facturar ----
  const invoiceRows = uninvoiced.customers.filter((customer) => (onlyPrevious ? customer.previousCount > 0 : true));
  const invoiceColumns: Column<UninvoicedCustomer>[] = [
    { key: "cliente", header: "Cliente", text: true, render: (row) => (
      <span className="sales-article"><strong>{row.name}</strong><small>{row.customer_code ?? "Sin código"}{companyTag(row.company_code)}</small></span>
    ), sort: (row) => row.name },
    { key: "comercial", header: "Comercial", text: true, optional: true, render: (row) => repName(row.company_code, row.rep_code) ?? muted(), sort: (row) => repName(row.company_code, row.rep_code) ?? "" },
    { key: "anteriores", header: "Meses anteriores", render: (row) => (row.previousCount ? <span className="sales-down">{money(row.previous)} · {row.previousCount}</span> : muted()), sort: (row) => row.previous },
    { key: "mes", header: "Este mes", render: (row) => (row.currentCount ? `${money(row.current)} · ${row.currentCount}` : muted()), sort: (row) => row.current },
    { key: "dias", header: "Más antiguo", optional: true, render: (row) => `${numberFormatter.format(row.oldestDays)} días`, sort: (row) => row.oldestDays },
  ];
  const notesCsv = (customers: UninvoicedCustomer[]) => downloadCsv(`sin-facturar-${today}.csv`, customers.flatMap((customer) => customer.notes.map((note) => ({ customer, note }))), [
    { header: "Sociedad", value: ({ customer }) => companyName(customer.company_code) },
    { header: "Código cliente", value: ({ customer }) => customer.customer_code },
    { header: "Cliente", value: ({ customer }) => customer.name },
    { header: "Comercial", value: ({ note }) => repName(note.company_code, note.rep_code) },
    { header: "Albarán", value: ({ note }) => `${note.series}${note.series ? "/" : ""}${note.number}` },
    { header: "Fecha", value: ({ note }) => note.note_date },
    { header: "Días", value: ({ note }) => daysBetween(note.note_date, today) },
    { header: "Importe sin IVA", value: ({ note }) => Number(note.net_amount) },
  ]);

  // ---- Bancos ----
  type BankTableRow = (typeof banks.rows)[number];
  const bankColumns: Column<BankTableRow>[] = [
    { key: "banco", header: "Cuenta", text: true, render: (row) => (
      <span className="sales-article">
        <strong>{row.description || row.bank_name || `Cuenta ${row.account_code}`}</strong>
        <small>{[row.description ? row.bank_name : null, row.account_code, multiCompany ? companyName(row.company_code) : null].filter(Boolean).join(" · ")}</small>
      </span>
    ), sort: (row) => row.description || row.bank_name || row.account_code },
    { key: "saldo", header: "Saldo", render: (row) => (row.balance === null ? muted() : <span className={row.balance < 0 ? "sales-down" : undefined}>{money(row.balance)}</span>), sort: (row) => row.balance ?? -Infinity },
    { key: "dia", header: "A día", optional: true, render: (row) => (row.balanceDay ? shortDate(row.balanceDay) : muted()), sort: (row) => row.balanceDay ?? "" },
    { key: "linea", header: "Línea", optional: true, render: (row) => (row.credit_limit ? money(Number(row.credit_limit)) : muted()), sort: (row) => Number(row.credit_limit ?? 0) },
    { key: "dispuesto", header: "Dispuesto", optional: true, render: (row) => (row.credit_limit ? money(Number(row.credit_used ?? 0)) : muted()), sort: (row) => Number(row.credit_used ?? 0) },
    { key: "disponible", header: "Disponible", render: (row) => (row.available === null ? muted() : money(row.available)), sort: (row) => row.available ?? -Infinity },
  ];
  const balanceIsOld = banks.totals.oldestDay !== null && daysBetween(banks.totals.oldestDay, today) > 3;

  const weekTotals = week.reduce((sum, day) => ({ collections: sum.collections + day.collections, payments: sum.payments + day.payments }), { collections: 0, payments: 0 });

  const switchOf = <T extends string>(value: T, options: { key: T; label: string }[], onChange: (next: T) => void, label: string): ReactNode => (
    <div className="sales-switch is-wrap" role="group" aria-label={label}>
      {options.map((option) => (
        <button key={option.key} type="button" className={value === option.key ? "is-active" : undefined} aria-pressed={value === option.key} onClick={() => onChange(option.key)}>
          {option.label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="page-stack">
      <section className="section-heading">
        <div>
          <p>
            Lo que hay que atender hoy: a quién reclamar, qué se debe a proveedores, qué se ha servido sin facturar y cómo
            están los bancos. Sale de Sage; pulsa una tarjeta para ir a su lista.
          </p>
          {data?.takenOn ? (
            <p className={data.takenOn < shiftDateKey(today, -1) ? "admin-snapshot-date is-stale" : "admin-snapshot-date"}>
              Cobros y pagos según Sage del {new Date(`${data.takenOn}T12:00:00`).toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" })}.
              {data.takenOn < shiftDateKey(today, -1) ? " Son datos atrasados: el agente de Sage no ha mandado la foto de hoy, y puede haber recibos que ya se han cobrado." : ""}
            </p>
          ) : null}
        </div>
        <div className="panel-heading-trailing">
          <SageRefreshButton onUpdated={() => setReloadKey((key) => key + 1)} />
        </div>
      </section>

      <SageFreshness />

      <Toast message={message} onDismiss={() => setMessage(null)} />

      <section className="kpi-grid kpi-grid-sales">
        <KpiCard
          label="Cobros vencidos"
          value={money(receivables.totals.overdue)}
          helper={`${count(receivables.totals.overdueCustomers, "cliente", "clientes")} · ${money(receivables.totals.buckets["+90"])} con más de 90 días`}
          delta="Sin comparación"
          icon={<EuroIcon />}
          tone="rose"
          onClick={() => { setChase("vencidos"); open("cobros"); }}
          actionLabel="Ver a quién reclamar"
        />
        <KpiCard
          label="Recibos devueltos"
          value={money(receivables.totals.returned)}
          helper={`${count(receivables.totals.returnedCount, "recibo devuelto", "recibos devueltos")} por el banco`}
          delta="Sin comparación"
          icon={<XCircleIcon />}
          tone="rose"
          onClick={() => { setChase("devueltos"); open("cobros"); }}
          actionLabel="Ver devueltos"
        />
        <KpiCard
          label="Sobre su límite"
          value={numberFormatter.format(receivables.totals.overLimitCustomers)}
          helper={receivables.totals.overLimitCustomers === 1 ? "cliente que debe más que su límite de riesgo" : "clientes que deben más que su límite de riesgo"}
          delta="Sin comparación"
          icon={<UsuariosIcon />}
          tone="amber"
          onClick={() => { setChase("limite"); open("cobros"); }}
          actionLabel="Ver clientes"
        />
        <KpiCard
          label="Pagos vencidos sin remesa"
          value={money(payables.totals.overdueFree)}
          helper={`${count(payables.totals.overdueFreeSuppliers, "proveedor", "proveedores")} · ${money(payables.totals.overdueInRemittance)} vencido en remesas`}
          delta="Sin comparación"
          icon={<WalletIcon />}
          tone="amber"
          onClick={() => { setPayFilter("sin_remesa"); open("pagos"); }}
          actionLabel="Ver proveedores"
        />
        <KpiCard
          label="Sin facturar (meses anteriores)"
          value={money(uninvoiced.totals.previous)}
          helper={`${count(uninvoiced.totals.previousCount, "albarán", "albaranes")} · ${money(uninvoiced.totals.current)} de este mes`}
          delta="Sin comparación"
          icon={<DocumentIcon />}
          tone="amber"
          onClick={() => { setOnlyPrevious(true); open("facturar"); }}
          actionLabel="Ver albaranes"
        />
        <KpiCard
          label="Saldo en bancos"
          value={banks.totals.withBalance ? money(banks.totals.balance) : "Sin datos"}
          helper={banks.totals.withBalance
            ? `${banks.totals.oldestDay ? `a ${shortDate(banks.totals.oldestDay)} · ` : ""}línea disponible ${money(banks.totals.available)}`
            : "llega con la copia nueva del agente"}
          delta="Sin comparación"
          icon={<CalendarIcon />}
          tone="sky"
          onClick={() => open("bancos")}
          actionLabel="Ver bancos"
        />
      </section>

      <section className="sales-board">
        <Panel title="Los próximos 7 días" subtitle="Lo que debería entrar por cobros de clientes y salir por pagos a proveedores, día a día" className="panel table-panel sales-board-full">
          <div className="table-scroll">
            <table className="sales-data-table">
              <thead><tr><th className="is-text">Día</th><th>Entra</th><th>Sale</th><th>Neto</th></tr></thead>
              <tbody>
                {week.map((day) => (
                  <tr key={day.day}>
                    <td className="is-text is-day"><span className="sales-capitalize">{day.day === today ? "Hoy" : weekday(day.day)}</span></td>
                    <td>{day.collections ? money(day.collections) : muted()}</td>
                    <td>{day.payments ? money(day.payments) : muted()}</td>
                    <td className={day.collections - day.payments < 0 ? "sales-down" : undefined}>{day.collections || day.payments ? money(day.collections - day.payments) : muted()}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="is-text"><strong>Semana</strong></td>
                  <td><strong>{money(weekTotals.collections)}</strong></td>
                  <td><strong>{money(weekTotals.payments)}</strong></td>
                  <td><strong>{money(weekTotals.collections - weekTotals.payments)}</strong></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Panel>
      </section>

      <div id="administracion-listas" className="view-tabs sales-tabs" role="tablist" aria-label="Listas de Administración">
        {tabs.map((item) => (
          <button key={item.key} type="button" role="tab" aria-selected={tab === item.key} className={tab === item.key ? "view-tab active" : "view-tab"} onClick={() => setTab(item.key)}>
            {item.label}
          </button>
        ))}
      </div>

      {tab === "cobros" ? (
        <Panel
          title="Cobros"
          subtitle="Recibos vencidos que no están en manos del banco (o que el banco ha devuelto), por cliente. Pulsa uno para ver sus recibos"
          trailing={(
            <>
              {switchOf(chase, [
                { key: "vencidos", label: "A reclamar" },
                { key: "devueltos", label: "Devueltos" },
                { key: "limite", label: "Sobre su límite" },
                { key: "todos", label: "Todo lo pendiente" },
              ], setChase, "Qué cobros ver")}
              <button type="button" className="button button-compact button-secondary" disabled={chaseRows.length === 0} onClick={() => { receiptsCsv(chaseRows); setMessage("Descargado el Excel de cobros."); }}>Descargar Excel</button>
            </>
          )}
          className="panel table-panel"
        >
          <DataTable
            rows={chaseRows}
            columns={customerColumns}
            rowKey={(row) => row.key}
            onRowClick={(row) => setDetail({ kind: "cliente", customer: row })}
            initialSort={{ key: chase === "limite" ? "riesgo" : chase === "devueltos" ? "devuelto" : chase === "todos" ? "riesgo" : "vencido", desc: true }}
            limit={25}
            empty={chase === "vencidos" ? "Nada vencido por reclamar. ¡Bien!" : "Ningún cliente en esta lista."}
          />
        </Panel>
      ) : null}

      {tab === "pagos" ? (
        <Panel
          title="Pagos a proveedores"
          subtitle="Lo vencido sin remesa no lo está pagando nadie. Lo vencido en remesa lo paga el banco: si sigue aquí, Sage aún no lo ha dado por pagado"
          trailing={(
            <>
              {switchOf(payFilter, [
                { key: "sin_remesa", label: "Vencido sin remesa" },
                { key: "en_remesa", label: "Vencido en remesa" },
                { key: "semana", label: "Vence esta semana" },
                { key: "todos", label: "Todo lo pendiente" },
              ], setPayFilter, "Qué pagos ver")}
              <button type="button" className="button button-compact button-secondary" disabled={payRows.length === 0} onClick={() => { paymentsCsv(payRows); setMessage("Descargado el Excel de pagos."); }}>Descargar Excel</button>
            </>
          )}
          className="panel table-panel"
        >
          <DataTable
            rows={payRows}
            columns={supplierColumns}
            rowKey={(row) => row.key}
            onRowClick={(row) => setDetail({ kind: "proveedor", supplier: row })}
            initialSort={{ key: payFilter === "en_remesa" ? "remesa" : payFilter === "semana" ? "semana" : "libre", desc: true }}
            limit={25}
            empty="Ningún proveedor en esta lista."
          />
        </Panel>
      ) : null}

      {tab === "facturar" ? (
        <Panel
          title="Albaranes sin facturar"
          subtitle="Lo servido en el último año que sigue sin factura. Lo de este mes puede estar esperando a la factura de fin de mes; lo de meses anteriores se ha quedado atrás"
          trailing={(
            <>
              {switchOf(onlyPrevious ? "anteriores" : "todos", [
                { key: "anteriores", label: "Meses anteriores" },
                { key: "todos", label: "También este mes" },
              ], (next) => setOnlyPrevious(next === "anteriores"), "Qué albaranes ver")}
              <button type="button" className="button button-compact button-secondary" disabled={invoiceRows.length === 0} onClick={() => { notesCsv(invoiceRows); setMessage("Descargado el Excel de albaranes."); }}>Descargar Excel</button>
            </>
          )}
          className="panel table-panel"
        >
          {data.uninvoiced.length === 0 ? agentPending("La lista de albaranes sin facturar") : (
            <DataTable
              rows={invoiceRows}
              columns={invoiceColumns}
              rowKey={(row) => row.key}
              onRowClick={(row) => setDetail({ kind: "albaranes", customer: row })}
              initialSort={{ key: onlyPrevious ? "anteriores" : "mes", desc: true }}
              limit={25}
              empty="Nada atrasado por facturar."
            />
          )}
        </Panel>
      ) : null}

      {tab === "bancos" ? (
        <Panel
          title="Bancos"
          subtitle="El último saldo de cada cuenta según Sage, y la línea de riesgo de cada banco con lo dispuesto"
          className="panel table-panel"
        >
          {banks.rows.length === 0 ? agentPending("Lo de los bancos") : (
            <>
              {balanceIsOld ? (
                <p className="sales-section-note">Algún saldo es de hace más de 3 días ({shortDate(banks.totals.oldestDay)}): Sage no lo tiene al día.</p>
              ) : null}
              <DataTable
                rows={banks.rows}
                columns={bankColumns}
                rowKey={(row) => row.key}
                initialSort={{ key: "saldo", desc: true }}
                footer={(
                  <tr>
                    <td className="is-text"><strong>Total</strong></td>
                    <td><strong>{money(banks.totals.balance)}</strong></td>
                    <td className="is-optional" />
                    <td className="is-optional" />
                    <td className="is-optional" />
                    <td><strong>{money(banks.totals.available)}</strong></td>
                  </tr>
                )}
              />
            </>
          )}
        </Panel>
      ) : null}

      <DetailModal detail={detail} today={today} onClose={() => setDetail(null)} repName={repName} companyName={companyName} />
    </div>
  );
}

/** Lo que hay detrás de una fila: los recibos de un cliente, los pagos a un proveedor o los albaranes sin facturar. */
function DetailModal({ detail, today, onClose, repName, companyName }: {
  detail: Detail | null;
  today: string;
  onClose: () => void;
  repName: (company: number, code: number | null) => string | null;
  companyName: (code: number) => string;
}) {
  if (!detail) return null;
  if (detail.kind === "cliente") {
    const customer = detail.customer;
    const phone = customer.contact_phone || customer.phone;
    const receipts = [...customer.receipts].sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""));
    const columns: Column<Receivable>[] = [
      { key: "factura", header: "Factura", text: true, render: (row) => row.invoice_number ?? muted(), sort: (row) => row.invoice_number ?? "" },
      { key: "vence", header: "Vence", render: (row) => shortDate(row.due_date), sort: (row) => row.due_date ?? "" },
      { key: "dias", header: "Días", optional: true, render: (row) => (isToChase(row, today) && row.due_date ? <span className="sales-down">{daysBetween(row.due_date, today)}</span> : muted()), sort: (row) => (row.due_date ? daysBetween(row.due_date, today) : 0) },
      { key: "pendiente", header: "Pendiente", render: (row) => currencyFormatter.format(Number(row.pending)), sort: (row) => Number(row.pending) },
      { key: "estado", header: "Estado", text: true, render: (row) => (
        row.is_returned ? <span className="sales-down">Devuelto{row.returned_on ? ` el ${shortDate(row.returned_on)}` : ""}</span>
          : row.remittance_number ? `Remesa ${row.remittance_number}`
            : row.due_date && row.due_date < today ? <span className="sales-down">Vencido</span> : "Por vencer"
      ) },
    ];
    return (
      <Modal open title={customer.name} eyebrow={`Cobros · ${companyName(customer.company_code)}`} onClose={onClose} scrollInside>
        <div className="confirmation-summary">
          <span>A quién llamar</span>
          <strong className="sales-contact">{customer.contact_name ?? "—"} {telephone(phone)}</strong>
          <span>Comercial</span><strong>{repName(customer.company_code, customer.rep_code) ?? "—"}</strong>
          <span>Vencido</span><strong>{currencyFormatter.format(customer.overdue)}</strong>
          <span>Debe en total</span><strong>{currencyFormatter.format(customer.exposure)}{customer.creditLimit ? ` de un límite de ${currencyFormatter.format(customer.creditLimit)}` : ""}</strong>
          {customer.isBlocked ? <><span>En Sage</span><strong>Bloqueado para albaranes o pedidos</strong></> : null}
        </div>
        <DataTable rows={receipts} columns={columns} rowKey={(row) => `${row.invoice_number}-${row.due_date}-${row.pending}-${row.remittance_number}`} />
      </Modal>
    );
  }
  if (detail.kind === "proveedor") {
    const supplier = detail.supplier;
    const items = [...supplier.items].sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""));
    const columns: Column<Payable>[] = [
      { key: "factura", header: "Factura", text: true, render: (row) => row.invoice_number ?? muted(), sort: (row) => row.invoice_number ?? "" },
      { key: "vence", header: "Vence", render: (row) => shortDate(row.due_date), sort: (row) => row.due_date ?? "" },
      { key: "pendiente", header: "Pendiente", render: (row) => currencyFormatter.format(Number(row.pending)), sort: (row) => Number(row.pending) },
      { key: "remesa", header: "Remesa", text: true, render: (row) => (row.remittance_number ? String(row.remittance_number) : muted("Sin remesa")) },
      { key: "banco", header: "Banco", text: true, optional: true, render: (row) => row.bank_code ?? muted() },
    ];
    return (
      <Modal open title={supplier.name} eyebrow={`Pagos · ${companyName(supplier.company_code)}`} onClose={onClose} scrollInside>
        <div className="confirmation-summary">
          <span>Vencido sin remesa</span><strong>{currencyFormatter.format(supplier.overdueFree)}</strong>
          <span>Vencido en remesa</span><strong>{currencyFormatter.format(supplier.overdueInRemittance)}</strong>
          <span>Vence esta semana</span><strong>{currencyFormatter.format(supplier.dueThisWeek)}</strong>
          {supplier.phone ? <><span>Teléfono</span><strong>{telephone(supplier.phone)}</strong></> : null}
        </div>
        <DataTable rows={items} columns={columns} rowKey={(row) => `${row.invoice_number}-${row.due_date}-${row.pending}-${row.remittance_number}`} />
      </Modal>
    );
  }
  const customer = detail.customer;
  const notes = [...customer.notes].sort((a, b) => a.note_date.localeCompare(b.note_date));
  const columns: Column<UninvoicedNote>[] = [
    { key: "albaran", header: "Albarán", text: true, render: (row) => `${row.series}${row.series ? "/" : ""}${row.number}`, sort: (row) => row.number },
    { key: "fecha", header: "Fecha", render: (row) => shortDate(row.note_date), sort: (row) => row.note_date },
    { key: "dias", header: "Días", render: (row) => numberFormatter.format(daysBetween(row.note_date, today)), sort: (row) => daysBetween(row.note_date, today) },
    { key: "importe", header: "Sin IVA", render: (row) => currencyFormatter.format(Number(row.net_amount)), sort: (row) => Number(row.net_amount) },
  ];
  return (
    <Modal open title={customer.name} eyebrow={`Sin facturar · ${companyName(customer.company_code)}`} onClose={onClose} scrollInside>
      <div className="confirmation-summary">
        <span>De meses anteriores</span><strong>{customer.previousCount ? `${currencyFormatter.format(customer.previous)} en ${count(customer.previousCount, "albarán", "albaranes")}` : "Nada"}</strong>
        <span>De este mes</span><strong>{customer.currentCount ? `${currencyFormatter.format(customer.current)} en ${count(customer.currentCount, "albarán", "albaranes")}` : "Nada"}</strong>
        <span>Comercial</span><strong>{repName(customer.company_code, customer.rep_code) ?? "—"}</strong>
      </div>
      <DataTable rows={notes} columns={columns} rowKey={(row) => `${row.year}-${row.series}-${row.number}`} />
    </Modal>
  );
}
