"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { buildConfirmingFile, confirmingFileName, isValidIban, type ConfirmingPayment } from "@/lib/confirming";
import { changedIbans, maskIban, type BankSetting } from "@/lib/payments";
import { createClient } from "@/lib/supabase/client";
import { DataTable, LoadFailed, useSageQuery, type Column } from "@/components/sales/sales-ui";
import type { PaymentsContext } from "./payments-view";

export type Remittance = {
  company_code: number;
  number: number;
  remittance_date: string | null;
  value_date: string | null;
  bank_code: string;
  remittance_type: string | null;
  csb_norm: string | null;
  total: number;
  effects: number;
  provisional: boolean;
};
type Item = {
  movement_id: string;
  supplier_code: string;
  invoice_number: string | null;
  invoice_date: string | null;
  due_date: string | null;
  amount: number;
  pending: number;
  iban: string | null;
  remittance_number: number;
};
type Supplier = { code: string; name: string; nif: string | null; address: string | null; postal_code: string | null; city: string | null; province: string | null; phone: string | null; email: string | null };
type PreviousFile = { id: string; file_name: string; generated_at: string; total: number; content: string; bank_name: string };

const euros = (value: number) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(value);
const shortDate = (day: string | null) => (day ? new Date(`${day}T12:00:00`).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" }) : "—");

/** Descarga un texto como fichero, tal cual (los bancos quieren ASCII y saltos de Windows). */
function downloadText(fileName: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=us-ascii" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function RemittanceModal({ remittance, ctx, setting, allRemittances, onClose, onGenerated, onConfigure }: {
  remittance: Remittance | null;
  ctx: PaymentsContext;
  setting: BankSetting | null;
  allRemittances: Remittance[];
  onClose: () => void;
  onGenerated: () => void;
  onConfigure: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [confirmAgain, setConfirmAgain] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  /** Con un IBAN cambiado, quien genera el fichero tiene que decir que lo ha comprobado. */
  const [ibanChecked, setIbanChecked] = useState(false);
  const [checkedFor, setCheckedFor] = useState<Remittance | null>(remittance);
  if (checkedFor !== remittance) {
    setCheckedFor(remittance);
    setIbanChecked(false);
  }

  const key = remittance ? JSON.stringify([remittance.company_code, remittance.number, reloadKey]) : null;
  const data = useSageQuery<{ items: Item[]; suppliers: Supplier[]; history: Item[]; files: PreviousFile[] }>(key, async () => {
    if (!remittance) return { data: null, error: null };
    const supabase = createClient();
    const items = await supabase.from("sage_payment_remittance_items")
      .select("movement_id, supplier_code, invoice_number, invoice_date, due_date, amount, pending, iban, remittance_number")
      .eq("company_code", remittance.company_code).eq("remittance_number", remittance.number);
    if (items.error) return { data: null, error: items.error };
    const codes = [...new Set((items.data ?? []).map((item) => item.supplier_code as string))];
    const [suppliers, history, files] = await Promise.all([
      codes.length
        ? supabase.from("sage_suppliers").select("code, name, nif, address, postal_code, city, province, phone, email").eq("company_code", remittance.company_code).in("code", codes)
        : Promise.resolve({ data: [], error: null }),
      codes.length
        ? supabase.from("sage_payment_remittance_items").select("supplier_code, iban, remittance_number").eq("company_code", remittance.company_code)
          .in("supplier_code", codes).neq("remittance_number", remittance.number).limit(5000)
        : Promise.resolve({ data: [], error: null }),
      supabase.from("payment_files").select("id, file_name, generated_at, total, content, bank_name")
        .eq("company_code", remittance.company_code).eq("remittance_number", remittance.number).order("generated_at", { ascending: false }),
    ]);
    const error = suppliers.error ?? history.error ?? files.error;
    return {
      data: error ? null : {
        items: (items.data ?? []) as Item[],
        suppliers: (suppliers.data ?? []) as Supplier[],
        history: (history.data ?? []) as Item[],
        files: (files.data ?? []) as PreviousFile[],
      },
      error,
    };
  });

  if (!remittance) return null;
  const loaded = data.data;
  const suppliers = new Map((loaded?.suppliers ?? []).map((supplier) => [supplier.code, supplier]));
  const details = ctx.details.get(remittance.company_code);
  const company = ctx.companies.find((item) => item.code === remittance.company_code);
  const remittanceDate = remittance.remittance_date ?? ctx.today;

  // IBAN distinto al del último pago anterior a este proveedor.
  const dates = new Map(allRemittances.filter((row) => row.company_code === remittance.company_code).map((row) => [row.number, row.remittance_date]));
  const changes = changedIbans(
    (loaded?.items ?? []).map((item) => ({ supplierCode: item.supplier_code, iban: item.iban, date: remittanceDate })),
    (loaded?.history ?? []).map((item) => ({ supplierCode: item.supplier_code, iban: item.iban, date: dates.get(item.remittance_number) ?? null })),
    remittanceDate,
  );

  const payments: ConfirmingPayment[] = (loaded?.items ?? []).map((item) => {
    const supplier = suppliers.get(item.supplier_code);
    return {
      supplierCode: item.supplier_code,
      supplierName: supplier?.name ?? "",
      supplierNif: supplier?.nif ?? "",
      address: supplier?.address ?? null,
      city: supplier?.city ?? null,
      postalCode: supplier?.postal_code ?? null,
      province: supplier?.province ?? null,
      countryCode: "ES",
      email: supplier?.email ?? null,
      phone: supplier?.phone ?? null,
      iban: item.iban,
      invoiceNumber: item.invoice_number ?? "",
      invoiceDate: item.invoice_date ?? item.due_date ?? remittanceDate,
      dueDate: item.due_date ?? remittanceDate,
      // Se paga lo que queda pendiente del efecto; si Sage lo da ya por pagado, su importe.
      amount: Number(item.pending) || Number(item.amount),
      reference: `R${remittance.number}`,
    };
  });

  const result = setting && loaded
    ? buildConfirmingFile({
        payer: { name: company?.name ?? "", nif: details?.nif ?? "", address: details?.address, city: details?.city, postalCode: details?.postal_code, province: details?.province },
        contract: {
          format: setting.format,
          contract: setting.contract,
          suffix: setting.suffix,
          chargeIban: setting.charge_iban,
          modality: setting.modality,
          deferralDays: setting.deferral_days,
          writeChargeDate: setting.write_charge_date,
          fallbackEmail: setting.fallback_email,
        },
        remittanceDate,
        sendDate: ctx.today,
        fileReference: `REM${remittance.number}`,
        payments,
      })
    : null;

  const previous = loaded?.files ?? [];
  const blocked = !result || result.errors.length > 0 || (changes.size > 0 && !ibanChecked);

  async function generate() {
    if (!result || !setting || !remittance) return;
    setBusy(true);
    const fileName = confirmingFileName(setting.bank_name, remittance.company_code, remittance.number, ctx.today);
    const { error } = await createClient().from("payment_files").insert({
      company_code: remittance.company_code,
      remittance_number: remittance.number,
      bank_setting_id: setting.id,
      bank_name: setting.bank_name,
      format: setting.format,
      file_name: fileName,
      content: result.content,
      suppliers: result.suppliers,
      payments: payments.length,
      total: result.total,
      warnings: [...result.warnings, ...[...changes].map(([code, change]) => `IBAN cambiado en ${suppliers.get(code)?.name ?? code}: antes ${change.previous}, ahora ${change.current}`)],
      generated_by: ctx.userId,
    });
    setBusy(false);
    setConfirmAgain(false);
    if (error) {
      console.error("No se pudo apuntar el fichero:", error);
      ctx.notify("No se pudo guardar el registro del fichero, así que no se ha descargado. Vuelve a intentarlo.");
      return;
    }
    // Solo se descarga si ha quedado apuntado: así nunca sale un fichero sin registro.
    downloadText(fileName, result.content);
    ctx.notify(`Fichero ${fileName} generado. Súbelo a la web de ${setting.bank_name} para firmarlo.`);
    setReloadKey((value) => value + 1);
    onGenerated();
  }

  const columns: Column<ConfirmingPayment>[] = [
    { key: "proveedor", header: "Proveedor", text: true, render: (row) => {
      const change = changes.get(row.supplierCode);
      return (
        <span className="sales-article">
          <strong>{row.supplierName || `Proveedor ${row.supplierCode}`}</strong>
          <small>{[row.supplierNif || "sin NIF", row.city, row.email ? null : "sin correo"].filter(Boolean).join(" · ")}</small>
          {change ? <small className="sales-down">IBAN distinto al del último pago ({maskIban(change.previous)})</small> : null}
        </span>
      );
    }, sort: (row) => row.supplierName },
    { key: "factura", header: "Factura", text: true, render: (row) => (
      <span className="sales-article"><strong>{row.invoiceNumber || "—"}</strong><small>{shortDate(row.invoiceDate)}</small></span>
    ), sort: (row) => row.invoiceNumber },
    { key: "vence", header: "Vence", render: (row) => shortDate(row.dueDate), sort: (row) => row.dueDate },
    { key: "importe", header: "Importe", render: (row) => <span className={row.amount < 0 ? "sales-down" : undefined}>{euros(row.amount)}</span>, sort: (row) => row.amount },
    { key: "iban", header: "IBAN", text: true, optional: true, render: (row) => (
      <span className={isValidIban(row.iban) ? undefined : "sales-down"}>{row.iban ? maskIban(row.iban) : "Sin IBAN"}</span>
    ) },
  ];

  return (
    <Modal open title={`Remesa ${remittance.number} · ${company?.name ?? ""}`} eyebrow={`${shortDate(remittance.remittance_date)} · ${euros(Number(remittance.total))} · ${remittance.effects} efectos`} onClose={onClose} scrollInside>
      {data.failed ? <LoadFailed what="los pagos de la remesa" /> : !loaded ? <p className="muted">Cargando…</p> : (
        <div className="payments-modal">
          {!setting ? (
            <section className="sales-pending">
              <strong>Esta remesa es del banco «{remittance.bank_code || "sin banco"}» de Sage, que aún no tiene contrato de confirming</strong>
              <span>Dile al Hub qué banco es y pon su contrato una vez; a partir de ahí, todas sus remesas salen solas.</span>
              <button type="button" className="button button-compact button-primary" onClick={onConfigure}>Configurar el banco</button>
            </section>
          ) : (
            <p className="payments-bank-line">
              <strong>{setting.bank_name}</strong> · contrato {setting.contract || "sin número"} ·{" "}
              {setting.format === "bbva" ? "Euroconfirming BBVA" : "formato estándar AEF"} ·{" "}
              {setting.modality === "pronto_pago" ? "pronto pago" : setting.modality === "estandar" ? "estándar" : "otros"}
              {setting.deferral_days ? ` · el banco carga ${setting.deferral_days} días después del vencimiento` : ""}
            </p>
          )}

          {changes.size > 0 ? (
            <section className="panel sales-broken">
              <div>
                <strong>{changes.size === 1 ? "Un proveedor cobra en una cuenta distinta a la del último pago" : `${changes.size} proveedores cobran en una cuenta distinta a la del último pago`}</strong>
                <span>
                  Es el engaño más habitual: una factura o un correo que dice que el proveedor ha cambiado de banco. Antes de mandar el
                  fichero, confírmalo por teléfono con el proveedor, a un número que ya tuvierais, no al del correo.{" "}
                  {[...changes].map(([code, change]) => `${suppliers.get(code)?.name ?? code}: ${maskIban(change.previous)} → ${maskIban(change.current)}`).join(" · ")}
                </span>
                <label className="payments-check">
                  <input type="checkbox" checked={ibanChecked} onChange={(event) => setIbanChecked(event.target.checked)} />
                  He confirmado por teléfono con cada proveedor que la cuenta nueva es suya
                </label>
              </div>
            </section>
          ) : null}

          {result && result.errors.length > 0 ? (
            <section className="panel sales-broken">
              <div>
                <strong>El banco rechazaría el fichero. Hay que arreglar esto en Sage (o en la configuración del banco):</strong>
                <ul className="payments-issues">{result.errors.slice(0, 30).map((error) => <li key={error}>{error}</li>)}</ul>
                {result.errors.length > 30 ? <span>…y {result.errors.length - 30} más.</span> : null}
                <span>Cuando lo corrijas en Sage, pulsa «Actualizar desde Sage» en Ventas o espera a la siguiente lectura.</span>
              </div>
            </section>
          ) : null}
          {result && result.warnings.length > 0 ? (
            <section className="panel sales-warning">
              <div>
                <strong>Para revisar (no impide generar el fichero)</strong>
                <ul className="payments-issues">{result.warnings.slice(0, 15).map((warning) => <li key={warning}>{warning}</li>)}</ul>
              </div>
            </section>
          ) : null}

          <DataTable rows={payments} columns={columns} rowKey={(row) => `${row.supplierCode}-${row.invoiceNumber}-${row.dueDate}-${row.amount}`} initialSort={{ key: "proveedor", desc: false }} limit={50} empty="Esta remesa no tiene pagos en el Hub." />

          {previous.length > 0 ? (
            <section className="payments-files">
              <h3 className="sales-subheading">Ficheros ya generados de esta remesa</h3>
              <ul>
                {previous.map((file) => (
                  <li key={file.id}>
                    <span>{new Date(file.generated_at).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" })} · {file.bank_name} · {euros(Number(file.total))}</span>
                    <button type="button" className="text-link" onClick={() => downloadText(file.file_name, file.content)}>Volver a descargar</button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <div className="payments-actions">
            <span className="muted">
              {result ? `${result.suppliers} proveedores · ${payments.length} pagos · ${euros(result.total)}` : ""}
              {result && Math.abs(result.total - Number(remittance.total)) > 0.01 ? ` (en Sage la remesa suma ${euros(Number(remittance.total))})` : ""}
            </span>
            <button
              type="button"
              className="button button-primary"
              disabled={busy || blocked || !setting}
              onClick={() => (previous.length > 0 ? setConfirmAgain(true) : void generate())}
            >
              {busy ? "Generando…" : "Generar y descargar el fichero"}
            </button>
          </div>
        </div>
      )}

      <ConfirmationDialog
        open={confirmAgain}
        title="Esta remesa ya tiene fichero"
        confirmLabel="Generar otro"
        busy={busy}
        busyLabel="Generando…"
        onCancel={() => setConfirmAgain(false)}
        onConfirm={() => void generate()}
      >
        <p>
          Se generó el {previous[0] ? new Date(previous[0].generated_at).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" }) : ""}.
          Si ya lo subiste al banco, subir otro pagaría dos veces. Genera otro solo si el banco rechazó el anterior o no llegaste a subirlo.
        </p>
      </ConfirmationDialog>
    </Modal>
  );
}
