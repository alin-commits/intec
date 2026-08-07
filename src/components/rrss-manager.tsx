"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { BarChart } from "@/components/charts/bar-chart";
import { TrendChart } from "@/components/charts/trend-chart";
import { CollapsibleFilters } from "@/components/ui/collapsible-filters";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Modal } from "@/components/ui/modal";
import { KpiCard } from "@/components/kpi-card";
import {
  RRSS_ROLES,
  adStatusLabels,
  hasAnyRole,
  mailingTypeLabels,
  mailingTypeOrder,
  socialNetworkLabels,
  socialNetworkOrder,
} from "@/lib/constants";
import {
  businessUnits as demoBusinessUnits,
  campaigns as demoCampaigns,
  demoMailingCampaigns,
  demoMetaAdsEntries,
  demoSocialMediaStats,
} from "@/lib/demo-data";
import { monthKey, monthLabel, monthShortLabel } from "@/lib/dates";
import { reportSafeError } from "@/lib/errors";
import { currencyFormatter, formatDate, formatPercent, numberFormatter } from "@/lib/format";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import type {
  AdCampaignStatus,
  BusinessUnit,
  MailingCampaign,
  MailingCampaignType,
  MetaAdsEntry,
  SocialMediaStat,
  SocialNetwork,
} from "@/lib/types";

const SOCIAL_STORAGE_KEY = "intec-demo-social-media-stats";
const ADS_STORAGE_KEY = "intec-demo-meta-ads-entries";
const MAILING_STORAGE_KEY = "intec-demo-mailing-campaigns";

type Tab = "social" | "ads" | "mailing";

type SocialDraft = Omit<SocialMediaStat, "id" | "createdAt" | "createdBy">;
type AdsDraft = Omit<MetaAdsEntry, "id" | "createdAt" | "createdBy">;
type MailingDraft = Omit<MailingCampaign, "id" | "createdAt" | "createdBy">;

type PendingDelete = { table: "social_media_stats" | "meta_ads_entries" | "mailing_campaigns"; id: string; label: string };
type CampaignOption = { id: string; businessUnitId: string; name: string };

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? (numerator / denominator) * 100 : 0;
}

