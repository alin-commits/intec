"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from "react";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { TablePagination } from "@/components/ui/table-pagination";
import { Modal } from "@/components/ui/modal";
import { ReportExportButtons } from "@/components/ui/report-export-buttons";
import { downloadCsvReport } from "@/lib/csv-export";
import { formatDate, currencyFormatter } from "@/lib/format";
import { formatEuroForPdf, generatePdfReport } from "@/lib/pdf-report";
import { reportSafeError } from "@/lib/errors";
import { todayKey } from "@/lib/dates";
import { billingPeriodLabels, expenseCategoryColors, expenseCategoryLabels, type BillingPeriod, type ExpenseCategory, type MarketingExpense } from "@/lib/expenses";
import { INVOICE_BUCKET, INVOICE_MAX_BYTES, matchSubscription, type InvoiceExtraction, type MarketingInvoice } from "@/lib/invoices";
import { createClient } from "@/lib/supabase/client";
import type { BusinessUnit } from "@/lib/types";

/** La fecha de subida la pone la base de datos, no se edita. */
type InvoiceDraft = Omit<MarketingInvoice, "id" | "createdAt">;
type UploadStep = "idle" | "uploading" | "reading";
/** Una factura esperando a que se decida si se manda a contabilidad. */
type PendingSend = { id: string; supplier: string };
/** Envíos anteriores de esa factura, de más reciente a más antiguo. */
type InvoiceSend = { at: string; by: string | null; to: string };

type SortKey = "date" | "supplier" | "concept" | "category" | "unit" | "base" | "vat" | "total" | "kind" | "added";
type SortState = { key: SortKey; direction: "asc" | "desc" };
const SORTABLE_COLUMNS: { key: SortKey; label: string }[] = [
  { key: "date", label: "Fecha" },
  { key: "supplier", label: "Proveedor" },
  { key: "concept", label: "Concepto" },
  { key: "category", label: "Categoría" },
  { key: "unit", label: "Unidad" },
  { key: "base", label: "Base" },
  { key: "vat", label: "IVA" },
  { key: "total", label: "Total" },
  { key: "kind", label: "Tipo" },
  { key: "added", label: "Añadida" },
];
/** En los importes y en las fechas interesa más ver primero lo grande y lo nuevo. */
const DESC_FIRST: SortKey[] = ["date", "added", "base", "vat", "total"];
const PAGE_SIZE = 6;

export function mapInvoiceRow(row: Record<string, unknown>): MarketingInvoice {
  return {
    id: String(row.id),
    supplier: String(row.supplier),
    invoiceNumber: row.invoice_number ? String(row.invoice_number) : null,
    concept: row.concept ? String(row.concept) : null,
    invoiceDate: String(row.invoice_date),
    createdAt: String(row.created_at ?? row.invoice_date),
    baseAmount: Number(row.base_amount ?? 0),
    vatAmount: Number(row.vat_amount ?? 0),
    totalAmount: Number(row.total_amount ?? 0),
    category: row.category as ExpenseCategory,
    businessUnitId: row.business_unit_id ? String(row.business_unit_id) : null,
    expenseId: row.expense_id ? String(row.expense_id) : null,
    filePath: row.file_path ? String(row.file_path) : null,
    fileName: row.file_name ? String(row.file_name) : null,
    notes: row.notes ? String(row.notes) : null,
  };
}

function blankDraft(): InvoiceDraft {
  return {
    supplier: "",
    invoiceNumber: "",
    concept: "",
    invoiceDate: todayKey(),
    baseAmount: 0,
    vatAmount: 0,
    totalAmount: 0,
    category: "other",
    businessUnitId: null,
    expenseId: null,
    filePath: null,
    fileName: null,
    notes: "",
  };
}

const round2 = (value: number) => Math.round(value * 100) / 100;
const sameNumber = (a: string | null, b: string | null) => Boolean(a && b && a.replace(/\s+/g, "").toLowerCase() === b.replace(/\s+/g, "").toLowerCase());

