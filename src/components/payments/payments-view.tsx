"use client";

import { useCallback, useEffect, useState } from "react";
import { hasAnyRole, PAYMENTS_ROLES } from "@/lib/constants";
import type { BankSetting } from "@/lib/payments";
import { createClient } from "@/lib/supabase/client";
import { loadCurrentProfile } from "@/lib/supabase/current-profile";
import { Toast } from "@/components/ui/toast";
import { SageRefreshButton } from "@/components/sage-refresh-button";
import { RemittancesTab } from "./remittances-tab";
import { TreasuryTab } from "./treasury-tab";
import { BankSettingsTab } from "./bank-settings-tab";
import { PageLoader } from "@/components/ui/page-loader";

/*
  Pagos a proveedores. Las remesas se siguen haciendo en Sage; aquí se
  convierten en el fichero de confirming de cada banco, se ve la previsión de
  tesorería y se guardan los contratos de confirming, que no están en Sage.
*/

export type Company = { code: number; name: string; is_active: boolean };
export type CompanyDetails = { company_code: number; nif: string | null; address: string | null; postal_code: string | null; city: string | null; province: string | null };
export type PaymentsContext = {
  companies: Company[];
  companyName: (code: number) => string;
  details: Map<number, CompanyDetails>;
  settings: BankSetting[];
  reloadSettings: () => void;
  notify: (message: string) => void;
  userId: string;
  today: string;
};

export type PaymentsTab = "remesas" | "tesoreria" | "bancos";
type Tab = PaymentsTab;
const tabs: { key: Tab; label: string }[] = [
  { key: "remesas", label: "Remesas de confirming" },
  { key: "tesoreria", label: "Tesorería" },
  { key: "bancos", label: "Bancos y contratos" },
];

const todayKey = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

/**
 * Con `tab`, la pestaña la elige quien la contiene (las páginas de
 * Administración) y aquí no se pintan las pestañas propias.
 */
export function PaymentsView({ tab: forcedTab, onTab }: { tab?: PaymentsTab; onTab?: (tab: PaymentsTab) => void } = {}) {
  const [stage, setStage] = useState<"loading" | "denied" | "ready" | "failed">("loading");
  const [ownTab, setOwnTab] = useState<Tab>("remesas");
  const tab = forcedTab ?? ownTab;
  const setTab = (next: Tab) => (onTab ? onTab(next) : setOwnTab(next));
  const [userId, setUserId] = useState("");
  const [companies, setCompanies] = useState<Company[]>([]);
  const [details, setDetails] = useState<Map<number, CompanyDetails>>(new Map());
  const [settings, setSettings] = useState<BankSetting[]>([]);
  const [settingsKey, setSettingsKey] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  /** Sube al terminar una lectura de Sage pedida desde aquí: las pestañas se vuelven a cargar. */
  const [reloadKey, setReloadKey] = useState(0);
  const [today] = useState(todayKey);

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
      const [companyRows, detailRows] = await Promise.all([
        supabase.from("sage_companies").select("code, name, is_active").order("code"),
        supabase.from("sage_company_details").select("company_code, nif, address, postal_code, city, province"),
      ]);
      if (!active) return;
      if (companyRows.error || detailRows.error) {
        console.error("No se pudo preparar Pagos:", companyRows.error ?? detailRows.error);
        setStage("failed");
        return;
      }
      setUserId(profile.id);
      setCompanies((companyRows.data ?? []) as Company[]);
      setDetails(new Map(((detailRows.data ?? []) as CompanyDetails[]).map((row) => [row.company_code, row])));
      setStage("ready");
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (stage !== "ready") return;
    let active = true;
    void createClient().from("payment_bank_settings").select("*").order("company_code").then(({ data, error }) => {
      if (!active) return;
      if (error) console.error("No se pudo leer la configuración de los bancos:", error);
      else setSettings((data ?? []) as BankSetting[]);
    });
    return () => { active = false; };
  }, [stage, settingsKey]);

  const companyName = useCallback(
    (code: number) => companies.find((company) => company.code === code)?.name ?? `Sociedad ${code}`,
    [companies],
  );

  if (stage === "denied") {
    return (
      <div className="page-stack">
        <section className="panel panel-padded">
          <h2>No tienes acceso a esta página</h2>
          <p>Los pagos a proveedores solo los ven Administración y quien administra el Hub.</p>
        </section>
      </div>
    );
  }
  if (stage === "failed") {
    return <div className="page-stack"><section className="panel panel-padded"><h2>No se pudo cargar</h2><p>Recarga la página para intentarlo otra vez.</p></section></div>;
  }
  if (stage === "loading") return <PageLoader label="Cargando los pagos…" />;

  const context: PaymentsContext = {
    companies,
    companyName,
    details,
    settings,
    reloadSettings: () => setSettingsKey((key) => key + 1),
    notify: setMessage,
    userId,
    today,
  };

  return (
    <div className="page-stack">
      <section className="section-heading">
        <div>
          <p>
            Las remesas de pagos se hacen en Sage como siempre. Aquí se convierten en el fichero de confirming de cada banco,
            listo para subir a su web y firmar allí.
          </p>
        </div>
        <div className="panel-heading-trailing">
          <SageRefreshButton onUpdated={() => { setReloadKey((key) => key + 1); setSettingsKey((key) => key + 1); }} />
        </div>
      </section>

      {forcedTab ? null : (
        <div className="view-tabs" role="tablist" aria-label="Apartados de pagos">
          {tabs.map((item) => (
            <button key={item.key} type="button" role="tab" aria-selected={tab === item.key} className={tab === item.key ? "view-tab active" : "view-tab"} onClick={() => setTab(item.key)}>
              {item.label}
            </button>
          ))}
        </div>
      )}

      <div role="tabpanel" key={reloadKey}>
        {tab === "remesas" ? <RemittancesTab ctx={context} onConfigure={() => setTab("bancos")} /> : null}
        {tab === "tesoreria" ? <TreasuryTab ctx={context} /> : null}
        {tab === "bancos" ? <BankSettingsTab ctx={context} /> : null}
      </div>

      <Toast message={message} onDismiss={() => setMessage(null)} />
    </div>
  );
}
