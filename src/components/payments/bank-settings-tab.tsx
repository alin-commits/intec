"use client";

import { useState } from "react";
import { isValidIban } from "@/lib/confirming";
import { BANK_NAMES, formatForBank, settingKey, type BankName, type BankSetting } from "@/lib/payments";
import { createClient } from "@/lib/supabase/client";
import { LoadFailed, Panel, useSageQuery } from "@/components/sales/sales-ui";
import type { PaymentsContext } from "./payments-view";

/*
  El contrato de confirming de cada sociedad con cada banco. No está en Sage:
  se pone aquí una vez. Cada remesa de Sage dice de qué banco es (su código en
  Sage) y con eso el Hub sabe qué contrato y qué formato le tocan.
*/

type Draft = {
  company_code: number;
  sage_bank_code: string;
  bank_name: BankName;
  contract: string;
  suffix: string;
  charge_iban: string;
  modality: "estandar" | "pronto_pago" | "otros";
  deferral_days: string;
  write_charge_date: boolean;
  fallback_email: string;
  active: boolean;
};

const guessBank = (code: string): BankName => {
  // En Sage el banco suele ser una cuenta 572 con el nombre del banco en la descripción, o su código de entidad.
  if (/0081|sabadell/i.test(code)) return "Sabadell";
  if (/0128|bankinter/i.test(code)) return "Bankinter";
  if (/0182|bbva/i.test(code)) return "BBVA";
  return "Sabadell";
};

function draftFrom(setting: BankSetting | undefined, companyCode: number, bankCode: string): Draft {
  return {
    company_code: companyCode,
    sage_bank_code: bankCode,
    bank_name: (setting?.bank_name as BankName) ?? guessBank(bankCode),
    contract: setting?.contract ?? "",
    suffix: setting?.suffix ?? "",
    charge_iban: setting?.charge_iban ?? "",
    modality: setting?.modality ?? "pronto_pago",
    deferral_days: setting?.deferral_days != null ? String(setting.deferral_days) : "",
    write_charge_date: setting?.write_charge_date ?? false,
    fallback_email: setting?.fallback_email ?? "",
    active: setting?.active ?? true,
  };
}

function problems(draft: Draft): string[] {
  const list: string[] = [];
  if (!draft.contract.trim()) list.push("Falta el número de contrato.");
  if (draft.bank_name === "BBVA" && draft.contract.trim().length > 8) list.push("En BBVA el contrato tiene como mucho 8 caracteres.");
  if (draft.charge_iban.trim() && !isValidIban(draft.charge_iban)) list.push("El IBAN de cargo no es válido.");
  if (draft.bank_name === "BBVA" && !draft.charge_iban.trim()) list.push("BBVA exige el IBAN de la cuenta de cargo.");
  if (draft.deferral_days && !/^\d{1,3}$/.test(draft.deferral_days.trim())) list.push("Los días de aplazamiento tienen que ser un número.");
  if (draft.fallback_email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.fallback_email.trim())) list.push("El correo por defecto no es válido.");
  return list;
}