/** Opens a short-lived link to a private PDF. The tab is opened first so popup blockers allow it. */
async function openInvoicePdf(path: string): Promise<boolean> {
  const tab = window.open("", "_blank");
  const { data, error } = await createClient().storage.from(INVOICE_BUCKET).createSignedUrl(path, 120);
  if (error || !data?.signedUrl) {
    tab?.close();
    return false;
  }
  if (tab) {
    tab.opener = null;
    tab.location.href = data.signedUrl;
  } else {
    window.location.assign(data.signedUrl);
  }
  return true;
}

type InvoicesPanelProps = {
  invoices: MarketingInvoice[];
  allInvoices: MarketingInvoice[];
  expenses: MarketingExpense[];
  units: BusinessUnit[];
  canEdit: boolean;
  year: number;
  onChanged: () => Promise<void>;
  onMessage: (message: string) => void;
};

export function InvoicesPanel({ invoices, allInvoices, expenses, units, canEdit, year, onChanged, onMessage }: InvoicesPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<UploadStep>("idle");
  const [dragging, setDragging] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<InvoiceDraft>(blankDraft);
  const [aiNote, setAiNote] = useState<string | null>(null);
  /** When set, saving also creates a new subscription for this supplier and links the invoice to it. */
  const [newSubscription, setNewSubscription] = useState<BillingPeriod | null>(null);
  const [busy, setBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<MarketingInvoice | null>(null);
  const [sort, setSort] = useState<SortState | null>(null);
  const [page, setPage] = useState(0);
  const [pendingSend, setPendingSend] = useState<PendingSend | null>(null);
  /** A qué dirección se mandan las facturas; la decide el servidor. */
  const [mailbox, setMailbox] = useState("");
  /** Guarda de qué factura son los envíos, para no enseñar los de la anterior. */
  const [sendLog, setSendLog] = useState<{ id: string; sends: InvoiceSend[] } | null>(null);

  const subscriptions = expenses.filter((expense) => expense.kind === "subscription");
  const unitName = (id: string | null) => (id ? units.find((unit) => unit.id === id)?.name ?? "—" : "General");
  const expenseName = (id: string | null) => (id ? expenses.find((expense) => expense.id === id)?.name ?? "Suscripción" : null);
  const duplicate = draft.invoiceNumber
    ? allInvoices.find((invoice) => invoice.id !== editingId && sameNumber(invoice.invoiceNumber, draft.invoiceNumber) && invoice.supplier.trim().toLowerCase() === draft.supplier.trim().toLowerCase())
    : undefined;

  function updateDraft<K extends keyof InvoiceDraft>(key: K, value: InvoiceDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function updateAmount(key: "baseAmount" | "vatAmount", value: number) {
    // Base or VAT changes keep the total in sync; the total can still be edited by hand.
    setDraft((current) => {
      const next = { ...current, [key]: value };
      return { ...next, totalAmount: round2(next.baseAmount + next.vatAmount) };
    });
  }

  async function handleFile(file: File | undefined) {
    if (!file || !canEdit || step !== "idle") return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      onMessage("Solo se admiten facturas en PDF.");
      return;
    }
    if (file.size > INVOICE_MAX_BYTES) {
      onMessage("La factura supera los 10 MB.");
      return;
    }
    const supabase = createClient();
    const path = `${todayKey().slice(0, 4)}/${crypto.randomUUID()}.pdf`;
    setStep("uploading");
    try {
      const { error: uploadError } = await supabase.storage.from(INVOICE_BUCKET).upload(path, file, { contentType: "application/pdf", upsert: false });
      if (uploadError) throw uploadError;
      const base: InvoiceDraft = { ...blankDraft(), filePath: path, fileName: file.name.slice(0, 200) };

      setStep("reading");
      let extraction: InvoiceExtraction | null = null;
      let note: string | null = null;
      try {
        const response = await fetch("/api/invoices/extract", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path }) });
        const payload = (await response.json()) as { extraction?: InvoiceExtraction; error?: string };
        if (response.ok && payload.extraction) extraction = payload.extraction;
        else note = payload.error ?? "La IA no pudo leer la factura. Rellena los datos a mano.";
      } catch {
        note = "La IA no pudo leer la factura. Rellena los datos a mano.";
      }

      if (extraction) {
        const match = matchSubscription(extraction.supplier, subscriptions);
        const baseAmount = extraction.baseAmount ?? (extraction.totalAmount !== null && extraction.vatAmount !== null ? round2(extraction.totalAmount - extraction.vatAmount) : 0);
        const vatAmount = extraction.vatAmount ?? 0;
        setDraft({
          ...base,
          supplier: extraction.supplier,
          invoiceNumber: extraction.invoiceNumber ?? "",
          concept: extraction.concept ?? "",
          invoiceDate: extraction.invoiceDate ?? base.invoiceDate,
          baseAmount,
          vatAmount,
          totalAmount: extraction.totalAmount ?? round2(baseAmount + vatAmount),
          category: match?.category ?? extraction.category,
          businessUnitId: match?.businessUnitId ?? null,
          expenseId: match?.id ?? null,
        });
        // A recurring fee from a supplier we don't track yet: propose creating the subscription.
        setNewSubscription(!match && extraction.recurrence ? extraction.recurrence : null);
        note = match
          ? `Datos leídos con IA. Parece una factura de la suscripción «${match.name}»: queda asociada y cuenta como el cargo real de ese periodo (sustituye a la estimación). Revisa y guarda.`
          : extraction.recurrence
            ? `Datos leídos con IA. Parece una cuota ${billingPeriodLabels[extraction.recurrence].toLowerCase()} que aún no está en Suscripciones: al guardar se creará la suscripción «${extraction.supplier}» y la factura quedará asociada. Si no la quieres, cámbialo en «¿Es de una suscripción?».`
            : "Datos leídos con IA. Revísalos antes de guardar.";
        if (!extraction.invoiceDate || extraction.baseAmount === null || extraction.totalAmount === null) note += " Faltan algunos datos que no se veían claros.";
      } else {
        setDraft(base);
        setNewSubscription(null);
      }
      setAiNote(note);
      setEditingId(null);
      setEditorOpen(true);
    } catch (cause) {
      await supabase.storage.from(INVOICE_BUCKET).remove([path]);
      onMessage(reportSafeError(cause, "No se pudo subir la factura."));
    } finally {
      setStep("idle");
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function onDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setDragging(false);
    void handleFile(event.dataTransfer.files[0]);
  }

  function openEdit(invoice: MarketingInvoice) {
    const { id: _id, ...rest } = invoice;
    void _id;
    setDraft({ ...rest, invoiceNumber: rest.invoiceNumber ?? "", concept: rest.concept ?? "", notes: rest.notes ?? "" });
    setEditingId(invoice.id);
    setAiNote(null);
    setNewSubscription(null);
    setEditorOpen(true);
  }

  async function closeEditor() {
    // A freshly uploaded PDF that was never saved is removed so it doesn't linger in storage.
    if (!editingId && draft.filePath) await createClient().storage.from(INVOICE_BUCKET).remove([draft.filePath]);
    setEditorOpen(false);
  }

  async function saveInvoice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.supplier.trim() || !draft.invoiceDate) {
      onMessage("Añade el proveedor y la fecha de la factura.");
      return;
    }
    setBusy(true);
    try {
      const payload = {
        supplier: draft.supplier.trim(),
        invoice_number: draft.invoiceNumber?.trim() || null,
        concept: draft.concept?.trim() || null,
        invoice_date: draft.invoiceDate,
        base_amount: round2(draft.baseAmount),
        vat_amount: round2(draft.vatAmount),
        total_amount: round2(draft.totalAmount),
        category: draft.category,
        business_unit_id: draft.businessUnitId,
        expense_id: draft.expenseId,
        file_path: draft.filePath,
        file_name: draft.fileName,
        notes: draft.notes?.trim() || null,
      };
      const supabase = createClient();
      let createdExpenseId: string | null = null;
      if (newSubscription) {
        // The subscription starts on this invoice's date and costs its base amount (totals count bases, without VAT).
        const { data: created, error: expenseError } = await supabase
          .from("marketing_expenses")
          .insert({
            name: payload.supplier,
            provider: payload.supplier,
            category: payload.category,
            kind: "subscription",
            amount: payload.base_amount,
            billing_period: newSubscription,
            start_date: payload.invoice_date,
            status: "active",
            business_unit_id: payload.business_unit_id,
            notes: "Creada a partir de una factura.",
          })
          .select("id")
          .single();
        if (expenseError) throw expenseError;
        createdExpenseId = created.id;
        payload.expense_id = created.id;
      }
      let savedId = editingId;
      if (editingId) {
        const { error } = await supabase.from("marketing_invoices").update(payload).eq("id", editingId);
        if (error) {
          if (createdExpenseId) await supabase.from("marketing_expenses").delete().eq("id", createdExpenseId);
          throw error;
        }
      } else {
        const { data: created, error } = await supabase.from("marketing_invoices").insert(payload).select("id").single();
        if (error) {
          if (createdExpenseId) await supabase.from("marketing_expenses").delete().eq("id", createdExpenseId);
          throw error;
        }
        savedId = created.id;
      }
      setEditorOpen(false);
      setNewSubscription(null);
      await onChanged();
      onMessage(createdExpenseId ? `Factura guardada y suscripción «${payload.supplier}» creada.` : editingId ? "Factura actualizada." : "Factura guardada.");
      // Solo se pregunta al subir una nueva con PDF: al editar ya se decidió en su día.
      if (!editingId && savedId && payload.file_path) setPendingSend({ id: savedId, supplier: payload.supplier });
    } catch (cause) {
      onMessage(reportSafeError(cause, "No se pudo guardar la factura."));
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setBusy(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.from("marketing_invoices").delete().eq("id", pendingDelete.id);
      if (error) throw error;
      if (pendingDelete.filePath) await supabase.storage.from(INVOICE_BUCKET).remove([pendingDelete.filePath]);
      setPendingDelete(null);
      setEditorOpen(false);
      await onChanged();
      onMessage("Factura eliminada.");
    } catch (cause) {
      onMessage(reportSafeError(cause, "No se pudo eliminar la factura."));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!pendingSend) return;
    let active = true;
    void (async () => {
      const response = await fetch(`/api/invoices/send?id=${pendingSend.id}`, { cache: "no-store" });
      if (!active) return;
      const result = (await response.json().catch(() => ({}))) as { to?: string; sends?: InvoiceSend[] };
      if (!response.ok) return;
      if (result.to) setMailbox(result.to);
      setSendLog({ id: pendingSend.id, sends: result.sends ?? [] });
    })();
    return () => { active = false; };
  }, [pendingSend]);

  async function sendInvoice(id: string) {
    setBusy(true);
    try {
      const response = await fetch("/api/invoices/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const result = (await response.json().catch(() => ({}))) as { to?: string; error?: string };
      onMessage(response.ok ? `Factura enviada a ${result.to ?? "contabilidad"}.` : result.error ?? "No se pudo enviar la factura.");
    } catch {
      onMessage("No hay conexión con el servidor.");
    } finally {
      setBusy(false);
      setPendingSend(null);
    }
  }

  async function viewPdf(path: string) {
    if (!(await openInvoicePdf(path))) onMessage("No se pudo abrir el PDF de la factura.");
  }

  // Null mientras no se sepa: así no se avisa de "0 envíos" antes de saberlo.
  const previousSends = sendLog && pendingSend && sendLog.id === pendingSend.id ? sendLog.sends : null;
  const lastSend = previousSends && previousSends.length > 0 ? previousSends[0] : null;
  const sendCountLabel = previousSends?.length === 1 ? "una vez" : `${previousSends?.length ?? 0} veces`;

  function toggleSort(key: SortKey) {
    setPage(0);
    setSort((current) => {
      if (current?.key !== key) return { key, direction: DESC_FIRST.includes(key) ? "desc" : "asc" };
      return current.direction === "asc" ? { key, direction: "desc" } : null;
    });
  }

  const sortedInvoices = useMemo(() => {
    const value = (invoice: MarketingInvoice, key: SortKey): string | number => {
      switch (key) {
        case "date": return invoice.invoiceDate;
        case "added": return invoice.createdAt;
        case "supplier": return invoice.supplier.toLowerCase();
        case "concept": return (invoice.concept ?? "").toLowerCase();
        case "category": return expenseCategoryLabels[invoice.category].toLowerCase();
        case "unit": return (units.find((unit) => unit.id === invoice.businessUnitId)?.name ?? "").toLowerCase();
        case "base": return invoice.baseAmount;
        case "vat": return invoice.vatAmount;
        case "total": return invoice.totalAmount;
        case "kind": return (expenses.find((expense) => expense.id === invoice.expenseId)?.name ?? "").toLowerCase();
      }
    };
    const rows = [...invoices];
    if (!sort) return rows;
    const factor = sort.direction === "asc" ? 1 : -1;
    return rows.sort((a, b) => {
      const left = value(a, sort.key);
      const right = value(b, sort.key);
      if (typeof left === "number" && typeof right === "number") return (left - right) * factor;
      return String(left).localeCompare(String(right), "es") * factor;
    });
  }, [invoices, sort, units, expenses]);

  // Si cambian los filtros de arriba o el orden, se vuelve a la primera página.
  const filterKey = `${year}|${invoices.length}|${sort?.key ?? ""}|${sort?.direction ?? ""}`;
  const [lastFilterKey, setLastFilterKey] = useState(filterKey);
  if (filterKey !== lastFilterKey) {
    setLastFilterKey(filterKey);
    setPage(0);
  }

  const pageCount = Math.max(1, Math.ceil(sortedInvoices.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleInvoices = sortedInvoices.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE);

  const totals = {
    base: invoices.reduce((sum, invoice) => sum + invoice.baseAmount, 0),
    vat: invoices.reduce((sum, invoice) => sum + invoice.vatAmount, 0),
    total: invoices.reduce((sum, invoice) => sum + invoice.totalAmount, 0),
  };

  function exportCsv() {
    downloadCsvReport(`facturas_marketing_${year}.csv`, [
      { label: "Facturas", value: invoices.length },
      { label: "Base imponible (€)", value: round2(totals.base) },
      { label: "IVA (€)", value: round2(totals.vat) },
      { label: "Total (€)", value: round2(totals.total) },
    ], invoices, [
      { header: "Fecha", value: (invoice) => formatDate(invoice.invoiceDate) },
      { header: "Proveedor", value: (invoice) => invoice.supplier },
      { header: "Nº factura", value: (invoice) => invoice.invoiceNumber ?? "" },
      { header: "Concepto", value: (invoice) => invoice.concept ?? "" },
      { header: "Categoría", value: (invoice) => expenseCategoryLabels[invoice.category] },
      { header: "Unidad", value: (invoice) => unitName(invoice.businessUnitId) },
      { header: "Base (€)", value: (invoice) => invoice.baseAmount },
      { header: "IVA (€)", value: (invoice) => invoice.vatAmount },
      { header: "Total (€)", value: (invoice) => invoice.totalAmount },
      { header: "Suscripción asociada", value: (invoice) => expenseName(invoice.expenseId) ?? "" },
      { header: "Notas", value: (invoice) => invoice.notes ?? "" },
    ]);
  }

  async function exportPdf() {
    setPdfBusy(true);
    try {
      const generatedAt = new Intl.DateTimeFormat("es-ES", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Madrid" }).format(new Date());
      await generatePdfReport({
        title: "Facturas de marketing",
        subtitle: `Año ${year}  ·  Generado el ${generatedAt}  ·  ${invoices.length} factura${invoices.length === 1 ? "" : "s"}`,
        stats: [
          { label: "Facturas", value: String(invoices.length) },
          { label: "Base imponible", value: formatEuroForPdf(totals.base) },
          { label: "IVA", value: formatEuroForPdf(totals.vat) },
          { label: "Total", value: formatEuroForPdf(totals.total) },
        ],
        sectionTitle: "Detalle de facturas",
        columns: [
          { header: "Fecha", value: (invoice: MarketingInvoice) => formatDate(invoice.invoiceDate), width: 20 },
          { header: "Proveedor", value: (invoice) => (invoice.invoiceNumber ? `${invoice.supplier} (${invoice.invoiceNumber})` : invoice.supplier), width: 46 },
          { header: "Concepto", value: (invoice) => invoice.concept ?? "—" },
          { header: "Categoría", value: (invoice) => expenseCategoryLabels[invoice.category], width: 32 },
          { header: "Unidad", value: (invoice) => unitName(invoice.businessUnitId), width: 24 },
          { header: "Base", value: (invoice) => formatEuroForPdf(invoice.baseAmount), width: 22, align: "right" },
          { header: "IVA", value: (invoice) => formatEuroForPdf(invoice.vatAmount), width: 20, align: "right" },
          { header: "Total", value: (invoice) => formatEuroForPdf(invoice.totalAmount), width: 22, align: "right" },
        ],
        rows: invoices,
        filename: `facturas_marketing_${year}.pdf`,
      });
    } catch (cause) {
      onMessage(reportSafeError(cause, "No se pudo generar el PDF."));
    } finally {
      setPdfBusy(false);
    }
  }

  return (
    <>
      <section
        className={dragging ? "panel invoice-dropzone dragging" : "panel invoice-dropzone"}
        onDragOver={(event) => { if (canEdit) { event.preventDefault(); setDragging(true); } }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <div>
          <strong>{step === "uploading" ? "Subiendo factura…" : step === "reading" ? "Leyendo la factura con IA…" : "Facturas de marketing"}</strong>
          <p className="muted">
            {canEdit
              ? "Arrastra aquí un PDF o pulsa «Subir factura». La IA rellena proveedor, fecha, base, IVA y total; tú revisas y guardas."
              : "Facturas registradas por Marketing. Puedes consultarlas y abrir los PDF."}
          </p>
        </div>
        <div className="panel-heading-trailing">
          <ReportExportButtons onExportCsv={exportCsv} onExportPdf={() => void exportPdf()} pdfBusy={pdfBusy} />
          {canEdit ? (
            <>
              <input ref={fileInputRef} type="file" accept="application/pdf,.pdf" hidden onChange={(event) => void handleFile(event.target.files?.[0])} />
              <button type="button" className="button button-primary" disabled={step !== "idle"} onClick={() => fileInputRef.current?.click()}>
                {step === "idle" ? "Subir factura" : "Procesando…"}
              </button>
            </>
          ) : null}
        </div>
      </section>

      <section className="panel table-panel">
        <div className="table-scroll">
          <table className="invoice-table">
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
              {visibleInvoices.map((invoice) => (
                <tr key={invoice.id}>
                  <td>{formatDate(invoice.invoiceDate)}</td>
                  <td><strong>{invoice.supplier}</strong><small>{invoice.invoiceNumber ? `Nº ${invoice.invoiceNumber}` : "Sin número"}</small></td>
                  <td>{invoice.concept || "—"}</td>
                  <td><span className="unit-name"><i style={{ background: expenseCategoryColors[invoice.category] }} />{expenseCategoryLabels[invoice.category]}</span></td>
                  <td>{unitName(invoice.businessUnitId)}</td>
                  <td>{currencyFormatter.format(invoice.baseAmount)}</td>
                  <td>{currencyFormatter.format(invoice.vatAmount)}</td>
                  <td><strong>{currencyFormatter.format(invoice.totalAmount)}</strong></td>
                  <td>{invoice.expenseId ? <span className="badge" title="Cuenta como el cargo real de esta suscripción en su periodo">Suscripción · {expenseName(invoice.expenseId)}</span> : <span className="badge badge-active">Gasto suelto</span>}</td>
                  <td className="muted">{formatDate(invoice.createdAt)}</td>
                  <td>
                    <div className="table-actions">
                      {invoice.filePath ? <button type="button" className="button button-compact button-secondary" onClick={() => void viewPdf(invoice.filePath as string)}>PDF</button> : null}
                      {canEdit && invoice.filePath ? <button type="button" className="button button-compact button-secondary" onClick={() => setPendingSend({ id: invoice.id, supplier: invoice.supplier })} title="Enviar esta factura por correo a contabilidad">Enviar</button> : null}
                      <button type="button" className="button button-compact button-secondary" onClick={() => openEdit(invoice)}>{canEdit ? "Editar" : "Ver"}</button>
                    </div>
                  </td>
                </tr>
              ))}
              {invoices.length === 0 ? <tr><td colSpan={11} className="muted">{allInvoices.length === 0 ? "Todavía no hay facturas. Sube la primera en PDF." : `Sin facturas en ${year} con estos filtros.`}</td></tr> : null}
            </tbody>
            {invoices.length ? (
              <tfoot>
                <tr className="channel-table-footer-row"><td colSpan={5}><strong>Total {year}</strong></td><td>{currencyFormatter.format(totals.base)}</td><td>{currencyFormatter.format(totals.vat)}</td><td><strong>{currencyFormatter.format(totals.total)}</strong></td><td colSpan={3} /></tr>
              </tfoot>
            ) : null}
          </table>
        </div>
        <TablePagination page={currentPage} pageCount={pageCount} total={sortedInvoices.length} label="facturas" onChange={setPage} />
      </section>

      <ConfirmationDialog
        open={Boolean(pendingSend)}
        title={lastSend ? "Esta factura ya se ha enviado" : "¿Enviar la factura por correo?"}
        confirmLabel={lastSend ? "Enviar otra vez" : "Sí, enviar"}
        cancelLabel="Ahora no"
        busyLabel="Enviando…"
        busy={busy || previousSends === null}
        onCancel={() => setPendingSend(null)}
        onConfirm={() => pendingSend && void sendInvoice(pendingSend.id)}
      >
        {pendingSend ? (
          <>
            {lastSend ? (
              <div className="notice vault-weak-notice">
                <div>
                  <strong>Ya ha salido {sendCountLabel}.</strong>
                  <span>
                    La última vez el {formatDate(lastSend.at)}
                    {lastSend.by ? `, enviada por ${lastSend.by}` : ""}. Si la envías de nuevo, contabilidad recibirá la misma factura otra vez.
                  </span>
                </div>
              </div>
            ) : null}
            <div className="confirmation-summary">
              <span>Factura</span><strong>{pendingSend.supplier}</strong>
              <span>Se envía a</span><strong>{mailbox || "la dirección configurada para facturas"}</strong>
              <span>Qué lleva</span><strong>El PDF adjunto y un resumen con proveedor, número, fecha, base, IVA y total.</strong>
            </div>
          </>
        ) : null}
      </ConfirmationDialog>

      <ConfirmationDialog open={Boolean(pendingDelete)} title="¿Eliminar la factura?" confirmLabel="Eliminar" destructive busy={busy} onCancel={() => setPendingDelete(null)} onConfirm={() => void confirmDelete()}>
        {pendingDelete ? <div className="confirmation-summary"><span>Factura</span><strong>{pendingDelete.supplier}{pendingDelete.invoiceNumber ? ` · ${pendingDelete.invoiceNumber}` : ""}</strong><span>Efecto</span><strong>Se borran el registro y el PDF. No se puede deshacer.</strong></div> : null}
      </ConfirmationDialog>

      <Modal open={editorOpen} title={editingId ? "Editar factura" : "Nueva factura"} eyebrow="Gastos de marketing" onClose={() => void closeEditor()}>
        <form className="lead-editor-form" onSubmit={saveInvoice}>
          {aiNote ? <div className="notice invoice-ai-note"><span>{aiNote}</span></div> : null}
          {duplicate ? <div className="form-error" role="alert">Ya hay una factura de {duplicate.supplier} con el número {duplicate.invoiceNumber} ({formatDate(duplicate.invoiceDate)}). Comprueba que no la estás subiendo dos veces.</div> : null}
          <div className="form-grid">
            <label><span>Proveedor *</span><input value={draft.supplier} readOnly={!canEdit} maxLength={160} onChange={(event) => updateDraft("supplier", event.target.value)} required /></label>
            <label><span>Nº de factura</span><input value={draft.invoiceNumber ?? ""} readOnly={!canEdit} maxLength={80} onChange={(event) => updateDraft("invoiceNumber", event.target.value)} /></label>
            <label><span>Fecha de la factura *</span><input type="date" value={draft.invoiceDate} readOnly={!canEdit} onChange={(event) => updateDraft("invoiceDate", event.target.value)} required /></label>
            <label><span>Concepto</span><input value={draft.concept ?? ""} readOnly={!canEdit} maxLength={200} onChange={(event) => updateDraft("concept", event.target.value)} /></label>
            <label><span>Base imponible (€) *</span><input type="number" min="0" step="0.01" value={draft.baseAmount} readOnly={!canEdit} onChange={(event) => updateAmount("baseAmount", Number(event.target.value) || 0)} required /></label>
            <label><span>IVA (€)</span><input type="number" min="0" step="0.01" value={draft.vatAmount} readOnly={!canEdit} onChange={(event) => updateAmount("vatAmount", Number(event.target.value) || 0)} /></label>
            <label><span>Total (€) *</span><input type="number" min="0" step="0.01" value={draft.totalAmount} readOnly={!canEdit} onChange={(event) => updateDraft("totalAmount", Number(event.target.value) || 0)} required /></label>
            <label><span>Categoría</span><select value={draft.category} disabled={!canEdit} onChange={(event) => updateDraft("category", event.target.value as ExpenseCategory)}>
              {Object.entries(expenseCategoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select></label>
            <label><span>Unidad</span><select value={draft.businessUnitId ?? ""} disabled={!canEdit} onChange={(event) => updateDraft("businessUnitId", event.target.value || null)}>
              <option value="">General (todas)</option>
              {units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
            </select></label>
            <label><span>¿Es de una suscripción?</span><select
              value={newSubscription ? `new:${newSubscription}` : draft.expenseId ?? ""}
              disabled={!canEdit}
              onChange={(event) => {
                const value = event.target.value;
                if (value.startsWith("new:")) {
                  setNewSubscription(value.slice(4) as BillingPeriod);
                  updateDraft("expenseId", null);
                } else {
                  setNewSubscription(null);
                  updateDraft("expenseId", value || null);
                }
              }}
            >
              <option value="">No, es un gasto suelto</option>
              {subscriptions.map((expense) => <option key={expense.id} value={expense.id}>Sí: {expense.name}{expense.status === "cancelled" ? " (de baja)" : ""}</option>)}
              {!editingId || !draft.expenseId ? (
                <optgroup label="Crear suscripción nueva">
                  {(Object.keys(billingPeriodLabels) as BillingPeriod[]).map((period) => <option key={period} value={`new:${period}`}>+ Nueva suscripción {billingPeriodLabels[period].toLowerCase()}</option>)}
                </optgroup>
              ) : null}
            </select></label>
            <label className="form-field-wide"><span>Notas</span><textarea rows={2} value={draft.notes ?? ""} readOnly={!canEdit} onChange={(event) => updateDraft("notes", event.target.value)} /></label>
          </div>
          {newSubscription ? <p className="muted invoice-hint">Al guardar se crea en Suscripciones «{draft.supplier || "este proveedor"}» ({billingPeriodLabels[newSubscription].toLowerCase()}, {currencyFormatter.format(draft.baseAmount)} sin IVA, desde el {draft.invoiceDate ? formatDate(draft.invoiceDate) : "—"}) y esta factura queda como su justificante. Si ya pagabas antes, ajusta luego la fecha del primer cargo en la suscripción.</p> : null}
          {draft.expenseId ? <p className="muted invoice-hint">Asociada a una suscripción: cuenta como el cargo real de ese periodo y sustituye a la estimación de la suscripción, así que no se suma dos veces.</p> : null}
          {Math.abs(round2(draft.baseAmount + draft.vatAmount) - round2(draft.totalAmount)) > 0.01 ? <p className="muted invoice-hint">Ojo: base + IVA ({currencyFormatter.format(draft.baseAmount + draft.vatAmount)}) no coincide con el total. Puede haber retenciones o recargos; revísalo.</p> : null}
          <div className="modal-actions">
            {canEdit && editingId ? <button type="button" className="button button-secondary expenses-delete" onClick={() => setPendingDelete(allInvoices.find((invoice) => invoice.id === editingId) ?? null)}>Eliminar</button> : null}
            {draft.filePath ? <button type="button" className="button button-secondary" onClick={() => void viewPdf(draft.filePath as string)}>Ver PDF</button> : null}
            <button type="button" className="button button-secondary" onClick={() => void closeEditor()}>{editingId ? "Cerrar" : "Cancelar"}</button>
            {canEdit ? <button type="submit" className="button button-primary" disabled={busy}>{busy ? "Guardando…" : "Guardar factura"}</button> : null}
          </div>
        </form>
      </Modal>
    </>
  );
}