function safeDiv(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function blankSocialDraft(units: BusinessUnit[]): SocialDraft {
  return {
    businessUnitId: units[0]?.id ?? "",
    network: "facebook",
    periodMonth: monthKey(),
    followersEnd: 0,
    newFollowers: 0,
    posts: 0,
    interactions: 0,
    reach: 0,
    activeCampaigns: 0,
    linkClicks: 0,
    leads: 0,
    notes: "",
  };
}

function blankAdsDraft(units: BusinessUnit[]): AdsDraft {
  return {
    businessUnitId: units[0]?.id ?? "",
    campaignId: null,
    campaignName: "",
    adSet: "",
    adName: "",
    objective: "",
    status: "active",
    startDate: null,
    endDate: null,
    amountSpent: 0,
    impressions: 0,
    linkClicks: 0,
    leads: 0,
    qualifiedLeads: 0,
    purchases: 0,
    revenue: 0,
    notes: "",
  };
}

function blankMailingDraft(units: BusinessUnit[]): MailingDraft {
  return {
    businessUnitId: units[0]?.id ?? "",
    campaignName: "",
    campaignType: "newsletter",
    sentDate: new Date().toISOString().slice(0, 10),
    sentCount: 0,
    deliveredCount: 0,
    opens: 0,
    clicks: 0,
    leads: 0,
    salesCount: 0,
    revenue: 0,
    unsubscribes: 0,
    notes: "",
  };
}

function mapSocialRow(row: Record<string, unknown>): SocialMediaStat {
  return {
    id: String(row.id),
    businessUnitId: String(row.business_unit_id),
    network: row.network as SocialNetwork,
    periodMonth: String(row.period_month).slice(0, 7),
    followersEnd: Number(row.followers_end ?? 0),
    newFollowers: Number(row.new_followers ?? 0),
    posts: Number(row.posts ?? 0),
    interactions: Number(row.interactions ?? 0),
    reach: Number(row.reach ?? 0),
    activeCampaigns: Number(row.active_campaigns ?? 0),
    linkClicks: Number(row.link_clicks ?? 0),
    leads: Number(row.leads ?? 0),
    notes: row.notes ? String(row.notes) : null,
    createdBy: row.created_by ? String(row.created_by) : null,
    createdAt: String(row.created_at),
  };
}

function mapAdsRow(row: Record<string, unknown>): MetaAdsEntry {
  return {
    id: String(row.id),
    businessUnitId: String(row.business_unit_id),
    campaignId: row.campaign_id ? String(row.campaign_id) : null,
    campaignName: String(row.campaign_name),
    adSet: row.ad_set ? String(row.ad_set) : null,
    adName: row.ad_name ? String(row.ad_name) : null,
    objective: row.objective ? String(row.objective) : null,
    status: row.status as AdCampaignStatus,
    startDate: row.start_date ? String(row.start_date) : null,
    endDate: row.end_date ? String(row.end_date) : null,
    amountSpent: Number(row.amount_spent ?? 0),
    impressions: Number(row.impressions ?? 0),
    linkClicks: Number(row.link_clicks ?? 0),
    leads: Number(row.leads ?? 0),
    qualifiedLeads: Number(row.qualified_leads ?? 0),
    purchases: Number(row.purchases ?? 0),
    revenue: Number(row.revenue ?? 0),
    notes: row.notes ? String(row.notes) : null,
    createdBy: row.created_by ? String(row.created_by) : null,
    createdAt: String(row.created_at),
  };
}

function mapMailingRow(row: Record<string, unknown>): MailingCampaign {
  return {
    id: String(row.id),
    businessUnitId: String(row.business_unit_id),
    campaignName: String(row.campaign_name),
    campaignType: row.campaign_type as MailingCampaignType,
    sentDate: String(row.sent_date),
    sentCount: Number(row.sent_count ?? 0),
    deliveredCount: Number(row.delivered_count ?? 0),
    opens: Number(row.opens ?? 0),
    clicks: Number(row.clicks ?? 0),
    leads: Number(row.leads ?? 0),
    salesCount: Number(row.sales_count ?? 0),
    revenue: Number(row.revenue ?? 0),
    unsubscribes: Number(row.unsubscribes ?? 0),
    notes: row.notes ? String(row.notes) : null,
    createdBy: row.created_by ? String(row.created_by) : null,
    createdAt: String(row.created_at),
  };
}

function initialDemoState<T>(configured: boolean, storageKey: string, fallback: T[]): T[] {
  if (configured || typeof window === "undefined") return fallback;
  const saved = window.localStorage.getItem(storageKey);
  return saved ? (JSON.parse(saved) as T[]) : fallback;
}

export function RrssManager() {
  const configured = isSupabaseConfigured();
  const [tab, setTab] = useState<Tab>("social");
  const [units, setUnits] = useState<BusinessUnit[]>(demoBusinessUnits.filter((unit) => unit.active));
  const [socialStats, setSocialStats] = useState<SocialMediaStat[]>(() => initialDemoState(configured, SOCIAL_STORAGE_KEY, demoSocialMediaStats));
  const [adsEntries, setAdsEntries] = useState<MetaAdsEntry[]>(() => initialDemoState(configured, ADS_STORAGE_KEY, demoMetaAdsEntries));
  const [mailingCampaigns, setMailingCampaigns] = useState<MailingCampaign[]>(() => initialDemoState(configured, MAILING_STORAGE_KEY, demoMailingCampaigns));
  const [campaignOptions, setCampaignOptions] = useState<CampaignOption[]>(demoCampaigns.map((campaign) => ({ id: campaign.id, businessUnitId: campaign.businessUnitId, name: campaign.name })));
  const [canEdit, setCanEdit] = useState(true);
  const [access, setAccess] = useState<"checking" | "allowed" | "denied">(configured ? "checking" : "allowed");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);

  useEffect(() => {
    if (!configured) return;
    void loadRealData();
  }, [configured]);

  async function loadRealData() {
    const supabase = createClient();
    const [
      { data: unitData, error: unitError },
      { data: socialData, error: socialError },
      { data: adsData, error: adsError },
      { data: mailingData, error: mailingError },
      { data: campaignData },
      { data: authData },
    ] = await Promise.all([
      supabase.from("business_units").select("id, name, slug, brand_color, logo_url, is_active").eq("is_active", true).order("name"),
      supabase.from("social_media_stats").select("id, business_unit_id, network, period_month, followers_end, new_followers, posts, interactions, reach, active_campaigns, link_clicks, leads, notes, created_by, created_at").order("period_month", { ascending: false }),
      supabase.from("meta_ads_entries").select("id, business_unit_id, campaign_id, campaign_name, ad_set, ad_name, objective, status, start_date, end_date, amount_spent, impressions, link_clicks, leads, qualified_leads, purchases, revenue, notes, created_by, created_at").order("created_at", { ascending: false }),
      supabase.from("mailing_campaigns").select("id, business_unit_id, campaign_name, campaign_type, sent_date, sent_count, delivered_count, opens, clicks, leads, sales_count, revenue, unsubscribes, notes, created_by, created_at").order("sent_date", { ascending: false }),
      supabase.from("campaigns").select("id, business_unit_id, name").neq("status", "archived").order("name"),
      supabase.auth.getUser(),
    ]);
    if (unitError || socialError || adsError || mailingError) {
      setMessage(reportSafeError(unitError ?? socialError ?? adsError ?? mailingError, "No se pudieron cargar las métricas de marketing."));
      return;
    }
    setUnits((unitData ?? []).map((row) => ({ id: row.id, name: row.name, slug: row.slug, accent: row.brand_color || "#2563eb", active: row.is_active, logo: row.logo_url })));
    setSocialStats((socialData ?? []).map((row) => mapSocialRow(row as Record<string, unknown>)));
    setAdsEntries((adsData ?? []).map((row) => mapAdsRow(row as Record<string, unknown>)));
    setMailingCampaigns((mailingData ?? []).map((row) => mapMailingRow(row as Record<string, unknown>)));
    setCampaignOptions((campaignData ?? []).map((row) => ({ id: row.id, businessUnitId: row.business_unit_id, name: row.name })));
    const user = authData.user;
    if (user) {
      const { data: profile } = await supabase.from("profiles").select("roles").eq("id", user.id).maybeSingle();
      setCanEdit(Boolean(profile && hasAnyRole(profile.roles, ["admin", "marketing"])));
      setAccess(profile && hasAnyRole(profile.roles, RRSS_ROLES) ? "allowed" : "denied");
    } else {
      setCanEdit(false);
      setAccess("denied");
    }
  }

  function persistSocial(next: SocialMediaStat[]) {
    setSocialStats(next);
    window.localStorage.setItem(SOCIAL_STORAGE_KEY, JSON.stringify(next));
  }

  function persistAds(next: MetaAdsEntry[]) {
    setAdsEntries(next);
    window.localStorage.setItem(ADS_STORAGE_KEY, JSON.stringify(next));
  }

  function persistMailing(next: MailingCampaign[]) {
    setMailingCampaigns(next);
    window.localStorage.setItem(MAILING_STORAGE_KEY, JSON.stringify(next));
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setBusy(true);
    try {
      if (!configured) {
        if (pendingDelete.table === "social_media_stats") persistSocial(socialStats.filter((row) => row.id !== pendingDelete.id));
        if (pendingDelete.table === "meta_ads_entries") persistAds(adsEntries.filter((row) => row.id !== pendingDelete.id));
        if (pendingDelete.table === "mailing_campaigns") persistMailing(mailingCampaigns.filter((row) => row.id !== pendingDelete.id));
      } else {
        const { error } = await createClient().from(pendingDelete.table).delete().eq("id", pendingDelete.id);
        if (error) throw error;
        await loadRealData();
      }
      setMessage(`"${pendingDelete.label}" eliminado.`);
      setPendingDelete(null);
    } catch (cause) {
      setMessage(reportSafeError(cause, "No se pudo eliminar. Solo un admin, o el autor durante los 10 minutos posteriores al alta, puede borrar un registro."));
    } finally {
      setBusy(false);
    }
  }

  if (access === "checking") return <div className="page-stack" />;

  if (access === "denied") {
    return (
      <div className="page-stack">
        <section className="panel">
          <h2>No tienes permiso para ver esta página</h2>
          <p>Las métricas de marketing no están disponibles para tu rol.</p>
        </section>
      </div>
    );
  }

  return (
    <div className="page-stack">
      <section className="section-heading">
        <div><span className="eyebrow">Marketing</span><h2>RRSS y métricas de marketing</h2><p>Redes sociales, Meta Ads y campañas de email, registradas manualmente por marca y periodo.</p></div>
      </section>

      {message ? <div className="form-message" role="status">{message}</div> : null}

      <div className="view-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "social"} className={tab === "social" ? "view-tab active" : "view-tab"} onClick={() => setTab("social")}>Redes sociales</button>
        <button type="button" role="tab" aria-selected={tab === "ads"} className={tab === "ads" ? "view-tab active" : "view-tab"} onClick={() => setTab("ads")}>Meta Ads</button>
        <button type="button" role="tab" aria-selected={tab === "mailing"} className={tab === "mailing" ? "view-tab active" : "view-tab"} onClick={() => setTab("mailing")}>Mailing</button>
      </div>

      {tab === "social" ? (
        <SocialTab units={units} stats={socialStats} canEdit={canEdit} configured={configured} busy={busy} setBusy={setBusy} setMessage={setMessage} persist={persistSocial} refresh={loadRealData} onDeleteRequest={setPendingDelete} />
      ) : null}
      {tab === "ads" ? (
        <AdsTab units={units} entries={adsEntries} campaignOptions={campaignOptions} canEdit={canEdit} configured={configured} busy={busy} setBusy={setBusy} setMessage={setMessage} persist={persistAds} refresh={loadRealData} onDeleteRequest={setPendingDelete} />
      ) : null}
      {tab === "mailing" ? (
        <MailingTab units={units} campaigns={mailingCampaigns} canEdit={canEdit} configured={configured} busy={busy} setBusy={setBusy} setMessage={setMessage} persist={persistMailing} refresh={loadRealData} onDeleteRequest={setPendingDelete} />
      ) : null}

      <ConfirmationDialog
        open={Boolean(pendingDelete)}
        title="¿Quieres eliminar este registro?"
        confirmLabel="Eliminar"
        destructive
        busy={busy}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
      >
        {pendingDelete ? <div className="confirmation-summary"><span>Registro</span><strong>{pendingDelete.label}</strong><span>Efecto</span><strong>Se elimina de forma permanente.</strong></div> : null}
      </ConfirmationDialog>
    </div>
  );
}

