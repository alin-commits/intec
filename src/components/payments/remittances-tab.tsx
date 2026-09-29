"use client";

import { useState } from "react";
import { numberFormatter } from "@/lib/format";
import { settingKey } from "@/lib/payments";
import { createClient } from "@/lib/supabase/client";
import { DataTable, LoadFailed, Panel, useSageQuery, type Column } from "@/components/sales/sales-ui";
import type { PaymentsContext } from "./payments-view";
import { RemittanceModal, type Remittance } from "./remittance-modal";

const euros = (value: number) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(value);
const shortDate = (day: string | null) => (day ? new Date(`${day}T12:00:00`).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" }) : "—");

type FileRow = { company_code: number; remittance_number: number; generated_at: string };

export function RemittancesTab({ ctx, onConfigure }: { ctx: PaymentsContext; onConfigure: () => void }) {
  const [company, setCompany] = useState<number | null>(null);
  const [onlyPending, setOnlyPending] = useState(true);
  const [open, setOpen] = useState<Remittance | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const data = useSageQuery<{ remittances: Remittance[]; files: FileRow[] }>(JSON.stringify(["remesas", reloadKey]), async () => {
    const supabase = createClient();
    const [remittances, files] = await Promise.all([
      supabase.from("sage_payment_remittances").select("*").order("remittance_date", { ascending: false }).limit(500),
      supabase.from("payment_files").select("company_code, remittance_number, generated_at").order("generated_at", { ascending: false }).limit(2000),
    ]);
    const error = remittances.error ?? files.error;
    return { data: error ? null : { remittances: (remittances.data ?? []) as Remittance[], files: (files.data ?? []) as FileRow[] }, error };
  });

  const lastFile = new Map<string, string>();
  for (const file of data.data?.files ?? []) {
    const key = `${file.company_code}|${file.remittance_number}`;
    if (!lastFile.has(key)) lastFile.set(key, file.generated_at);
  }
  const settingFor = (row: Remittance) => ctx.settings.find((setting) => settingKey(setting.company_code, setting.sage_bank_code) === settingKey(row.company_code, row.bank_code));
  const rows = (data.data?.remittances ?? [])
    .filter((row) => company === null || row.company_code === company)
    .filter((row) => !onlyPending || !lastFile.has(`${row.company_code}|${row.number}`));
  const unconfigured = new Set((data.data?.remittances ?? []).filter((row) => !settingFor(row)).map((row) => settingKey(row.company_code, row.bank_code)));

  const columns: Column<Remittance>[] = [
    { key: "remesa", header: "Remesa", text: true, render: (row) => (
      <span className="sales-article">
        <strong>Nº {row.number}</strong>
        <small>{ctx.companyName(row.company_code)}</small>
      </span>
    ), sort: (row) => row.number },
    { key: "fecha", header: "Fecha", render: (row) => shortDate(row.remittance_date), sort: (row) => row.remittance_date ?? "" },
    { key: "banco", header: "Banco", text: true, render: (row) => {
      const setting = settingFor(row);
      return setting
        ? <span className="sales-article"><strong>{setting.bank_name}</strong><small>{row.bank_code}</small></span>
        : <span className="sales-article"><strong className="sales-down">Sin configurar</strong><small>{row.bank_code || "sin banco"}</small></span>;
    }, sort: (row) => settingFor(row)?.bank_name ?? "" },
    { key: "efectos", header: "Efectos", optional: true, render: (row) => numberFormatter.format(row.effects), sort: (row) => row.effects },
    { key: "total", header: "Importe", render: (row) => euros(Number(row.total)), sort: (row) => Number(row.total) },
    { key: "fichero", header: "Fichero", text: true, render: (row) => {
      const when = lastFile.get(`${row.company_code}|${row.number}`);
      return when
        ? <span className="sales-up">Generado el {new Date(when).toLocaleDateString("es-ES")}</span>
        : <span className="muted">Pendiente</span>;
    }, sort: (row) => lastFile.get(`${row.company_code}|${row.number}`) ?? "" },
  ];

  return (
    <div className="page-stack">
      {unconfigured.size > 0 ? (
        <section className="panel sales-warning">
          <div>
            <strong>{unconfigured.size === 1 ? "Hay un banco de Sage sin contrato de confirming" : `Hay ${unconfigured.size} bancos de Sage sin contrato de confirming`}</strong>
            <span>
              Para generar el fichero de una remesa hace falta saber de qué banco es y su contrato (número, IBAN de cargo…).
              Se pone una vez por sociedad y banco.{" "}
              <button type="button" className="text-link" onClick={onConfigure}>Configurar los bancos</button>
            </span>
          </div>
        </section>
      ) : null}

      <Panel
        title="Remesas de pagos de Sage"
        subtitle="Las de los últimos 180 días. Pulsa una para revisar sus pagos y generar el fichero del banco"
        className="panel table-panel"
        trailing={(
          <>
            <select className="panel-heading-select" value={company ?? ""} onChange={(event) => setCompany(event.target.value ? Number(event.target.value) : null)} aria-label="Sociedad">
              <option value="">Todas las sociedades</option>
              {ctx.companies.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}
            </select>
            <div className="sales-switch" role="group" aria-label="Qué remesas">
              <button type="button" className={onlyPending ? "is-active" : undefined} aria-pressed={onlyPending} onClick={() => setOnlyPending(true)}>Sin fichero</button>
              <button type="button" className={!onlyPending ? "is-active" : undefined} aria-pressed={!onlyPending} onClick={() => setOnlyPending(false)}>Todas</button>
            </div>
          </>
        )}
      >
        {data.failed ? <LoadFailed what="las remesas" /> : (
          <DataTable
            rows={rows}
            columns={columns}
            rowKey={(row) => `${row.company_code}-${row.number}`}
            onRowClick={setOpen}
            initialSort={{ key: "fecha", desc: true }}
            limit={25}
            empty={data.loading ? "Cargando…" : data.data && data.data.remittances.length === 0
              ? "Todavía no ha llegado ninguna remesa de pagos. Aparecerán cuando el programa del servidor de Sage lea la parte de pagos."
              : onlyPending ? "Todas las remesas tienen ya su fichero. Pulsa «Todas» para verlas." : "Ninguna remesa con estos filtros."}
          />
        )}
      </Panel>

      <RemittanceModal
        remittance={open}
        ctx={ctx}
        setting={open ? settingFor(open) ?? null : null}
        allRemittances={data.data?.remittances ?? []}
        onClose={() => setOpen(null)}
        onGenerated={() => setReloadKey((key) => key + 1)}
        onConfigure={() => { setOpen(null); onConfigure(); }}
      />
    </div>
  );
}