export function BankSettingsTab({ ctx }: { ctx: PaymentsContext }) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [extra, setExtra] = useState<{ company: number; code: string }[]>([]);
  const [newCompany, setNewCompany] = useState<number>(ctx.companies[0]?.code ?? 1);
  const [newCode, setNewCode] = useState("");

  const used = useSageQuery<{ company_code: number; bank_code: string; remittance_date: string | null }[]>(JSON.stringify(["bancos-usados"]), async () =>
    await createClient().from("sage_payment_remittances").select("company_code, bank_code, remittance_date").order("remittance_date", { ascending: false }).limit(2000));

  // Los bancos que salen en las remesas de Sage, los ya configurados y los añadidos a mano.
  const pairs = new Map<string, { company: number; code: string; remittances: number; last: string | null }>();
  for (const row of used.data ?? []) {
    const key = settingKey(row.company_code, row.bank_code);
    const entry = pairs.get(key) ?? { company: row.company_code, code: row.bank_code, remittances: 0, last: row.remittance_date };
    entry.remittances += 1;
    pairs.set(key, entry);
  }
  for (const setting of ctx.settings) {
    const key = settingKey(setting.company_code, setting.sage_bank_code);
    if (!pairs.has(key)) pairs.set(key, { company: setting.company_code, code: setting.sage_bank_code, remittances: 0, last: null });
  }
  for (const item of extra) {
    const key = settingKey(item.company, item.code);
    if (!pairs.has(key)) pairs.set(key, { company: item.company, code: item.code, remittances: 0, last: null });
  }
  const list = [...pairs.entries()].sort((a, b) => a[1].company - b[1].company || a[1].code.localeCompare(b[1].code));

  const draftOf = (key: string, company: number, code: string) =>
    drafts[key] ?? draftFrom(ctx.settings.find((setting) => settingKey(setting.company_code, setting.sage_bank_code) === key), company, code);
  const update = (key: string, base: Draft, patch: Partial<Draft>) => setDrafts((current) => ({ ...current, [key]: { ...base, ...patch } }));

  async function save(key: string, draft: Draft) {
    const issues = problems(draft);
    if (issues.length > 0) {
      ctx.notify(issues.join(" "));
      return;
    }
    setSaving(key);
    const { error } = await createClient().from("payment_bank_settings").upsert({
      company_code: draft.company_code,
      sage_bank_code: draft.sage_bank_code,
      bank_name: draft.bank_name,
      format: formatForBank(draft.bank_name),
      contract: draft.contract.trim(),
      suffix: draft.suffix.trim() || null,
      charge_iban: draft.charge_iban.replace(/\s+/g, "").toUpperCase() || null,
      modality: draft.modality,
      deferral_days: draft.deferral_days.trim() ? Number(draft.deferral_days) : null,
      write_charge_date: draft.write_charge_date,
      fallback_email: draft.fallback_email.trim() || null,
      active: draft.active,
      updated_by: ctx.userId,
    }, { onConflict: "company_code,sage_bank_code" });
    setSaving(null);
    if (error) {
      console.error("No se pudo guardar el banco:", error);
      ctx.notify("No se pudo guardar. Vuelve a intentarlo.");
      return;
    }
    setDrafts((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    ctx.reloadSettings();
    ctx.notify("Banco guardado.");
  }

  return (
    <div className="page-stack">
      <Panel
        title="Bancos y contratos de confirming"
        subtitle="Uno por sociedad y banco de Sage. Lo que pongas aquí va en la cabecera de cada fichero"
        className="panel panel-padded"
      >
        {used.failed ? <LoadFailed what="los bancos de las remesas" /> : null}
        {list.length === 0 ? (
          <p className="muted">
            Todavía no ha llegado ninguna remesa de pagos de Sage. Cuando lleguen, cada banco saldrá aquí solo. Si quieres ir
            adelantando, añádelo a mano con su código de banco de Sage.
          </p>
        ) : (
          <div className="payments-banks">
            {list.map(([key, pair]) => {
              const draft = draftOf(key, pair.company, pair.code);
              const saved = ctx.settings.some((setting) => settingKey(setting.company_code, setting.sage_bank_code) === key);
              const dirty = Boolean(drafts[key]);
              const issues = problems(draft);
              return (
                <article key={key} className={`payments-bank${saved ? "" : " is-new"}`}>
                  <header>
                    <div>
                      <strong>{ctx.companyName(pair.company)}</strong>
                      <small>
                        Banco en Sage: «{pair.code || "sin código"}»
                        {pair.remittances ? ` · ${pair.remittances} remesas${pair.last ? `, la última del ${new Date(`${pair.last}T12:00:00`).toLocaleDateString("es-ES")}` : ""}` : " · sin remesas todavía"}
                      </small>
                    </div>
                    <span className={saved ? "sales-up" : "sales-down"}>{saved ? (dirty ? "Cambios sin guardar" : "Configurado") : "Sin configurar"}</span>
                  </header>
                  <div className="payments-bank-fields">
                    <label>
                      <span>Banco</span>
                      <select value={draft.bank_name} onChange={(event) => update(key, draft, { bank_name: event.target.value as BankName })}>
                        {BANK_NAMES.map((name) => <option key={name} value={name}>{name}</option>)}
                      </select>
                      <small>{draft.bank_name === "BBVA" ? "Euroconfirming BBVA" : "Formato estándar AEF"}</small>
                    </label>
                    <label>
                      <span>Nº de contrato de confirming</span>
                      <input value={draft.contract} onChange={(event) => update(key, draft, { contract: event.target.value })} maxLength={draft.bank_name === "BBVA" ? 8 : 20} />
                    </label>
                    {draft.bank_name === "BBVA" ? (
                      <label>
                        <span>Sufijo</span>
                        <input value={draft.suffix} onChange={(event) => update(key, draft, { suffix: event.target.value.replace(/\D/g, "") })} maxLength={3} inputMode="numeric" placeholder="000" />
                      </label>
                    ) : null}
                    <label className="is-wide">
                      <span>IBAN de la cuenta de cargo</span>
                      <input value={draft.charge_iban} onChange={(event) => update(key, draft, { charge_iban: event.target.value })} placeholder="ES00 0000 0000 0000 0000 0000" />
                    </label>
                    <label>
                      <span>Modalidad</span>
                      <select value={draft.modality} onChange={(event) => update(key, draft, { modality: event.target.value as Draft["modality"] })}>
                        <option value="pronto_pago">Pronto pago</option>
                        <option value="estandar">Estándar</option>
                        <option value="otros">Otros</option>
                      </select>
                    </label>
                    <label>
                      <span>Días de aplazamiento del cargo</span>
                      <input value={draft.deferral_days} onChange={(event) => update(key, draft, { deferral_days: event.target.value })} inputMode="numeric" placeholder="90" />
                      <small>Para la tesorería: cuándo te lo carga el banco.</small>
                    </label>
                    <label className="is-wide">
                      <span>Correo para proveedores sin correo en Sage</span>
                      <input value={draft.fallback_email} onChange={(event) => update(key, draft, { fallback_email: event.target.value })} placeholder="administracion@..." />
                      <small>{draft.bank_name === "BBVA" ? "BBVA no lo exige." : "El formato AEF exige un correo por proveedor."}</small>
                    </label>
                    <label className="payments-check is-wide">
                      <input type="checkbox" checked={draft.write_charge_date} onChange={(event) => update(key, draft, { write_charge_date: event.target.checked })} />
                      Escribir la fecha de cargo en cada factura (vencimiento + días de aplazamiento). Solo si el banco lo pide:
                      {draft.bank_name === "BBVA" ? " BBVA rechaza el fichero si no tienes firmado el anexo de aplazamiento." : " Sabadell solo lo usa en Confirming Plus."}
                    </label>
                  </div>
                  <footer>
                    <span className={issues.length ? "sales-down" : "muted"}>{issues.length ? issues.join(" ") : "Todo correcto."}</span>
                    <button type="button" className="button button-primary button-compact" disabled={saving === key || (saved && !dirty)} onClick={() => void save(key, draft)}>
                      {saving === key ? "Guardando…" : "Guardar"}
                    </button>
                  </footer>
                </article>
              );
            })}
          </div>
        )}
        <div className="payments-add-bank">
          <span className="sales-subheading">Añadir un banco a mano</span>
          <select className="panel-heading-select" value={newCompany} onChange={(event) => setNewCompany(Number(event.target.value))} aria-label="Sociedad">
            {ctx.companies.map((company) => <option key={company.code} value={company.code}>{company.name}</option>)}
          </select>
          <input value={newCode} onChange={(event) => setNewCode(event.target.value)} placeholder="Código del banco en Sage" aria-label="Código del banco en Sage" />
          <button
            type="button"
            className="button button-compact button-secondary"
            disabled={!newCode.trim()}
            onClick={() => { setExtra((current) => [...current, { company: newCompany, code: newCode.trim() }]); setNewCode(""); }}
          >
            Añadir
          </button>
        </div>
      </Panel>
    </div>
  );
}
