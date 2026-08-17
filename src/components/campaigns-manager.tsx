"use client";

import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { CollapsibleFilters } from "@/components/ui/collapsible-filters";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Modal } from "@/components/ui/modal";
import { CAMPAIGNS_ROLES, hasAnyRole, campaignStatusLabels } from "@/lib/constants";
import { businessUnits as demoBusinessUnits, campaigns as demoCampaigns, demoLeads } from "@/lib/demo-data";
import { currencyFormatter, formatDate, formatPercent } from "@/lib/format";
import { reportSafeError } from "@/lib/errors";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import type { BusinessUnit, Campaign, CampaignStatus, LeadStatus } from "@/lib/types";

const STORAGE_KEY = "intec-demo-campaigns";

type CampaignDraft = Omit<Campaign, "id" | "createdAt">;
type LeadStub = { campaignId: string | null; status: LeadStatus; saleValue: number | null };
type AdsStub = { campaignId: string | null; amountSpent: number; revenue: number };

function blankDraft(units: BusinessUnit[]): CampaignDraft {
  return {
    businessUnitId: units[0]?.id ?? "",
    name: "",
    channel: "",
    startDate: null,
    endDate: null,
    status: "draft",
    budget: null,
    notes: "",
    directSalesCount: 0,
    directSaleValue: 0,
  };
}

function mapCampaignRow(row: Record<string, unknown>): Campaign {
  return {
    id: String(row.id),
    businessUnitId: String(row.business_unit_id),
    name: String(row.name),
    channel: row.channel ? String(row.channel) : null,
    startDate: row.start_date ? String(row.start_date) : null,
    endDate: row.end_date ? String(row.end_date) : null,
    status: row.status as CampaignStatus,
    budget: row.budget === null || row.budget === undefined ? null : Number(row.budget),
    notes: row.notes ? String(row.notes) : null,
    directSalesCount: Number(row.direct_sales_count ?? 0),
    directSaleValue: Number(row.direct_sale_value ?? 0),
    createdAt: String(row.created_at),
    updatedAt: row.updated_at ? String(row.updated_at) : undefined,
  };
}

function mapLeadStub(row: Record<string, unknown>): LeadStub {
  return {
    campaignId: row.campaign_id ? String(row.campaign_id) : null,
    status: row.status as LeadStatus,
    saleValue: row.sale_value === null || row.sale_value === undefined ? null : Number(row.sale_value),
  };
}

function dateRangeLabel(start: string | null, end: string | null): string {
  if (!start && !end) return "Sin fechas";
  if (start && end) return `${formatDate(start)} – ${formatDate(end)}`;
  if (start) return `Desde ${formatDate(start)}`;
  return `Hasta ${formatDate(end as string)}`;
}

function statsFor(campaign: Campaign, leads: LeadStub[]) {
  const campaignLeads = leads.filter((lead) => lead.campaignId === campaign.id);
  const total = campaignLeads.length;
  const contacted = campaignLeads.filter((lead) => lead.status !== "new").length;
  const offers = campaignLeads.filter((lead) => lead.status === "offer_sent").length;
  const leadsWon = campaignLeads.filter((lead) => lead.status === "won").length;
  const lost = campaignLeads.filter((lead) => lead.status === "lost").length;
  const leadsValue = campaignLeads.reduce((sum, lead) => sum + (lead.status === "won" ? lead.saleValue ?? 0 : 0), 0);
  const won = leadsWon + campaign.directSalesCount;
  const value = leadsValue + campaign.directSaleValue;
  return { total, contacted, offers, won, lost, conversion: total ? (leadsWon / total) * 100 : 0, value };
}

function adsStatsFor(campaign: Campaign, ads: AdsStub[]) {
  const rows = ads.filter((ad) => ad.campaignId === campaign.id);
  const spend = rows.reduce((sum, ad) => sum + ad.amountSpent, 0);
  const revenue = rows.reduce((sum, ad) => sum + ad.revenue, 0);
  return { count: rows.length, spend, revenue, roas: spend > 0 ? revenue / spend : 0 };
}

function initialDemoCampaigns(configured: boolean): Campaign[] {
  if (configured || typeof window === "undefined") return demoCampaigns;
  const saved = window.localStorage.getItem(STORAGE_KEY);
  return saved ? (JSON.parse(saved) as Campaign[]) : demoCampaigns;
}