type SharedTabProps<T> = {
  units: BusinessUnit[];
  canEdit: boolean;
  configured: boolean;
  busy: boolean;
  setBusy: (value: boolean) => void;
  setMessage: (value: string | null) => void;
  persist: (next: T[]) => void;
  refresh: () => Promise<void>;
  onDeleteRequest: (value: PendingDelete) => void;
};

function SocialTab({ units, stats, canEdit, configured, busy, setBusy, setMessage, persist, refresh, onDeleteRequest }: SharedTabProps<SocialMediaStat> & { stats: SocialMediaStat[] }) {
  const [unitFilter, setUnitFilter] = useState("all");
  const [networkFilter, setNetworkFilter] = useState("all");
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState<SocialDraft>(() => blankSocialDraft(units));

  const latestMonth = useMemo(() => stats.reduce((max, row) => (row.periodMonth > max ? row.periodMonth : max), stats[0]?.periodMonth ?? monthKey()), [stats]);
  const latestRows = useMemo(() => stats.filter((row) => row.periodMonth === latestMonth), [stats, latestMonth]);

  const totals = useMemo(() => latestRows.reduce((acc, row) => ({
    followers: acc.followers + row.followersEnd,
    newFollowers: acc.newFollowers + row.newFollowers,
    interactions: acc.interactions + row.interactions,
    reach: acc.reach + row.reach,
  }), { followers: 0, newFollowers: 0, interactions: 0, reach: 0 }), [latestRows]);

  const unitSummaries = useMemo(() => units.map((unit) => {
    const rows = latestRows.filter((row) => row.businessUnitId === unit.id);
    return {
      unit,
      followers: rows.reduce((sum, row) => sum + row.followersEnd, 0),
      newFollowers: rows.reduce((sum, row) => sum + row.newFollowers, 0),
      interactions: rows.reduce((sum, row) => sum + row.interactions, 0),
    };
  }), [units, latestRows]);

  const monthlyTrend = useMemo(() => {
    const byMonth = new Map<string, { newFollowers: number; interactions: number; reach: number }>();
    for (const row of stats) {
      const entry = byMonth.get(row.periodMonth) ?? { newFollowers: 0, interactions: 0, reach: 0 };
      entry.newFollowers += row.newFollowers;
      entry.interactions += row.interactions;
      entry.reach += row.reach;
      byMonth.set(row.periodMonth, entry);
    }
    return Array.from(byMonth.entries()).sort(([a], [b]) => a.localeCompare(b)).slice(-6);
  }, [stats]);

  const monthlyTrendData = useMemo(() => monthlyTrend.map(([month, entry]) => ({
    label: monthShortLabel(month),
    newFollowers: entry.newFollowers,
    interactions: entry.interactions,
  })), [monthlyTrend]);

  const newFollowersByUnit = useMemo(() => unitSummaries
    .filter((row) => row.newFollowers > 0)
    .map((row) => ({ label: row.unit.name, value: row.newFollowers, color: row.unit.accent })), [unitSummaries]);

  const visibleRows = useMemo(() => stats
    .filter((row) => (unitFilter === "all" || row.businessUnitId === unitFilter) && (networkFilter === "all" || row.network === networkFilter))
    .sort((a, b) => (a.periodMonth === b.periodMonth ? a.network.localeCompare(b.network) : b.periodMonth.localeCompare(a.periodMonth))), [stats, unitFilter, networkFilter]);

  function openNew() {
    setDraft(blankSocialDraft(units));
    setEditorOpen(true);
    setMessage(null);
  }

  function openEdit(row: SocialMediaStat) {
    setDraft({
      businessUnitId: row.businessUnitId,
      network: row.network,
      periodMonth: row.periodMonth,
      followersEnd: row.followersEnd,
      newFollowers: row.newFollowers,
      posts: row.posts,
      interactions: row.interactions,
      reach: row.reach,
      activeCampaigns: row.activeCampaigns,
      linkClicks: row.linkClicks,
      leads: row.leads,
      notes: row.notes,
    });
    setEditorOpen(true);
    setMessage(null);
  }

  function updateDraft<K extends keyof SocialDraft>(key: K, value: SocialDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function saveEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.businessUnitId || !draft.periodMonth) {
      setMessage("Selecciona una marca y un mes.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      if (!configured) {
        const existing = stats.find((row) => row.businessUnitId === draft.businessUnitId && row.network === draft.network && row.periodMonth === draft.periodMonth);
        const nextRow: SocialMediaStat = { ...draft, id: existing?.id ?? `SMS-${Date.now()}`, createdBy: existing?.createdBy ?? "demo-admin", createdAt: existing?.createdAt ?? new Date().toISOString() };
        const next = existing ? stats.map((row) => row.id === existing.id ? nextRow : row) : [nextRow, ...stats];
        persist(next);
        setMessage("Datos del mes guardados en el modo demostración.");
      } else {
        const payload = {
          business_unit_id: draft.businessUnitId,
          network: draft.network,
          period_month: `${draft.periodMonth}-01`,
          followers_end: draft.followersEnd,
          new_followers: draft.newFollowers,
          posts: draft.posts,
          interactions: draft.interactions,
          reach: draft.reach,
          active_campaigns: draft.activeCampaigns,
          link_clicks: draft.linkClicks,
          leads: draft.leads,
          notes: draft.notes?.trim() || null,
        };
        const { error } = await createClient().from("social_media_stats").upsert(payload, { onConflict: "business_unit_id,network,period_month" });
        if (error) throw error;
        await refresh();
        setMessage("Datos del mes guardados correctamente.");
      }
      setEditorOpen(false);
    } catch (cause) {
      setMessage(reportSafeError(cause, "No se pudieron guardar los datos de redes sociales."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="section-heading">
        <div><span className="eyebrow">{monthLabel(latestMonth)}</span><h2>Redes sociales</h2></div>
        {canEdit ? <button className="button button-primary" onClick={openNew}>+ Registrar mes</button> : null}
      </section>

      <section className="kpi-grid">
        <KpiCard label="Seguidores totales" value={numberFormatter.format(totals.followers)} delta="Sin comparación" helper="último mes registrado" />
        <KpiCard label="Nuevos seguidores" value={numberFormatter.format(totals.newFollowers)} delta="Sin comparación" helper="último mes registrado" />
        <KpiCard label="Interacciones" value={numberFormatter.format(totals.interactions)} delta="Sin comparación" helper="último mes registrado" />
        <KpiCard label="Alcance" value={numberFormatter.format(totals.reach)} delta="Sin comparación" helper="último mes registrado" />
      </section>

      <section className="dashboard-grid">
        <article className="panel chart-panel chart-panel-wide">
          <div className="panel-heading"><div><span className="eyebrow">Evolución</span><h2>Últimos meses (todas las marcas)</h2></div></div>
          <TrendChart
            data={monthlyTrendData}
            series={[
              { key: "newFollowers", label: "Nuevos seguidores", color: "#2563eb" },
              { key: "interactions", label: "Interacciones", color: "#d97706" },
            ]}
            ariaLabel="Evolución mensual de nuevos seguidores e interacciones"
          />
        </article>
        <article className="panel chart-panel">
          <div className="panel-heading"><div><span className="eyebrow">Por marca</span><h2>Nuevos seguidores</h2></div></div>
          <BarChart items={newFollowersByUnit} ariaLabel="Nuevos seguidores por marca este mes" valueFormatter={(value) => numberFormatter.format(value)} />
        </article>
      </section>

      <section className="panel table-panel">
        <div className="panel-heading"><div><span className="eyebrow">Por marca</span><h2>Resumen del mes</h2></div></div>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Marca</th><th>Seguidores</th><th>Nuevos</th><th>Interacciones</th></tr></thead>
            <tbody>
              {unitSummaries.map(({ unit, followers, newFollowers, interactions }) => (
                <tr key={unit.id}>
                  <td><span className="unit-name"><i style={{ background: unit.accent }} />{unit.name}</span></td>
                  <td>{numberFormatter.format(followers)}</td><td>{numberFormatter.format(newFollowers)}</td><td>{numberFormatter.format(interactions)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <CollapsibleFilters
        hasActiveFilters={unitFilter !== "all" || networkFilter !== "all"}
        onClear={() => { setUnitFilter("all"); setNetworkFilter("all"); }}
        resultCount={visibleRows.length}
        resultLabel="Registros"
      >
        <div className="filter-bar lead-filters">
          <label><span>Marca</span><select value={unitFilter} onChange={(event) => setUnitFilter(event.target.value)}>
            <option value="all">Todas</option>
            {units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
          </select></label>
          <label><span>Red</span><select value={networkFilter} onChange={(event) => setNetworkFilter(event.target.value)}>
            <option value="all">Todas</option>
            {socialNetworkOrder.map((network) => <option key={network} value={network}>{socialNetworkLabels[network]}</option>)}
          </select></label>
        </div>
      </CollapsibleFilters>

      <section className="panel table-panel">
        <div className="panel-heading"><div><span className="eyebrow">Detalle</span><h2>Registros mensuales</h2></div></div>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Mes</th><th>Marca</th><th>Red</th><th>Seguidores</th><th>Nuevos</th><th>Publicaciones</th><th>Interacciones</th><th>Alcance</th><th>Leads</th>{canEdit ? <th /> : null}</tr></thead>
            <tbody>
              {visibleRows.map((row) => {
                const unit = units.find((item) => item.id === row.businessUnitId);
                return (
                  <tr key={row.id}>
                    <td>{monthLabel(row.periodMonth)}</td>
                    <td><span className="unit-name"><i style={{ background: unit?.accent }} />{unit?.name ?? "—"}</span></td>
                    <td>{socialNetworkLabels[row.network]}</td>
                    <td>{numberFormatter.format(row.followersEnd)}</td>
                    <td>{numberFormatter.format(row.newFollowers)}</td>
                    <td>{numberFormatter.format(row.posts)}</td>
                    <td>{numberFormatter.format(row.interactions)}</td>
                    <td>{numberFormatter.format(row.reach)}</td>
                    <td>{numberFormatter.format(row.leads)}</td>
                    {canEdit ? (
                      <td>
                        <div className="modal-actions campaign-card-actions">
                          <button type="button" className="button button-compact button-secondary" onClick={() => openEdit(row)}>Editar</button>
                          <button type="button" className="button button-compact button-secondary" onClick={() => onDeleteRequest({ table: "social_media_stats", id: row.id, label: `${socialNetworkLabels[row.network]} · ${unit?.name ?? ""} · ${monthLabel(row.periodMonth)}` })}>Eliminar</button>
                        </div>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
              {visibleRows.length === 0 ? <tr><td colSpan={canEdit ? 10 : 9} className="muted">Sin registros que coincidan con los filtros.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      <Modal open={editorOpen} title="Registrar mes" eyebrow="Redes sociales" onClose={() => setEditorOpen(false)}>
        <form className="lead-editor-form" onSubmit={saveEntry}>
          <div className="form-grid">
            <label><span>Marca *</span><select value={draft.businessUnitId} disabled={!canEdit} onChange={(event) => updateDraft("businessUnitId", event.target.value)}>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>
            <label><span>Red *</span><select value={draft.network} disabled={!canEdit} onChange={(event) => updateDraft("network", event.target.value as SocialNetwork)}>{socialNetworkOrder.map((network) => <option key={network} value={network}>{socialNetworkLabels[network]}</option>)}</select></label>
            <label><span>Mes *</span><input type="month" value={draft.periodMonth} max={monthKey()} readOnly={!canEdit} onChange={(event) => updateDraft("periodMonth", event.target.value)} /></label>
            <label><span>Seguidores fin de mes</span><input type="number" min="0" step="1" value={draft.followersEnd} readOnly={!canEdit} onChange={(event) => updateDraft("followersEnd", Number(event.target.value) || 0)} /></label>
            <label><span>Nuevos seguidores</span><input type="number" step="1" value={draft.newFollowers} readOnly={!canEdit} onChange={(event) => updateDraft("newFollowers", Number(event.target.value) || 0)} /></label>
            <label><span>Publicaciones</span><input type="number" min="0" step="1" value={draft.posts} readOnly={!canEdit} onChange={(event) => updateDraft("posts", Number(event.target.value) || 0)} /></label>
            <label><span>Interacciones</span><input type="number" min="0" step="1" value={draft.interactions} readOnly={!canEdit} onChange={(event) => updateDraft("interactions", Number(event.target.value) || 0)} /></label>
            <label><span>Alcance</span><input type="number" min="0" step="1" value={draft.reach} readOnly={!canEdit} onChange={(event) => updateDraft("reach", Number(event.target.value) || 0)} /></label>
            <label><span>Campañas activas</span><input type="number" min="0" step="1" value={draft.activeCampaigns} readOnly={!canEdit} onChange={(event) => updateDraft("activeCampaigns", Number(event.target.value) || 0)} /></label>
            <label><span>Clics / Visitas</span><input type="number" min="0" step="1" value={draft.linkClicks} readOnly={!canEdit} onChange={(event) => updateDraft("linkClicks", Number(event.target.value) || 0)} /></label>
            <label><span>Leads</span><input type="number" min="0" step="1" value={draft.leads} readOnly={!canEdit} onChange={(event) => updateDraft("leads", Number(event.target.value) || 0)} /></label>
            <label className="form-field-wide"><span>Notas</span><textarea rows={3} value={draft.notes ?? ""} readOnly={!canEdit} onChange={(event) => updateDraft("notes", event.target.value)} /></label>
          </div>
          <div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setEditorOpen(false)}>Cerrar</button>{canEdit ? <button type="submit" className="button button-primary" disabled={busy}>{busy ? "Guardando…" : "Guardar mes"}</button> : null}</div>
        </form>
      </Modal>
    </>
  );
}

function AdsTab({ units, entries, campaignOptions, canEdit, configured, busy, setBusy, setMessage, persist, refresh, onDeleteRequest }: SharedTabProps<MetaAdsEntry> & { entries: MetaAdsEntry[]; campaignOptions: CampaignOption[] }) {
  const [query, setQuery] = useState("");
  const [unitFilter, setUnitFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<AdsDraft>(() => blankAdsDraft(units));

  const visibleEntries = useMemo(() => entries.filter((entry) => {
    const matchesQuery = entry.campaignName.toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (unitFilter === "all" || entry.businessUnitId === unitFilter) && (statusFilter === "all" || entry.status === statusFilter);
  }), [entries, query, unitFilter, statusFilter]);

  const totals = useMemo(() => visibleEntries.reduce((acc, entry) => ({
    spend: acc.spend + entry.amountSpent,
    leads: acc.leads + entry.leads,
    revenue: acc.revenue + entry.revenue,
  }), { spend: 0, leads: 0, revenue: 0 }), [visibleEntries]);

  const spendByUnit = useMemo(() => units
    .map((unit) => ({ unit, spend: visibleEntries.filter((entry) => entry.businessUnitId === unit.id).reduce((sum, entry) => sum + entry.amountSpent, 0) }))
    .filter((row) => row.spend > 0)
    .map((row) => ({ label: row.unit.name, value: row.spend, color: row.unit.accent })), [units, visibleEntries]);

  function openNew() {
    setEditingId(null);
    setDraft(blankAdsDraft(units));
    setEditorOpen(true);
    setMessage(null);
  }

  function openEdit(entry: MetaAdsEntry) {
    setEditingId(entry.id);
    setDraft({
      businessUnitId: entry.businessUnitId,
      campaignId: entry.campaignId,
      campaignName: entry.campaignName,
      adSet: entry.adSet,
      adName: entry.adName,
      objective: entry.objective,
      status: entry.status,
      startDate: entry.startDate,
      endDate: entry.endDate,
      amountSpent: entry.amountSpent,
      impressions: entry.impressions,
      linkClicks: entry.linkClicks,
      leads: entry.leads,
      qualifiedLeads: entry.qualifiedLeads,
      purchases: entry.purchases,
      revenue: entry.revenue,
      notes: entry.notes,
    });
    setEditorOpen(true);
    setMessage(null);
  }

  function updateDraft<K extends keyof AdsDraft>(key: K, value: AdsDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function saveEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.businessUnitId || !draft.campaignName.trim()) {
      setMessage("Selecciona una marca y añade un nombre de campaña.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      if (!configured) {
        const previous = editingId ? entries.find((entry) => entry.id === editingId) : null;
        const nextEntry: MetaAdsEntry = { ...draft, id: editingId ?? `ADS-${Date.now()}`, createdBy: previous?.createdBy ?? "demo-admin", createdAt: previous?.createdAt ?? new Date().toISOString() };
        const next = editingId ? entries.map((entry) => entry.id === editingId ? nextEntry : entry) : [nextEntry, ...entries];
        persist(next);
        setMessage(editingId ? "Campaña actualizada en el modo demostración." : "Campaña creada en el modo demostración.");
      } else {
        const payload = {
          business_unit_id: draft.businessUnitId,
          campaign_id: draft.campaignId || null,
          campaign_name: draft.campaignName.trim(),
          ad_set: draft.adSet?.trim() || null,
          ad_name: draft.adName?.trim() || null,
          objective: draft.objective?.trim() || null,
          status: draft.status,
          start_date: draft.startDate || null,
          end_date: draft.endDate || null,
          amount_spent: draft.amountSpent,
          impressions: draft.impressions,
          link_clicks: draft.linkClicks,
          leads: draft.leads,
          qualified_leads: draft.qualifiedLeads,
          purchases: draft.purchases,
          revenue: draft.revenue,
          notes: draft.notes?.trim() || null,
        };
        const supabase = createClient();
        const result = editingId ? await supabase.from("meta_ads_entries").update(payload).eq("id", editingId) : await supabase.from("meta_ads_entries").insert(payload);
        if (result.error) throw result.error;
        await refresh();
        setMessage(editingId ? "Campaña actualizada correctamente." : "Campaña creada correctamente.");
      }
      setEditorOpen(false);
    } catch (cause) {
      setMessage(reportSafeError(cause, "No se pudo guardar la campaña de Meta Ads."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="section-heading">
        <div><span className="eyebrow">Publicidad</span><h2>Meta Ads</h2></div>
        {canEdit ? <button className="button button-primary" onClick={openNew}>+ Nueva entrada</button> : null}
      </section>

      <section className="kpi-grid">
        <KpiCard label="Gasto total" value={currencyFormatter.format(totals.spend)} delta="Sin comparación" helper="según filtros" />
        <KpiCard label="Leads" value={numberFormatter.format(totals.leads)} delta="Sin comparación" helper="según filtros" />
        <KpiCard label="CPL medio" value={currencyFormatter.format(safeDiv(totals.spend, totals.leads))} delta="Sin comparación" helper="según filtros" />
        <KpiCard label="ROAS medio" value={`${safeDiv(totals.revenue, totals.spend).toFixed(2)}x`} delta="Sin comparación" helper="según filtros" />
      </section>

      <section className="panel chart-panel">
        <div className="panel-heading"><div><span className="eyebrow">Por marca</span><h2>Gasto en Meta Ads</h2></div></div>
        <BarChart items={spendByUnit} ariaLabel="Gasto en Meta Ads por marca" valueFormatter={(value) => currencyFormatter.format(value)} />
      </section>

      <CollapsibleFilters
        hasActiveFilters={query !== "" || unitFilter !== "all" || statusFilter !== "all"}
        onClear={() => { setQuery(""); setUnitFilter("all"); setStatusFilter("all"); }}
        resultCount={visibleEntries.length}
        resultLabel="Campañas"
      >
        <div className="filter-bar lead-filters">
          <label><span>Buscar</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nombre de campaña" /></label>
          <label><span>Marca</span><select value={unitFilter} onChange={(event) => setUnitFilter(event.target.value)}>
            <option value="all">Todas</option>
            {units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
          </select></label>
          <label><span>Estado</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="all">Todos</option>
            {Object.entries(adStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
        </div>
      </CollapsibleFilters>

      <section className="panel table-panel">
        <div className="panel-heading"><div><span className="eyebrow">Detalle</span><h2>Campañas registradas</h2></div></div>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Marca</th><th>Campaña</th><th>Estado</th><th>Gasto</th><th>Impresiones</th><th>Clics</th><th>CTR</th><th>CPC</th><th>Leads</th><th>Cualificados</th><th>Compras</th><th>Ingresos</th><th>CPL</th><th>ROAS</th><th>ROI</th>{canEdit ? <th /> : null}</tr></thead>
            <tbody>
              {visibleEntries.map((entry) => {
                const unit = units.find((item) => item.id === entry.businessUnitId);
                const ctr = ratio(entry.linkClicks, entry.impressions);
                const cpc = safeDiv(entry.amountSpent, entry.linkClicks);
                const cpl = safeDiv(entry.amountSpent, entry.leads);
                const roas = safeDiv(entry.revenue, entry.amountSpent);
                const roi = ratio(entry.revenue - entry.amountSpent, entry.amountSpent);
                return (
                  <tr key={entry.id}>
                    <td><span className="unit-name"><i style={{ background: unit?.accent }} />{unit?.name ?? "—"}</span></td>
                    <td><strong>{entry.campaignName}</strong>{entry.adSet ? <div className="muted">{entry.adSet}</div> : null}</td>
                    <td><span className={entry.status === "active" ? "badge badge-active" : entry.status === "finished" ? "badge" : "badge badge-lost"}>{adStatusLabels[entry.status]}</span></td>
                    <td>{currencyFormatter.format(entry.amountSpent)}</td>
                    <td>{numberFormatter.format(entry.impressions)}</td>
                    <td>{numberFormatter.format(entry.linkClicks)}</td>
                    <td>{formatPercent(ctr)}</td>
                    <td>{currencyFormatter.format(cpc)}</td>
                    <td>{numberFormatter.format(entry.leads)}</td>
                    <td>{numberFormatter.format(entry.qualifiedLeads)}</td>
                    <td>{numberFormatter.format(entry.purchases)}</td>
                    <td>{currencyFormatter.format(entry.revenue)}</td>
                    <td>{currencyFormatter.format(cpl)}</td>
                    <td>{roas.toFixed(2)}x</td>
                    <td>{formatPercent(roi)}</td>
                    {canEdit ? (
                      <td>
                        <div className="modal-actions campaign-card-actions">
                          <button type="button" className="button button-compact button-secondary" onClick={() => openEdit(entry)}>Editar</button>
                          <button type="button" className="button button-compact button-secondary" onClick={() => onDeleteRequest({ table: "meta_ads_entries", id: entry.id, label: entry.campaignName })}>Eliminar</button>
                        </div>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
              {visibleEntries.length === 0 ? <tr><td colSpan={canEdit ? 16 : 15} className="muted">Sin campañas que coincidan con los filtros.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      <Modal open={editorOpen} title={editingId ? "Editar campaña" : "Nueva campaña de Meta Ads"} eyebrow="Publicidad" onClose={() => setEditorOpen(false)}>
        <form className="lead-editor-form" onSubmit={saveEntry}>
          <div className="form-grid">
            <label><span>Marca *</span><select value={draft.businessUnitId} disabled={!canEdit} onChange={(event) => updateDraft("businessUnitId", event.target.value)}>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>
            <label><span>Nombre de campaña *</span><input value={draft.campaignName} readOnly={!canEdit} onChange={(event) => updateDraft("campaignName", event.target.value)} /></label>
            <label><span>Campaña general (opcional)</span><select value={draft.campaignId ?? ""} disabled={!canEdit} onChange={(event) => updateDraft("campaignId", event.target.value || null)}>
              <option value="">— Sin vincular —</option>
              {campaignOptions.filter((option) => option.businessUnitId === draft.businessUnitId).map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
            </select></label>
            <label><span>Conjunto de anuncios</span><input value={draft.adSet ?? ""} readOnly={!canEdit} onChange={(event) => updateDraft("adSet", event.target.value)} /></label>
            <label><span>Anuncio</span><input value={draft.adName ?? ""} readOnly={!canEdit} onChange={(event) => updateDraft("adName", event.target.value)} /></label>
            <label><span>Objetivo</span><input value={draft.objective ?? ""} readOnly={!canEdit} onChange={(event) => updateDraft("objective", event.target.value)} placeholder="Leads, Conversiones, Tráfico…" /></label>
            <label><span>Estado</span><select value={draft.status} disabled={!canEdit} onChange={(event) => updateDraft("status", event.target.value as AdCampaignStatus)}>{Object.entries(adStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label><span>Fecha inicio</span><input type="date" value={draft.startDate ?? ""} readOnly={!canEdit} onChange={(event) => updateDraft("startDate", event.target.value || null)} /></label>
            <label><span>Fecha fin</span><input type="date" value={draft.endDate ?? ""} readOnly={!canEdit} onChange={(event) => updateDraft("endDate", event.target.value || null)} /></label>
            <label><span>Importe gastado (€)</span><input type="number" min="0" step="0.01" value={draft.amountSpent} readOnly={!canEdit} onChange={(event) => updateDraft("amountSpent", Number(event.target.value) || 0)} /></label>
            <label><span>Impresiones</span><input type="number" min="0" step="1" value={draft.impressions} readOnly={!canEdit} onChange={(event) => updateDraft("impressions", Number(event.target.value) || 0)} /></label>
            <label><span>Clics en el enlace</span><input type="number" min="0" step="1" value={draft.linkClicks} readOnly={!canEdit} onChange={(event) => updateDraft("linkClicks", Number(event.target.value) || 0)} /></label>
            <label><span>Leads</span><input type="number" min="0" step="1" value={draft.leads} readOnly={!canEdit} onChange={(event) => updateDraft("leads", Number(event.target.value) || 0)} /></label>
            <label><span>Leads cualificados</span><input type="number" min="0" step="1" value={draft.qualifiedLeads} readOnly={!canEdit} onChange={(event) => updateDraft("qualifiedLeads", Number(event.target.value) || 0)} /></label>
            <label><span>Compras</span><input type="number" min="0" step="1" value={draft.purchases} readOnly={!canEdit} onChange={(event) => updateDraft("purchases", Number(event.target.value) || 0)} /></label>
            <label><span>Ingresos (€)</span><input type="number" min="0" step="0.01" value={draft.revenue} readOnly={!canEdit} onChange={(event) => updateDraft("revenue", Number(event.target.value) || 0)} /></label>
            <label className="form-field-wide"><span>Notas</span><textarea rows={3} value={draft.notes ?? ""} readOnly={!canEdit} onChange={(event) => updateDraft("notes", event.target.value)} /></label>
          </div>
          <div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setEditorOpen(false)}>Cerrar</button>{canEdit ? <button type="submit" className="button button-primary" disabled={busy}>{busy ? "Guardando…" : "Guardar campaña"}</button> : null}</div>
        </form>
      </Modal>
    </>
  );
}

function MailingTab({ units, campaigns, canEdit, configured, busy, setBusy, setMessage, persist, refresh, onDeleteRequest }: SharedTabProps<MailingCampaign> & { campaigns: MailingCampaign[] }) {
  const [query, setQuery] = useState("");
  const [unitFilter, setUnitFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<MailingDraft>(() => blankMailingDraft(units));

  const visibleCampaigns = useMemo(() => campaigns.filter((campaign) => {
    const matchesQuery = campaign.campaignName.toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (unitFilter === "all" || campaign.businessUnitId === unitFilter) && (typeFilter === "all" || campaign.campaignType === typeFilter);
  }), [campaigns, query, unitFilter, typeFilter]);

  const totals = useMemo(() => visibleCampaigns.reduce((acc, campaign) => ({
    sent: acc.sent + campaign.sentCount,
    delivered: acc.delivered + campaign.deliveredCount,
    opens: acc.opens + campaign.opens,
    revenue: acc.revenue + campaign.revenue,
  }), { sent: 0, delivered: 0, opens: 0, revenue: 0 }), [visibleCampaigns]);

  const openRateByUnit = useMemo(() => units
    .map((unit) => {
      const rows = visibleCampaigns.filter((campaign) => campaign.businessUnitId === unit.id);
      const delivered = rows.reduce((sum, campaign) => sum + campaign.deliveredCount, 0);
      const opens = rows.reduce((sum, campaign) => sum + campaign.opens, 0);
      return { unit, delivered, rate: ratio(opens, delivered) };
    })
    .filter((row) => row.delivered > 0)
    .map((row) => ({ label: row.unit.name, value: Math.round(row.rate * 10) / 10, color: row.unit.accent })), [units, visibleCampaigns]);

  function openNew() {
    setEditingId(null);
    setDraft(blankMailingDraft(units));
    setEditorOpen(true);
    setMessage(null);
  }

  function openEdit(campaign: MailingCampaign) {
    setEditingId(campaign.id);
    setDraft({
      businessUnitId: campaign.businessUnitId,
      campaignName: campaign.campaignName,
      campaignType: campaign.campaignType,
      sentDate: campaign.sentDate,
      sentCount: campaign.sentCount,
      deliveredCount: campaign.deliveredCount,
      opens: campaign.opens,
      clicks: campaign.clicks,
      leads: campaign.leads,
      salesCount: campaign.salesCount,
      revenue: campaign.revenue,
      unsubscribes: campaign.unsubscribes,
      notes: campaign.notes,
    });
    setEditorOpen(true);
    setMessage(null);
  }

  function updateDraft<K extends keyof MailingDraft>(key: K, value: MailingDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function saveEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.businessUnitId || !draft.campaignName.trim()) {
      setMessage("Selecciona una marca y añade un nombre de campaña.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      if (!configured) {
        const previous = editingId ? campaigns.find((campaign) => campaign.id === editingId) : null;
        const nextCampaign: MailingCampaign = { ...draft, id: editingId ?? `MAIL-${Date.now()}`, createdBy: previous?.createdBy ?? "demo-admin", createdAt: previous?.createdAt ?? new Date().toISOString() };
        const next = editingId ? campaigns.map((campaign) => campaign.id === editingId ? nextCampaign : campaign) : [nextCampaign, ...campaigns];
        persist(next);
        setMessage(editingId ? "Campaña actualizada en el modo demostración." : "Campaña creada en el modo demostración.");
      } else {
        const payload = {
          business_unit_id: draft.businessUnitId,
          campaign_name: draft.campaignName.trim(),
          campaign_type: draft.campaignType,
          sent_date: draft.sentDate,
          sent_count: draft.sentCount,
          delivered_count: draft.deliveredCount,
          opens: draft.opens,
          clicks: draft.clicks,
          leads: draft.leads,
          sales_count: draft.salesCount,
          revenue: draft.revenue,
          unsubscribes: draft.unsubscribes,
          notes: draft.notes?.trim() || null,
        };
        const supabase = createClient();
        const result = editingId ? await supabase.from("mailing_campaigns").update(payload).eq("id", editingId) : await supabase.from("mailing_campaigns").insert(payload);
        if (result.error) throw result.error;
        await refresh();
        setMessage(editingId ? "Campaña actualizada correctamente." : "Campaña creada correctamente.");
      }
      setEditorOpen(false);
    } catch (cause) {
      setMessage(reportSafeError(cause, "No se pudo guardar la campaña de email."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="section-heading">
        <div><span className="eyebrow">Email marketing</span><h2>Mailing</h2></div>
        {canEdit ? <button className="button button-primary" onClick={openNew}>+ Nueva entrada</button> : null}
      </section>

      <section className="kpi-grid">
        <KpiCard label="Enviados" value={numberFormatter.format(totals.sent)} delta="Sin comparación" helper="según filtros" />
        <KpiCard label="Entregados" value={numberFormatter.format(totals.delivered)} delta="Sin comparación" helper="según filtros" />
        <KpiCard label="Open rate medio" value={formatPercent(ratio(totals.opens, totals.delivered))} delta="Sin comparación" helper="según filtros" />
        <KpiCard label="Ingresos" value={currencyFormatter.format(totals.revenue)} delta="Sin comparación" helper="según filtros" />
      </section>

      <section className="panel chart-panel">
        <div className="panel-heading"><div><span className="eyebrow">Por marca</span><h2>Open rate</h2></div></div>
        <BarChart items={openRateByUnit} ariaLabel="Open rate por marca" valueFormatter={(value) => formatPercent(value)} />
      </section>

      <CollapsibleFilters
        hasActiveFilters={query !== "" || unitFilter !== "all" || typeFilter !== "all"}
        onClear={() => { setQuery(""); setUnitFilter("all"); setTypeFilter("all"); }}
        resultCount={visibleCampaigns.length}
        resultLabel="Campañas"
      >
        <div className="filter-bar lead-filters">
          <label><span>Buscar</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nombre de campaña" /></label>
          <label><span>Marca</span><select value={unitFilter} onChange={(event) => setUnitFilter(event.target.value)}>
            <option value="all">Todas</option>
            {units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
          </select></label>
          <label><span>Tipo</span><select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
            <option value="all">Todos</option>
            {mailingTypeOrder.map((type) => <option key={type} value={type}>{mailingTypeLabels[type]}</option>)}
          </select></label>
        </div>
      </CollapsibleFilters>

      <section className="panel table-panel">
        <div className="panel-heading"><div><span className="eyebrow">Detalle</span><h2>Campañas registradas</h2></div></div>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Marca</th><th>Campaña</th><th>Tipo</th><th>Fecha</th><th>Enviados</th><th>Entregados</th><th>Aperturas</th><th>Clics</th><th>Leads</th><th>Ventas</th><th>Ingresos</th><th>Bajas</th><th>Open rate</th><th>CTR</th><th>CTOR</th>{canEdit ? <th /> : null}</tr></thead>
            <tbody>
              {visibleCampaigns.map((campaign) => {
                const unit = units.find((item) => item.id === campaign.businessUnitId);
                const openRate = ratio(campaign.opens, campaign.deliveredCount);
                const ctr = ratio(campaign.clicks, campaign.deliveredCount);
                const ctor = ratio(campaign.clicks, campaign.opens);
                return (
                  <tr key={campaign.id}>
                    <td><span className="unit-name"><i style={{ background: unit?.accent }} />{unit?.name ?? "—"}</span></td>
                    <td><strong>{campaign.campaignName}</strong></td>
                    <td><span className="badge">{mailingTypeLabels[campaign.campaignType]}</span></td>
                    <td>{formatDate(campaign.sentDate)}</td>
                    <td>{numberFormatter.format(campaign.sentCount)}</td>
                    <td>{numberFormatter.format(campaign.deliveredCount)}</td>
                    <td>{numberFormatter.format(campaign.opens)}</td>
                    <td>{numberFormatter.format(campaign.clicks)}</td>
                    <td>{numberFormatter.format(campaign.leads)}</td>
                    <td>{numberFormatter.format(campaign.salesCount)}</td>
                    <td>{currencyFormatter.format(campaign.revenue)}</td>
                    <td>{numberFormatter.format(campaign.unsubscribes)}</td>
                    <td>{formatPercent(openRate)}</td>
                    <td>{formatPercent(ctr)}</td>
                    <td>{formatPercent(ctor)}</td>
                    {canEdit ? (
                      <td>
                        <div className="modal-actions campaign-card-actions">
                          <button type="button" className="button button-compact button-secondary" onClick={() => openEdit(campaign)}>Editar</button>
                          <button type="button" className="button button-compact button-secondary" onClick={() => onDeleteRequest({ table: "mailing_campaigns", id: campaign.id, label: campaign.campaignName })}>Eliminar</button>
                        </div>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
              {visibleCampaigns.length === 0 ? <tr><td colSpan={canEdit ? 16 : 15} className="muted">Sin campañas que coincidan con los filtros.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      <Modal open={editorOpen} title={editingId ? "Editar campaña" : "Nueva campaña de email"} eyebrow="Email marketing" onClose={() => setEditorOpen(false)}>
        <form className="lead-editor-form" onSubmit={saveEntry}>
          <div className="form-grid">
            <label><span>Marca *</span><select value={draft.businessUnitId} disabled={!canEdit} onChange={(event) => updateDraft("businessUnitId", event.target.value)}>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>
            <label><span>Nombre de campaña *</span><input value={draft.campaignName} readOnly={!canEdit} onChange={(event) => updateDraft("campaignName", event.target.value)} /></label>
            <label><span>Tipo</span><select value={draft.campaignType} disabled={!canEdit} onChange={(event) => updateDraft("campaignType", event.target.value as MailingCampaignType)}>{mailingTypeOrder.map((type) => <option key={type} value={type}>{mailingTypeLabels[type]}</option>)}</select></label>
            <label><span>Fecha de envío</span><input type="date" value={draft.sentDate} readOnly={!canEdit} onChange={(event) => updateDraft("sentDate", event.target.value)} /></label>
            <label><span>Enviados</span><input type="number" min="0" step="1" value={draft.sentCount} readOnly={!canEdit} onChange={(event) => updateDraft("sentCount", Number(event.target.value) || 0)} /></label>
            <label><span>Entregados</span><input type="number" min="0" step="1" value={draft.deliveredCount} readOnly={!canEdit} onChange={(event) => updateDraft("deliveredCount", Number(event.target.value) || 0)} /></label>
            <label><span>Aperturas</span><input type="number" min="0" step="1" value={draft.opens} readOnly={!canEdit} onChange={(event) => updateDraft("opens", Number(event.target.value) || 0)} /></label>
            <label><span>Clics</span><input type="number" min="0" step="1" value={draft.clicks} readOnly={!canEdit} onChange={(event) => updateDraft("clicks", Number(event.target.value) || 0)} /></label>
            <label><span>Leads</span><input type="number" min="0" step="1" value={draft.leads} readOnly={!canEdit} onChange={(event) => updateDraft("leads", Number(event.target.value) || 0)} /></label>
            <label><span>Ventas</span><input type="number" min="0" step="1" value={draft.salesCount} readOnly={!canEdit} onChange={(event) => updateDraft("salesCount", Number(event.target.value) || 0)} /></label>
            <label><span>Ingresos (€)</span><input type="number" min="0" step="0.01" value={draft.revenue} readOnly={!canEdit} onChange={(event) => updateDraft("revenue", Number(event.target.value) || 0)} /></label>
            <label><span>Bajas</span><input type="number" min="0" step="1" value={draft.unsubscribes} readOnly={!canEdit} onChange={(event) => updateDraft("unsubscribes", Number(event.target.value) || 0)} /></label>
            <label className="form-field-wide"><span>Notas</span><textarea rows={3} value={draft.notes ?? ""} readOnly={!canEdit} onChange={(event) => updateDraft("notes", event.target.value)} /></label>
          </div>
          <div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setEditorOpen(false)}>Cerrar</button>{canEdit ? <button type="submit" className="button button-primary" disabled={busy}>{busy ? "Guardando…" : "Guardar campaña"}</button> : null}</div>
        </form>
      </Modal>
    </>
  );
}
