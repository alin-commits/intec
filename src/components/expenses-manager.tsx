"use client";

import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { CollapsibleFilters } from "@/components/ui/collapsible-filters";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { TablePagination } from "@/components/ui/table-pagination";
import { Modal } from "@/components/ui/modal";
import { Toast } from "@/components/ui/toast";
import { ReportExportButtons } from "@/components/ui/report-export-buttons";
import { KpiCard } from "@/components/kpi-card";
import { DonutChart, type DonutItem } from "@/components/charts/donut-chart";
import { InvoicesPanel, mapInvoiceRow } from "@/components/invoices-panel";
import { CalendarIcon, DocumentIcon, EuroIcon, WalletIcon } from "@/components/icons";
import { EXPENSES_EDIT_ROLES, EXPENSES_ROLES, hasAnyRole } from "@/lib/constants";
import { downloadCsvReport, type CsvSummaryItem } from "@/lib/csv-export";
import { businessUnits as demoBusinessUnits } from "@/lib/demo-data";
import { currencyFormatter, formatDate } from "@/lib/format";
import { reportSafeError } from "@/lib/errors";
import { todayKey } from "@/lib/dates";
import { exportExpenseReportPdf, type ExpenseReportRow } from "@/lib/expense-report-pdf";
import {
  billingPeriodLabels,
  daysBetween,
  expenseCategoryColors,
  expenseCategoryLabels,
  expenseKindLabel,
  monthlyCost,
  nextRenewal,
  subscriptionSpend,
  type BillingPeriod,
  type ExpenseCategory,
  type ExpenseKind,
  type MarketingExpense,
} from "@/lib/expenses";
import type { MarketingInvoice } from "@/lib/invoices";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import type { BusinessUnit } from "@/lib/types";

const STORAGE_KEY = "intec-demo-expenses";
const RENEWAL_WINDOW_DAYS = 30;
const EXPENSE_COLUMNS = "id, name, provider, category, kind, amount, billing_period, start_date, status, cancelled_on, business_unit_id, payment_method, url, notes";

type ExpenseDraft = Omit<MarketingExpense, "id">;
type SortKey = "name" | "category" | "unit" | "kind" | "amount" | "monthly" | "next" | "status";
type SortState = { key: SortKey; direction: "asc" | "desc" } | null;

const SORTABLE_COLUMNS: { key: SortKey; label: string }[] = [
  { key: "name", label: "Concepto" },
  { key: "category", label: "Categoría" },
  { key: "unit", label: "Unidad" },
  { key: "kind", label: "Tipo" },
  { key: "amount", label: "Importe" },
  { key: "monthly", label: "Coste/mes" },
  { key: "next", label: "Próximo cargo" },
  { key: "status", label: "Estado" },
];
// Amounts read best biggest-first; text and dates in natural order.
const DESC_FIRST: SortKey[] = ["amount", "monthly"];
const PAGE_SIZE = 6;
const KIND_ORDER: Record<string, number> = { monthly: 0, quarterly: 1, yearly: 2, one_off: 3 };

/** Date shown in "Próximo cargo": next renewal, the one-off date, or the cancellation date. */
function displayDate(expense: MarketingExpense, today: string): string | null {
  if (expense.kind === "one_off") return expense.startDate;
  return nextRenewal(expense, today) ?? expense.cancelledOn;
}

function blankDraft(): ExpenseDraft {
  return {
    name: "",
    provider: "",
    category: "software",
    kind: "subscription",
    amount: 0,
    billingPeriod: "monthly",
    startDate: todayKey(),
    status: "active",
    cancelledOn: null,
    businessUnitId: null,
    paymentMethod: "",
    url: "",
    notes: "",
  };
}

function mapExpenseRow(row: Record<string, unknown>): MarketingExpense {
  return {
    id: String(row.id),
    name: String(row.name),
    provider: row.provider ? String(row.provider) : null,
    category: row.category as ExpenseCategory,
    kind: row.kind as ExpenseKind,
    amount: Number(row.amount ?? 0),
    billingPeriod: (row.billing_period as BillingPeriod | null) ?? null,
    startDate: String(row.start_date),
    status: row.status === "cancelled" ? "cancelled" : "active",
    cancelledOn: row.cancelled_on ? String(row.cancelled_on) : null,
    businessUnitId: row.business_unit_id ? String(row.business_unit_id) : null,
    paymentMethod: row.payment_method ? String(row.payment_method) : null,
    url: row.url ? String(row.url) : null,
    notes: row.notes ? String(row.notes) : null,
  };
}

function initialDemoExpenses(configured: boolean): MarketingExpense[] {
  if (configured || typeof window === "undefined") return [];
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return saved ? (JSON.parse(saved) as MarketingExpense[]) : [];
  } catch {
    return [];
  }
}

function safeUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.startsWith("http") ? value : `https://${value}`);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function renewalLabel(days: number): string {
  if (days === 0) return "hoy";
  if (days === 1) return "mañana";
  return `en ${days} días`;
}

export function ExpensesManager() {
  const configured = isSupabaseConfigured();
  const today = todayKey();
  const currentYear = Number(today.slice(0, 4));
  const [expenses, setExpenses] = useState<MarketingExpense[]>(() => initialDemoExpenses(configured));
  const [units, setUnits] = useState<BusinessUnit[]>(demoBusinessUnits);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [unitId, setUnitId] = useState("all");
  const [kind, setKind] = useState("all");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState<SortState>(null);
  const [page, setPage] = useState(0);
  const [tab, setTab] = useState<"expenses" | "invoices">("expenses");
  const [invoices, setInvoices] = useState<MarketingInvoice[]>([]);
  const [invoicesAvailable, setInvoicesAvailable] = useState(false);
  const [year, setYear] = useState(currentYear);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ExpenseDraft>(blankDraft);
  const [busy, setBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pendingCancel, setPendingCancel] = useState<MarketingExpense | null>(null);
  const [pendingDelete, setPendingDelete] = useState<MarketingExpense | null>(null);
  const [canEdit, setCanEdit] = useState(!configured);
  const [access, setAccess] = useState<"checking" | "allowed" | "denied">(configured ? "checking" : "allowed");

  useEffect(() => {
    if (!configured) return;
    void loadRealData();
  }, [configured]);

  async function loadRealData() {
    const supabase = createClient();
    const { data: authData } = await supabase.auth.getUser();
    const user = authData.user;
    const { data: profile } = user ? await supabase.from("profiles").select("roles").eq("id", user.id).maybeSingle() : { data: null };
    if (!profile || !hasAnyRole(profile.roles, EXPENSES_ROLES)) {
      setAccess("denied");
      return;
    }
    setCanEdit(hasAnyRole(profile.roles, EXPENSES_EDIT_ROLES));
    const [{ data: unitData, error: unitError }, { data: expenseData, error: expenseError }, { data: invoiceData, error: invoiceError }] = await Promise.all([
      supabase.from("business_units").select("id, name, slug, brand_color, logo_url, is_active, sort_order, visible_in_consultas, visible_in_leads").order("sort_order"),
      supabase.from("marketing_expenses").select(EXPENSE_COLUMNS).order("start_date", { ascending: false }),
      supabase.from("marketing_invoices").select("*").order("invoice_date", { ascending: false }),
    ]);
    setAccess("allowed");
    // Invoices are optional: until their table exists the rest of the page still works.
    setInvoicesAvailable(!invoiceError);
    if (!invoiceError) setInvoices((invoiceData ?? []).map((row) => mapInvoiceRow(row as Record<string, unknown>)));
    if (unitError || expenseError) {
      setMessage(reportSafeError(unitError ?? expenseError, "No se pudieron cargar los gastos."));
      return;
    }
    setUnits((unitData ?? []).map((row) => ({ id: row.id, name: row.name, slug: row.slug, accent: row.brand_color || "#2563eb", active: row.is_active, logo: row.logo_url, sortOrder: row.sort_order ?? 0, visibleInConsultas: row.visible_in_consultas ?? true, visibleInLeads: row.visible_in_leads ?? true })));
    setExpenses((expenseData ?? []).map((row) => mapExpenseRow(row as Record<string, unknown>)));
  }

  function persistDemo(next: MarketingExpense[]) {
    setExpenses(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Demo mode only: losing the local copy is harmless.
    }
  }

  const unitName = (id: string | null) => (id ? units.find((unit) => unit.id === id)?.name ?? "—" : "General");
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const spentUntil = year === currentYear ? today : yearEnd;

  const visibleExpenses = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return expenses
      .filter((expense) => {
        const matchesQuery = !needle || expense.name.toLowerCase().includes(needle) || (expense.provider ?? "").toLowerCase().includes(needle);
        const matchesUnit = unitId === "all" || (unitId === "general" ? expense.businessUnitId === null : expense.businessUnitId === unitId);
        return matchesQuery && matchesUnit && (category === "all" || expense.category === category) && (kind === "all" || expense.kind === kind) && (status === "all" || expense.status === status);
      })
      .sort((a, b) => {
        const byDefault = a.status === b.status ? a.name.localeCompare(b.name, "es") : a.status === "active" ? -1 : 1;
        if (!sort) return byDefault;
        const factor = sort.direction === "asc" ? 1 : -1;
        const unitOf = (expense: MarketingExpense) => (expense.businessUnitId ? units.find((unit) => unit.id === expense.businessUnitId)?.name ?? "" : "General");
        let result = 0;
        switch (sort.key) {
          case "name": result = a.name.localeCompare(b.name, "es"); break;
          case "category": result = expenseCategoryLabels[a.category].localeCompare(expenseCategoryLabels[b.category], "es"); break;
          case "unit": result = unitOf(a).localeCompare(unitOf(b), "es"); break;
          case "kind": result = KIND_ORDER[a.kind === "one_off" ? "one_off" : a.billingPeriod ?? "monthly"] - KIND_ORDER[b.kind === "one_off" ? "one_off" : b.billingPeriod ?? "monthly"]; break;
          case "amount": result = a.amount - b.amount; break;
          case "monthly": result = monthlyCost(a) - monthlyCost(b); break;
          case "status": result = a.status === b.status ? 0 : a.status === "active" ? -1 : 1; break;
          case "next": {
            const dateA = displayDate(a, today);
            const dateB = displayDate(b, today);
            // Rows without a date always go last, whichever the direction.
            if (!dateA || !dateB) return dateA ? -1 : dateB ? 1 : byDefault;
            result = dateA.localeCompare(dateB);
            break;
          }
        }
        return result * factor || byDefault;
      });
  }, [expenses, query, unitId, category, kind, status, sort, units, today]);

  // Al cambiar un filtro o el orden se vuelve a la primera página: quedarse en
  // la cuarta cuando ya solo hay dos despista.
  const filterKey = `${query}|${unitId}|${category}|${kind}|${status}|${sort?.key ?? ""}|${sort?.direction ?? ""}`;
  const [lastFilterKey, setLastFilterKey] = useState(filterKey);
  if (filterKey !== lastFilterKey) {
    setLastFilterKey(filterKey);
    setPage(0);
  }

  const pageCount = Math.max(1, Math.ceil(visibleExpenses.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pagedExpenses = visibleExpenses.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE);

  function toggleSort(key: SortKey) {
    setSort((current) => {
      const first = DESC_FIRST.includes(key) ? "desc" : "asc";
      if (!current || current.key !== key) return { key, direction: first };
      // Third click goes back to the default order.
      if (current.direction === first) return { key, direction: first === "asc" ? "desc" : "asc" };
      return null;
    });
  }

  // Invoices share the search, category and unit filters; they are always "one-off", never cancelled.
  const filteredInvoices = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return invoices.filter((invoice) => {
      const matchesQuery = !needle || [invoice.supplier, invoice.concept, invoice.invoiceNumber].some((value) => (value ?? "").toLowerCase().includes(needle));
      const matchesUnit = unitId === "all" || (unitId === "general" ? invoice.businessUnitId === null : invoice.businessUnitId === unitId);
      return matchesQuery && matchesUnit && (category === "all" || invoice.category === category);
    });
  }, [invoices, query, unitId, category]);
  const yearInvoices = useMemo(() => filteredInvoices.filter((invoice) => invoice.invoiceDate >= yearStart && invoice.invoiceDate <= yearEnd), [filteredInvoices, yearStart, yearEnd]);
  // Invoices not tied to a subscription add their base on their own; tied ones are counted inside their subscription.
  const standaloneInvoices = useMemo(() => (kind === "subscription" || status === "cancelled" ? [] : yearInvoices.filter((invoice) => !invoice.expenseId)), [kind, status, yearInvoices]);

  /** A row's spend in the selected year so far: real invoices plus the estimate for charges still without one. */
  const expenseSpend = useCallback((expense: MarketingExpense, to: string) => subscriptionSpend(expense, invoices, yearStart, to), [invoices, yearStart]);

  const summary = useMemo(() => {
    const monthly = visibleExpenses.reduce((sum, expense) => sum + monthlyCost(expense), 0);
    const standaloneSpent = standaloneInvoices.filter((invoice) => invoice.invoiceDate <= spentUntil).reduce((sum, invoice) => sum + invoice.baseAmount, 0);
    let invoiced = standaloneSpent;
    let estimated = 0;
    for (const expense of visibleExpenses) {
      const part = expenseSpend(expense, spentUntil);
      invoiced += part.actual;
      estimated += part.estimated;
    }
    const spent = invoiced + estimated;
    const projected = visibleExpenses.reduce((sum, expense) => { const part = expenseSpend(expense, yearEnd); return sum + part.actual + part.estimated; }, 0)
      + standaloneInvoices.reduce((sum, invoice) => sum + invoice.baseAmount, 0);
    const invoiceTotals = {
      count: yearInvoices.length,
      base: yearInvoices.reduce((sum, invoice) => sum + invoice.baseAmount, 0),
      total: yearInvoices.reduce((sum, invoice) => sum + invoice.totalAmount, 0),
    };
    const renewals = visibleExpenses
      .map((expense) => ({ expense, date: nextRenewal(expense, today) }))
      .filter((item): item is { expense: MarketingExpense; date: string } => item.date !== null && daysBetween(today, item.date) <= RENEWAL_WINDOW_DAYS)
      .sort((a, b) => a.date.localeCompare(b.date));
    const byCategory = new Map<ExpenseCategory, number>();
    for (const expense of visibleExpenses) {
      const part = expenseSpend(expense, spentUntil);
      const value = part.actual + part.estimated;
      if (value > 0) byCategory.set(expense.category, (byCategory.get(expense.category) ?? 0) + value);
    }
    for (const invoice of standaloneInvoices) {
      const value = invoice.invoiceDate <= spentUntil ? invoice.baseAmount : 0;
      if (value > 0) byCategory.set(invoice.category, (byCategory.get(invoice.category) ?? 0) + value);
    }
    const categoryItems: DonutItem[] = Array.from(byCategory, ([key, value]) => ({ label: expenseCategoryLabels[key], value, color: expenseCategoryColors[key] })).sort((a, b) => b.value - a.value);
    const activeSubscriptions = visibleExpenses.filter((expense) => monthlyCost(expense) > 0).length;
    return { monthly, spent, invoiced, estimated, projected, invoiceTotals, renewals, categoryItems, activeSubscriptions };
  }, [visibleExpenses, standaloneInvoices, yearInvoices, expenseSpend, yearEnd, spentUntil, today]);

  const yearOptions = useMemo(() => {
    const years = new Set<number>([currentYear, currentYear - 1]);
    for (const expense of expenses) years.add(Number(expense.startDate.slice(0, 4)));
    for (const invoice of invoices) years.add(Number(invoice.invoiceDate.slice(0, 4)));
    return Array.from(years).filter((value) => value <= currentYear).sort((a, b) => b - a);
  }, [expenses, invoices, currentYear]);

  function openNew() {
    setEditingId(null);
    setDraft(blankDraft());
    setEditorOpen(true);
  }

  function openEdit(expense: MarketingExpense) {
    setEditingId(expense.id);
    const { id: _id, ...rest } = expense;
    void _id;
    setDraft({ ...rest, provider: rest.provider ?? "", paymentMethod: rest.paymentMethod ?? "", url: rest.url ?? "", notes: rest.notes ?? "" });
    setEditorOpen(true);
  }

  function updateDraft<K extends keyof ExpenseDraft>(key: K, value: ExpenseDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function payloadFor(value: ExpenseDraft) {
    // Only subscriptions can be cancelled; a one-off expense is simply spent.
    const cancelled = value.kind === "subscription" && value.status === "cancelled";
    return {
      name: value.name.trim(),
      provider: value.provider?.trim() || null,
      category: value.category,
      kind: value.kind,
      amount: value.amount,
      billing_period: value.kind === "subscription" ? value.billingPeriod ?? "monthly" : null,
      start_date: value.startDate,
      status: cancelled ? "cancelled" : "active",
      cancelled_on: cancelled ? value.cancelledOn || today : null,
      business_unit_id: value.businessUnitId,
      payment_method: value.paymentMethod?.trim() || null,
      url: value.url?.trim() || null,
      notes: value.notes?.trim() || null,
    };
  }

  async function saveExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.name.trim() || !draft.startDate) {
      setMessage("Añade un nombre y una fecha.");
      return;
    }
    if (!(draft.amount >= 0)) {
      setMessage("El importe no puede ser negativo.");
      return;
    }
    setBusy(true);
    try {
      const payload = payloadFor(draft);
      if (!configured) {
        const saved: MarketingExpense = mapExpenseRow({ ...payload, id: editingId ?? `EX-${Date.now()}` });
        persistDemo(editingId ? expenses.map((expense) => (expense.id === editingId ? saved : expense)) : [saved, ...expenses]);
      } else {
        const supabase = createClient();
        const { error } = editingId ? await supabase.from("marketing_expenses").update(payload).eq("id", editingId) : await supabase.from("marketing_expenses").insert(payload);
        if (error) throw error;
        await loadRealData();
      }
      setMessage(editingId ? "Gasto actualizado." : "Gasto añadido.");
      setEditorOpen(false);
    } catch (cause) {
      setMessage(reportSafeError(cause, "No se pudo guardar el gasto."));
    } finally {
      setBusy(false);
    }
  }

  async function confirmCancel() {
    if (!pendingCancel) return;
    setBusy(true);
    try {
      if (!configured) {
        persistDemo(expenses.map((expense) => (expense.id === pendingCancel.id ? { ...expense, status: "cancelled", cancelledOn: today } : expense)));
      } else {
        const { error } = await createClient().from("marketing_expenses").update({ status: "cancelled", cancelled_on: today }).eq("id", pendingCancel.id);
        if (error) throw error;
        await loadRealData();
      }
      setMessage(`"${pendingCancel.name}" dado de baja. Se conserva en el historial.`);
      setPendingCancel(null);
    } catch (cause) {
      setMessage(reportSafeError(cause, "No se pudo dar de baja."));
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setBusy(true);
    try {
      if (!configured) {
        persistDemo(expenses.filter((expense) => expense.id !== pendingDelete.id));
      } else {
        const { error } = await createClient().from("marketing_expenses").delete().eq("id", pendingDelete.id);
        if (error) throw error;
        await loadRealData();
      }
      setMessage(`"${pendingDelete.name}" eliminado.`);
      setPendingDelete(null);
      setEditorOpen(false);
    } catch (cause) {
      setMessage(reportSafeError(cause, "No se pudo eliminar el gasto."));
    } finally {
      setBusy(false);
    }
  }

  function summaryStats(): { label: string; value: string }[] {
    return [
      { label: year === currentYear ? `Gasto ${year} (hasta hoy)` : `Gasto ${year}`, value: currencyFormatter.format(summary.spent) },
      { label: "De ello, facturado", value: currencyFormatter.format(summary.invoiced) },
      { label: "De ello, estimado (suscripciones sin factura)", value: currencyFormatter.format(summary.estimated) },
      { label: `Previsto ${year} completo`, value: currencyFormatter.format(summary.projected) },
      { label: `Facturas ${year} (base)`, value: currencyFormatter.format(summary.invoiceTotals.base) },
      { label: "Coste mensual (suscripciones)", value: currencyFormatter.format(summary.monthly) },
      { label: "Suscripciones activas", value: String(summary.activeSubscriptions) },
    ];
  }

  function exportCsv() {
    const csvSummary: CsvSummaryItem[] = summaryStats();
    downloadCsvReport(`gastos_marketing_${year}.csv`, csvSummary, visibleExpenses, [
      { header: "Concepto", value: (expense) => expense.name },
      { header: "Proveedor", value: (expense) => expense.provider ?? "" },
      { header: "Categoría", value: (expense) => expenseCategoryLabels[expense.category] },
      { header: "Unidad", value: (expense) => unitName(expense.businessUnitId) },
      { header: "Tipo", value: (expense) => expenseKindLabel(expense) },
      { header: "Importe (€)", value: (expense) => expense.amount },
      { header: "Coste mensual (€)", value: (expense) => Math.round(monthlyCost(expense) * 100) / 100 },
      { header: `Gastado ${year} (€)`, value: (expense) => { const part = expenseSpend(expense, spentUntil); return Math.round((part.actual + part.estimated) * 100) / 100; } },
      { header: "Fecha inicio / gasto", value: (expense) => formatDate(expense.startDate) },
      { header: "Próxima renovación", value: (expense) => { const date = nextRenewal(expense, today); return date ? formatDate(date) : ""; } },
      { header: "Estado", value: (expense) => (expense.status === "active" ? "Activo" : "De baja") },
      { header: "Método de pago", value: (expense) => expense.paymentMethod ?? "" },
      { header: "Notas", value: (expense) => expense.notes ?? "" },
    ]);
  }

  async function exportPdf() {
    setPdfBusy(true);
    try {
      const rows: ExpenseReportRow[] = visibleExpenses.map((expense) => ({
        name: expense.name,
        provider: expense.provider,
        category: expenseCategoryLabels[expense.category],
        unitName: unitName(expense.businessUnitId),
        kindLabel: expenseKindLabel(expense),
        amount: expense.amount,
        monthlyCost: monthlyCost(expense),
        spentInYear: (() => { const part = expenseSpend(expense, spentUntil); return part.actual + part.estimated; })(),
        nextDate: expense.kind === "one_off" ? expense.startDate : nextRenewal(expense, today),
        active: expense.status === "active",
      }));
      await exportExpenseReportPdf({ year, stats: summaryStats(), rows });
    } catch (cause) {
      setMessage(reportSafeError(cause, "No se pudo generar el PDF."));
    } finally {
      setPdfBusy(false);
    }
  }

  if (access === "checking") return <div className="page-stack" />;

  if (access === "denied") {
    return (
      <div className="page-stack">
        <section className="panel">
          <h2>No tienes permiso para ver esta página</h2>
          <p>Gastos solo está disponible para Administración, Marketing y Dirección.</p>
        </section>
      </div>
    );
  }

  const nextRenewalItem = summary.renewals[0];

  return (
    <div className="page-stack">
      <section className="section-heading">
        <div><p>Apps y suscripciones que paga Marketing, y gastos puntuales (ferias, imprenta, agencias…). Las renovaciones se calculan solas.</p></div>
        <div className="panel-heading-trailing">
          <label className="inline-select"><span>Año</span><select value={year} onChange={(event) => setYear(Number(event.target.value))}>{yearOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
          <ReportExportButtons onExportCsv={exportCsv} onExportPdf={() => void exportPdf()} pdfBusy={pdfBusy} />
          {canEdit ? <button type="button" className="button button-primary" onClick={openNew}>+ Nuevo gasto</button> : null}
        </div>
      </section>

      {!canEdit ? <div className="notice"><strong>Solo lectura</strong><span>Puedes consultar los gastos, pero solo Marketing y Administración pueden editarlos.</span></div> : null}

      <Toast message={message} onDismiss={() => setMessage(null)} />

      <CollapsibleFilters
        hasActiveFilters={query !== "" || category !== "all" || unitId !== "all" || kind !== "all" || status !== "all"}
        onClear={() => { setQuery(""); setCategory("all"); setUnitId("all"); setKind("all"); setStatus("all"); }}
        resultCount={visibleExpenses.length}
        resultLabel="Gastos"
      >
        <div className="filter-bar lead-filters">
          <label><span>Buscar</span><input value={query} onChange={(event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)} placeholder="App, concepto o proveedor" /></label>
          <label><span>Categoría</span><select value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="all">Todas</option>
            {Object.entries(expenseCategoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
          <label><span>Unidad</span><select value={unitId} onChange={(event) => setUnitId(event.target.value)}>
            <option value="all">Todas</option>
            <option value="general">General (sin unidad)</option>
            {units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
          </select></label>
          <label><span>Tipo</span><select value={kind} onChange={(event) => setKind(event.target.value)}>
            <option value="all">Todos</option>
            <option value="subscription">Suscripciones</option>
            <option value="one_off">Puntuales</option>
          </select></label>
          <label><span>Estado</span><select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="all">Todos</option>
            <option value="active">Activos</option>
            <option value="cancelled">De baja</option>
          </select></label>
        </div>
      </CollapsibleFilters>

      <section className="kpi-grid">
        <KpiCard label={year === currentYear ? `Gasto ${year} hasta hoy` : `Gasto ${year}`} value={currencyFormatter.format(summary.spent)} delta="Sin comparación" helper={`${currencyFormatter.format(summary.invoiced)} facturado + ${currencyFormatter.format(summary.estimated)} estimado`} icon={<EuroIcon />} tone="amber" />
        <KpiCard label={`Facturas ${year}`} value={currencyFormatter.format(summary.invoiceTotals.base)} delta="Sin comparación" helper={`${summary.invoiceTotals.count} factura${summary.invoiceTotals.count === 1 ? "" : "s"} · ${currencyFormatter.format(summary.invoiceTotals.total)} con IVA`} icon={<DocumentIcon />} tone="sky" />
        <KpiCard label="Coste mensual" value={currencyFormatter.format(summary.monthly)} delta="Sin comparación" helper={`${currencyFormatter.format(summary.monthly * 12)}/año · ${summary.activeSubscriptions} suscripcion${summary.activeSubscriptions === 1 ? "" : "es"} activa${summary.activeSubscriptions === 1 ? "" : "s"}`} icon={<WalletIcon />} tone="indigo" />
        <KpiCard label="Renovaciones próximas" value={String(summary.renewals.length)} delta="Sin comparación" helper={nextRenewalItem ? `${nextRenewalItem.expense.name} ${renewalLabel(daysBetween(today, nextRenewalItem.date))}` : `ninguna en ${RENEWAL_WINDOW_DAYS} días`} icon={<CalendarIcon />} tone={summary.renewals.some((item) => daysBetween(today, item.date) <= 7) ? "rose" : "emerald"} />
      </section>

      <section className="expenses-grid">
        <article className="panel chart-panel">
          <div className="panel-heading"><div><h2>Gasto por categoría</h2><p className="panel-subtitle">{year === currentYear ? `En ${year}, hasta hoy · previsto año completo ${currencyFormatter.format(summary.projected)}` : `En ${year}`}</p></div></div>
          <DonutChart items={summary.categoryItems} centerLabel={`gastado ${year}`} ariaLabel="Gasto del año por categoría" emptyMessage="Sin gastos en este año." valueFormatter={(value) => currencyFormatter.format(value)} />
        </article>
        <article className="panel chart-panel">
          <div className="panel-heading"><div><h2>Próximas renovaciones</h2><p className="panel-subtitle">Cargos en los próximos {RENEWAL_WINDOW_DAYS} días</p></div></div>
          {summary.renewals.length === 0 ? (
            <p className="muted">No se renueva nada en los próximos {RENEWAL_WINDOW_DAYS} días.</p>
          ) : (
            <ul className="renewal-list">
              {summary.renewals.map(({ expense, date }) => {
                const days = daysBetween(today, date);
                return (
                  <li key={expense.id} className={days <= 7 ? "renewal-soon" : undefined}>
                    <span><strong>{expense.name}</strong><small>{formatDate(date)} · {renewalLabel(days)}</small></span>
                    <strong>{currencyFormatter.format(expense.amount)}</strong>
                  </li>
                );
              })}
            </ul>
          )}
        </article>
      </section>

      {configured ? (
        <div className="view-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "expenses"} className={tab === "expenses" ? "view-tab active" : "view-tab"} onClick={() => setTab("expenses")}>Suscripciones y gastos</button>
          <button type="button" role="tab" aria-selected={tab === "invoices"} className={tab === "invoices" ? "view-tab active" : "view-tab"} onClick={() => setTab("invoices")}>Facturas{yearInvoices.length ? ` (${yearInvoices.length})` : ""}</button>
        </div>
      ) : null}

      {tab === "invoices" ? (
        invoicesAvailable ? (
          <InvoicesPanel invoices={yearInvoices} allInvoices={invoices} expenses={expenses} units={units} canEdit={canEdit} year={year} onChanged={loadRealData} onMessage={setMessage} />
        ) : (
          <div className="notice"><strong>Facturas no disponibles todavía</strong><span>Falta crear la tabla de facturas en Supabase (migración 202609240001_marketing_invoices.sql).</span></div>
        )
      ) : (
      <section className="panel table-panel">
        <div className="table-scroll">
          <table>
            <thead><tr>
              {SORTABLE_COLUMNS.map((column) => {
                const active = sort?.key === column.key;
                return (
                  <th key={column.key} aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}>
                    <button type="button" className={active ? "sort-header active" : "sort-header"} onClick={() => toggleSort(column.key)} title="Ordenar">
                      {column.label}
                      <span aria-hidden="true">{active ? (sort.direction === "asc" ? "↑" : "↓") : "↕"}</span>
                    </button>
                  </th>
                );
              })}
              <th>Acciones</th>
            </tr></thead>
            <tbody>
              {pagedExpenses.map((expense) => {
                const renewal = nextRenewal(expense, today);
                const link = safeUrl(expense.url);
                return (
                  <tr key={expense.id} className={expense.status === "cancelled" ? "row-muted" : undefined}>
                    <td>
                      <strong>{link ? <a href={link} target="_blank" rel="noopener noreferrer" className="text-link">{expense.name}</a> : expense.name}</strong>
                      <small>{[expense.provider, expense.paymentMethod].filter(Boolean).join(" · ") || "—"}</small>
                    </td>
                    <td><span className="unit-name"><i style={{ background: expenseCategoryColors[expense.category] }} />{expenseCategoryLabels[expense.category]}</span></td>
                    <td>{unitName(expense.businessUnitId)}</td>
                    <td>{expenseKindLabel(expense)}</td>
                    <td>{currencyFormatter.format(expense.amount)}</td>
                    <td>{monthlyCost(expense) ? currencyFormatter.format(monthlyCost(expense)) : "—"}</td>
                    <td>{expense.kind === "one_off" ? <span className="muted">{formatDate(expense.startDate)}</span> : renewal ? formatDate(renewal) : expense.cancelledOn ? <span className="muted">Baja {formatDate(expense.cancelledOn)}</span> : "—"}</td>
                    <td><span className={expense.status === "active" ? "badge badge-active" : "badge"}>{expense.status === "active" ? "Activo" : "De baja"}</span></td>
                    <td>
                      <div className="table-actions">
                        <button type="button" className="button button-compact button-secondary" onClick={() => openEdit(expense)}>{canEdit ? "Editar" : "Ver"}</button>
                        {canEdit && expense.kind === "subscription" && expense.status === "active" ? <button type="button" className="button button-compact button-secondary" onClick={() => setPendingCancel(expense)}>Dar de baja</button> : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {visibleExpenses.length === 0 ? <tr><td colSpan={9} className="muted">{expenses.length === 0 ? "Todavía no hay gastos. Pulsa «+ Nuevo gasto» para añadir la primera app." : "Sin gastos que coincidan con los filtros."}</td></tr> : null}
            </tbody>
          </table>
        </div>
        <TablePagination page={currentPage} pageCount={pageCount} total={visibleExpenses.length} label="en la lista" onChange={setPage} />
      </section>
      )}

      <ConfirmationDialog open={Boolean(pendingCancel)} title="¿Dar de baja la suscripción?" confirmLabel="Dar de baja" busy={busy} onCancel={() => setPendingCancel(null)} onConfirm={() => void confirmCancel()}>
        {pendingCancel ? <div className="confirmation-summary"><span>Suscripción</span><strong>{pendingCancel.name}</strong><span>Efecto</span><strong>Deja de contar en el coste mensual desde hoy. Lo ya pagado se mantiene en el historial.</strong></div> : null}
      </ConfirmationDialog>

      <ConfirmationDialog open={Boolean(pendingDelete)} title="¿Eliminar el gasto?" confirmLabel="Eliminar" destructive busy={busy} onCancel={() => setPendingDelete(null)} onConfirm={() => void confirmDelete()}>
        {pendingDelete ? <div className="confirmation-summary"><span>Gasto</span><strong>{pendingDelete.name}</strong><span>Efecto</span><strong>Se borra por completo, también de los totales ya gastados. Si solo has dejado de pagarlo, mejor «Dar de baja».</strong></div> : null}
      </ConfirmationDialog>

      <Modal open={editorOpen} title={editingId ? "Editar gasto" : "Nuevo gasto"} eyebrow="Gastos de marketing" onClose={() => setEditorOpen(false)}>
        <form className="lead-editor-form" onSubmit={saveExpense}>
          <div className="form-grid">
            <label><span>Concepto / app *</span><input value={draft.name} readOnly={!canEdit} maxLength={120} onChange={(event) => updateDraft("name", event.target.value)} placeholder="Canva, Metricool, feria…" required /></label>
            <label><span>Proveedor</span><input value={draft.provider ?? ""} readOnly={!canEdit} onChange={(event) => updateDraft("provider", event.target.value)} /></label>
            <label><span>Tipo *</span><select value={draft.kind} disabled={!canEdit} onChange={(event) => updateDraft("kind", event.target.value as ExpenseKind)}>
              <option value="subscription">Suscripción (se renueva)</option>
              <option value="one_off">Gasto puntual</option>
            </select></label>
            {draft.kind === "subscription" ? (
              <label><span>Periodicidad *</span><select value={draft.billingPeriod ?? "monthly"} disabled={!canEdit} onChange={(event) => updateDraft("billingPeriod", event.target.value as BillingPeriod)}>
                {Object.entries(billingPeriodLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select></label>
            ) : null}
            <label><span>{draft.kind === "subscription" ? "Importe por periodo (€) *" : "Importe (€) *"}</span><input type="number" min="0" step="0.01" value={draft.amount} readOnly={!canEdit} onChange={(event) => updateDraft("amount", Number(event.target.value) || 0)} required /></label>
            <label><span>{draft.kind === "subscription" ? "Fecha del primer cargo *" : "Fecha del gasto *"}</span><input type="date" value={draft.startDate} readOnly={!canEdit} onChange={(event) => updateDraft("startDate", event.target.value)} required /></label>
            <label><span>Categoría</span><select value={draft.category} disabled={!canEdit} onChange={(event) => updateDraft("category", event.target.value as ExpenseCategory)}>
              {Object.entries(expenseCategoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select></label>
            <label><span>Unidad</span><select value={draft.businessUnitId ?? ""} disabled={!canEdit} onChange={(event) => updateDraft("businessUnitId", event.target.value || null)}>
              <option value="">General (todas)</option>
              {units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
            </select></label>
            <label><span>Método de pago</span><input value={draft.paymentMethod ?? ""} readOnly={!canEdit} onChange={(event) => updateDraft("paymentMethod", event.target.value)} placeholder="Tarjeta empresa, domiciliación…" /></label>
            <label><span>Web / acceso</span><input value={draft.url ?? ""} readOnly={!canEdit} onChange={(event) => updateDraft("url", event.target.value)} placeholder="https://…" /></label>
            {draft.kind === "subscription" ? (
              <label><span>Estado</span><select value={draft.status} disabled={!canEdit} onChange={(event) => { const next = event.target.value as MarketingExpense["status"]; updateDraft("status", next); updateDraft("cancelledOn", next === "cancelled" ? draft.cancelledOn ?? today : null); }}>
                <option value="active">Activa</option>
                <option value="cancelled">De baja</option>
              </select></label>
            ) : null}
            {draft.kind === "subscription" && draft.status === "cancelled" ? (
              <label><span>Fecha de baja</span><input type="date" value={draft.cancelledOn ?? today} readOnly={!canEdit} onChange={(event) => updateDraft("cancelledOn", event.target.value || today)} /></label>
            ) : null}
            <label className="form-field-wide"><span>Notas</span><textarea rows={3} value={draft.notes ?? ""} readOnly={!canEdit} onChange={(event) => updateDraft("notes", event.target.value)} placeholder="Usuarios incluidos, quién lo usa, cuándo revisar…" /></label>
          </div>
          <div className="modal-actions">
            {canEdit && editingId ? <button type="button" className="button button-secondary expenses-delete" onClick={() => setPendingDelete(expenses.find((expense) => expense.id === editingId) ?? null)}>Eliminar</button> : null}
            <button type="button" className="button button-secondary" onClick={() => setEditorOpen(false)}>Cerrar</button>
            {canEdit ? <button type="submit" className="button button-primary" disabled={busy}>{busy ? "Guardando…" : "Guardar gasto"}</button> : null}
          </div>
        </form>
      </Modal>
    </div>
  );
}