export function CampaignsManager() {
  const configured = isSupabaseConfigured();
  const [campaigns, setCampaigns] = useState<Campaign[]>(() => initialDemoCampaigns(configured));
  const [units, setUnits] = useState<BusinessUnit[]>(demoBusinessUnits);
  const [leads, setLeads] = useState<LeadStub[]>(() => demoLeads.map((lead) => ({ campaignId: lead.campaignId ?? null, status: lead.status, saleValue: lead.saleValue })));
  const [ads, setAds] = useState<AdsStub[]>([]);
  const [unitId, setUnitId] = useState("all");
  const [status, setStatus] = useState("all");
  const [query, setQuery] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CampaignDraft>(() => blankDraft(demoBusinessUnits));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [canEdit, setCanEdit] = useState(true);
  const [pendingArchive, setPendingArchive] = useState<Campaign | null>(null);
  const [access, setAccess] = useState<"checking" | "allowed" | "denied">(configured ? "checking" : "allowed");

  useEffect(() => {
    if (!configured) return;
    void loadRealData();
  }, [configured]);

  async function loadRealData() {
    const supabase = createClient();
    const [{ data: unitData, error: unitError }, { data: campaignData, error: campaignError }, { data: leadData, error: leadError }, { data: adsData }, { data: authData }] = await Promise.all([
      supabase.from("business_units").select("id, name, slug, brand_color, logo_url, is_active, sort_order, visible_in_consultas, visible_in_leads").order("sort_order"),
      supabase.from("campaigns").select("id, business_unit_id, name, channel, start_date, end_date, status, budget, notes, direct_sales_count, direct_sale_value, created_at, updated_at").order("created_at", { ascending: false }),
      supabase.from("leads").select("campaign_id, status, sale_value").limit(2000),
      supabase.from("meta_ads_entries").select("campaign_id, amount_spent, revenue").not("campaign_id", "is", null),
      supabase.auth.getUser(),
    ]);
    if (unitError || campaignError || leadError) {
      setMessage(reportSafeError(unitError ?? campaignError ?? leadError, "No se pudieron cargar las campañas."));
      return;
    }
    setUnits((unitData ?? []).map((row) => ({ id: row.id, name: row.name, slug: row.slug, accent: row.brand_color || "#2563eb", active: row.is_active, logo: row.logo_url, sortOrder: row.sort_order ?? 0, visibleInConsultas: row.visible_in_consultas ?? true, visibleInLeads: row.visible_in_leads ?? true })));
    setCampaigns((campaignData ?? []).map((row) => mapCampaignRow(row as Record<string, unknown>)));
    setLeads((leadData ?? []).map((row) => mapLeadStub(row as Record<string, unknown>)));
    setAds((adsData ?? []).map((row) => ({ campaignId: row.campaign_id, amountSpent: Number(row.amount_spent ?? 0), revenue: Number(row.revenue ?? 0) })));
    const user = authData.user;
    if (user) {
      const { data: profile } = await supabase.from("profiles").select("roles").eq("id", user.id).maybeSingle();
      setCanEdit(Boolean(profile && hasAnyRole(profile.roles, ["admin", "marketing"])));
      setAccess(profile && hasAnyRole(profile.roles, CAMPAIGNS_ROLES) ? "allowed" : "denied");
    } else {
      setCanEdit(false);
      setAccess("denied");
    }
  }

  function persistDemo(next: Campaign[]) {
    setCampaigns(next);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }

  const visibleCampaigns = useMemo(() => campaigns.filter((campaign) => {
    const matchesQuery = campaign.name.toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (unitId === "all" || campaign.businessUnitId === unitId) && (status === "all" || campaign.status === status);
  }), [campaigns, query, status, unitId]);

  function openNew() {
    setEditingId(null);
    setDraft(blankDraft(units));
    setEditorOpen(true);
    setMessage(null);
  }

  function openEdit(campaign: Campaign) {
    setEditingId(campaign.id);
    setDraft({
      businessUnitId: campaign.businessUnitId,
      name: campaign.name,
      channel: campaign.channel,
      startDate: campaign.startDate,
      endDate: campaign.endDate,
      status: campaign.status,
      budget: campaign.budget,
      notes: campaign.notes,
      directSalesCount: campaign.directSalesCount,
      directSaleValue: campaign.directSaleValue,
    });
    setEditorOpen(true);
    setMessage(null);
  }

  function updateDraft<K extends keyof CampaignDraft>(key: K, value: CampaignDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function saveCampaign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.businessUnitId || !draft.name.trim()) {
      setMessage("Selecciona una unidad y añade un nombre para la campaña.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      if (!configured) {
        const previous = editingId ? campaigns.find((campaign) => campaign.id === editingId) : null;
        const nextCampaign: Campaign = {
          ...draft,
          id: editingId ?? `CP-${Date.now()}`,
          createdAt: previous?.createdAt ?? new Date().toISOString(),
        };
        const nextCampaigns = editingId ? campaigns.map((campaign) => campaign.id === editingId ? nextCampaign : campaign) : [nextCampaign, ...campaigns];
        persistDemo(nextCampaigns);
        setMessage(editingId ? "Campaña actualizada en el modo demostración." : "Campaña creada en el modo demostración.");
      } else {
        const payload = {
          business_unit_id: draft.businessUnitId,
          name: draft.name.trim(),
          channel: draft.channel?.trim() || null,
          start_date: draft.startDate || null,
          end_date: draft.endDate || null,
          status: draft.status,
          budget: draft.budget,
          notes: draft.notes?.trim() || null,
          direct_sales_count: draft.directSalesCount,
          direct_sale_value: draft.directSaleValue,
        };
        const supabase = createClient();
        const result = editingId ? await supabase.from("campaigns").update(payload).eq("id", editingId) : await supabase.from("campaigns").insert(payload);
        if (result.error) throw result.error;
        await loadRealData();
        setMessage(editingId ? "Campaña actualizada correctamente." : "Campaña creada correctamente.");
      }
      setEditorOpen(false);
    } catch (cause) {
      setMessage(reportSafeError(cause, "No se pudo guardar la campaña. Comprueba que no exista ya una con ese nombre en esta unidad."));
    } finally {
      setBusy(false);
    }
  }

  async function confirmArchive() {
    if (!pendingArchive) return;
    setBusy(true);
    try {
      if (!configured) {
        persistDemo(campaigns.map((campaign) => campaign.id === pendingArchive.id ? { ...campaign, status: "archived" } : campaign));
      } else {
        const { error } = await createClient().from("campaigns").update({ status: "archived" }).eq("id", pendingArchive.id);
        if (error) throw error;
        await loadRealData();
      }
      setMessage(`Campaña "${pendingArchive.name}" archivada.`);
      setPendingArchive(null);
    } catch (cause) {
      setMessage(reportSafeError(cause, "No se pudo archivar la campaña."));
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
          <p>Campañas no está disponible para tu rol.</p>
        </section>
      </div>
    );
  }

  return (
    <div className="page-stack">
      <section className="section-heading">
        <div><span className="eyebrow">Captación</span><h2>Campañas</h2><p>Crea campañas, sigue sus leads y su conversión, y archívalas cuando terminen (nunca se eliminan).</p></div>
        {canEdit ? <button className="button button-primary" onClick={openNew}>+ Nueva campaña</button> : null}
      </section>

      {message ? <div className="form-message" role="status">{message}</div> : null}

      <CollapsibleFilters
        hasActiveFilters={query !== "" || unitId !== "all" || status !== "all"}
        onClear={() => { setQuery(""); setUnitId("all"); setStatus("all"); }}
        resultCount={visibleCampaigns.length}
        resultLabel="Campañas"
      >
        <div className="filter-bar lead-filters">
          <label><span>Buscar</span><input value={query} onChange={(event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)} placeholder="Nombre de campaña" /></label>
          <label><span>Unidad</span><select value={unitId} onChange={(event: ChangeEvent<HTMLSelectElement>) => setUnitId(event.target.value)}>
            <option value="all">Todas</option>
            {units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}{unit.active ? "" : " (inactiva)"}</option>)}
          </select></label>
          <label><span>Estado</span><select value={status} onChange={(event: ChangeEvent<HTMLSelectElement>) => setStatus(event.target.value)}>
            <option value="all">Todos</option>
            {Object.entries(campaignStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
        </div>
      </CollapsibleFilters>

      <section className="campaigns-grid">
        {visibleCampaigns.map((campaign) => {
          const unit = units.find((item) => item.id === campaign.businessUnitId);
          const stats = statsFor(campaign, leads);
          const adsStats = adsStatsFor(campaign, ads);
          return (
            <article className="panel campaign-card" key={campaign.id}>
              <div className="campaign-card-heading">
                <div>
                  <span className="unit-name"><i style={{ background: unit?.accent }} />{unit?.name ?? "—"}</span>
                  <h3>{campaign.name}</h3>
                </div>
                <span className={campaign.status === "active" ? "badge badge-active" : campaign.status === "archived" ? "badge badge-lost" : "badge"}>{campaignStatusLabels[campaign.status]}</span>
              </div>
              <p className="muted">{campaign.channel || "Sin canal"} · {dateRangeLabel(campaign.startDate, campaign.endDate)}</p>
              <div className="campaign-stats-grid">
                <div><span>Leads</span><strong>{stats.total}</strong></div>
                <div><span>Contactados</span><strong>{stats.contacted}</strong></div>
                <div><span>Ofertas</span><strong>{stats.offers}</strong></div>
                <div><span>Ganados</span><strong>{stats.won}</strong></div>
                <div><span>Perdidos</span><strong>{stats.lost}</strong></div>
                <div><span>Conversión</span><strong>{formatPercent(stats.conversion)}</strong></div>
              </div>
              <div className="campaign-card-footer">
                <span>Presupuesto <strong>{campaign.budget ? currencyFormatter.format(campaign.budget) : "—"}</strong></span>
                <span>Valor total <strong>{currencyFormatter.format(stats.value)}</strong></span>
              </div>
              {campaign.directSalesCount > 0 || campaign.directSaleValue > 0 ? (
                <p className="muted campaign-direct-sales-note">Incluye {campaign.directSalesCount} venta{campaign.directSalesCount === 1 ? "" : "s"} directa{campaign.directSalesCount === 1 ? "" : "s"} ({currencyFormatter.format(campaign.directSaleValue)}) sin pasar por leads.</p>
              ) : null}
              {adsStats.count > 0 ? (
                <p className="muted campaign-direct-sales-note">Meta Ads: {adsStats.count} entrada{adsStats.count === 1 ? "" : "s"} vinculada{adsStats.count === 1 ? "" : "s"} · gasto {currencyFormatter.format(adsStats.spend)} · ingresos {currencyFormatter.format(adsStats.revenue)} · ROAS {adsStats.roas.toFixed(2)}x</p>
              ) : null}
              {canEdit ? (
                <div className="modal-actions campaign-card-actions">
                  <button type="button" className="button button-compact button-secondary" onClick={() => openEdit(campaign)}>Editar</button>
                  {campaign.status !== "archived" ? <button type="button" className="button button-compact button-secondary" onClick={() => setPendingArchive(campaign)}>Archivar</button> : null}
                </div>
              ) : null}
            </article>
          );
        })}
        {visibleCampaigns.length === 0 ? <div className="notice"><strong>Sin campañas</strong><span>No hay campañas que coincidan con los filtros seleccionados.</span></div> : null}
      </section>

      <ConfirmationDialog
        open={Boolean(pendingArchive)}
        title="¿Quieres archivar la campaña?"
        confirmLabel="Archivar campaña"
        busy={busy}
        onCancel={() => setPendingArchive(null)}
        onConfirm={() => void confirmArchive()}
      >
        {pendingArchive ? <div className="confirmation-summary"><span>Campaña</span><strong>{pendingArchive.name}</strong><span>Efecto</span><strong>Deja de estar activa, pero se conserva junto a sus leads.</strong></div> : null}
      </ConfirmationDialog>

      <Modal open={editorOpen} title={editingId ? "Editar campaña" : "Nueva campaña"} eyebrow="Gestión de captación" onClose={() => setEditorOpen(false)}>
        <form className="lead-editor-form" onSubmit={saveCampaign}>
          <div className="form-grid">
            <label><span>Unidad de negocio *</span><select value={draft.businessUnitId} disabled={!canEdit} onChange={(event) => updateDraft("businessUnitId", event.target.value)}>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>
            <label><span>Nombre *</span><input value={draft.name} readOnly={!canEdit} onChange={(event) => updateDraft("name", event.target.value)} /></label>
            <label><span>Canal</span><input value={draft.channel ?? ""} readOnly={!canEdit} onChange={(event) => updateDraft("channel", event.target.value)} placeholder="Email, Web, RRSS…" /></label>
            <label><span>Estado</span><select value={draft.status} disabled={!canEdit} onChange={(event) => updateDraft("status", event.target.value as CampaignStatus)}>{Object.entries(campaignStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label><span>Fecha inicio</span><input type="date" value={draft.startDate ?? ""} readOnly={!canEdit} onChange={(event) => updateDraft("startDate", event.target.value || null)} /></label>
            <label><span>Fecha fin</span><input type="date" value={draft.endDate ?? ""} readOnly={!canEdit} onChange={(event) => updateDraft("endDate", event.target.value || null)} /></label>
            <label><span>Presupuesto</span><input type="number" min="0" step="0.01" value={draft.budget ?? ""} readOnly={!canEdit} onChange={(event) => updateDraft("budget", event.target.value ? Number(event.target.value) : null)} /></label>
            <label><span>Ventas directas (sin lead)</span><input type="number" min="0" step="1" value={draft.directSalesCount} readOnly={!canEdit} onChange={(event) => updateDraft("directSalesCount", Number(event.target.value) || 0)} /></label>
            <label><span>Valor de ventas directas</span><input type="number" min="0" step="0.01" value={draft.directSaleValue} readOnly={!canEdit} onChange={(event) => updateDraft("directSaleValue", Number(event.target.value) || 0)} /></label>
            <label className="form-field-wide"><span>Notas</span><textarea rows={4} value={draft.notes ?? ""} readOnly={!canEdit} onChange={(event) => updateDraft("notes", event.target.value)} /></label>
          </div>
          <div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setEditorOpen(false)}>Cerrar</button>{canEdit ? <button type="submit" className="button button-primary" disabled={busy}>{busy ? "Guardando…" : "Guardar campaña"}</button> : null}</div>
        </form>
      </Modal>
    </div>
  );
}
