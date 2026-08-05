"use client";

import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { leadStatusLabels, leadTypeLabels, type LeadTypeValue } from "@/lib/constants";
import { businessUnits as demoBusinessUnits, campaigns as demoCampaigns, demoLeads } from "@/lib/demo-data";
import { currencyFormatter, formatDate } from "@/lib/format";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import type { BusinessUnit, Lead, LeadStatus } from "@/lib/types";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Modal } from "@/components/ui/modal";

const STORAGE_KEY = "intec-demo-leads";

type CampaignOption = { id: string; name: string; businessUnitId: string };
type LeadDraft = Omit<Lead, "id" | "createdAt">;

function blankDraft(units: BusinessUnit[]): LeadDraft {
  return {
    updatedAt: new Date().toISOString(),
    businessUnitId: units[0]?.id ?? "",
    campaignId: null,
    campaign: "",
    contactName: "",
    clientCompanyName: "",
    email: "",
    phone: "",
    location: "",
    productInterest: "",
    status: "new",
    type: "Venta",
    source: "",
    notes: "",
    saleValue: null,
    statusHistory: [],
  };
}

function nestedName(value: unknown): string {
  if (Array.isArray(value)) return nestedName(value[0]);
  if (value && typeof value === "object" && "name" in value) return String((value as { name?: unknown }).name ?? "");
  return "";
}

function isLeadTypeValue(value: unknown): value is LeadTypeValue {
  return typeof value === "string" && value in leadTypeLabels;
}

function mapLeadRow(row: Record<string, unknown>): Lead {
  const historyValue = Array.isArray(row.lead_status_history) ? row.lead_status_history : [];
  return {
    id: String(row.id),
    createdAt: String(row.created_at),
    updatedAt: row.updated_at ? String(row.updated_at) : undefined,
    businessUnitId: String(row.business_unit_id),
    campaignId: row.campaign_id ? String(row.campaign_id) : null,
    campaign: nestedName(row.campaigns),
    contactName: String(row.contact_name ?? ""),
    clientCompanyName: String(row.client_company_name ?? ""),
    email: String(row.email ?? ""),
    phone: String(row.phone ?? ""),
    location: String(row.location ?? ""),
    productInterest: String(row.product_interest ?? ""),
    status: row.status as LeadStatus,
    type: isLeadTypeValue(row.lead_type) ? leadTypeLabels[row.lead_type] : "Otro",
    source: String(row.source ?? ""),
    notes: String(row.notes ?? ""),
    saleValue: row.sale_value === null || row.sale_value === undefined ? null : Number(row.sale_value),
    statusHistory: historyValue.map((item) => {
      const history = item as Record<string, unknown>;
      return {
        id: String(history.id),
        previousStatus: history.previous_status ? history.previous_status as LeadStatus : null,
        newStatus: history.new_status as LeadStatus,
        changedAt: String(history.changed_at),
      };
    }).sort((a, b) => b.changedAt.localeCompare(a.changedAt)),
  };
}

function typeValueFromLabel(label: string): LeadTypeValue {
  const entry = Object.entries(leadTypeLabels).find(([, value]) => value === label);
  return (entry?.[0] as LeadTypeValue | undefined) ?? "other";
}

function initialDemoLeads(configured: boolean): Lead[] {
  if (configured || typeof window === "undefined") return demoLeads;
  const saved = window.localStorage.getItem(STORAGE_KEY);
  return saved ? (JSON.parse(saved) as Lead[]) : demoLeads;
}

export function LeadsTable() {
  const configured = isSupabaseConfigured();
  const [rows, setRows] = useState<Lead[]>(() => initialDemoLeads(configured));
  const [units, setUnits] = useState<BusinessUnit[]>(demoBusinessUnits);
  const [campaignOptions, setCampaignOptions] = useState<CampaignOption[]>(demoCampaigns.map((campaign) => ({ id: campaign.id, name: campaign.name, businessUnitId: campaign.businessUnitId })));
  const [query, setQuery] = useState("");
  const [unitId, setUnitId] = useState("all");
  const [status, setStatus] = useState("all");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<LeadDraft>(() => blankDraft(demoBusinessUnits));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [canEdit, setCanEdit] = useState(true);
  const [pendingStatus, setPendingStatus] = useState<{ lead: Lead; status: LeadStatus } | null>(null);

  useEffect(() => {
    if (!configured) return;
    void loadRealData();
  }, [configured]);

  const filteredCampaigns = useMemo(() => campaignOptions.filter((campaign) => !draft.businessUnitId || campaign.businessUnitId === draft.businessUnitId), [campaignOptions, draft.businessUnitId]);
  const visibleRows = useMemo(() => rows.filter((lead) => {
    const matchesQuery = `${lead.contactName} ${lead.clientCompanyName} ${lead.productInterest} ${lead.phone} ${lead.email}`.toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (unitId === "all" || lead.businessUnitId === unitId) && (status === "all" || lead.status === status);
  }), [query, rows, status, unitId]);

  async function loadRealData() {
    const supabase = createClient();
    const [{ data: unitData, error: unitError }, { data: campaignData, error: campaignError }, { data: leadData, error: leadError }, { data: authData }] = await Promise.all([
      supabase.from("business_units").select("id, name, slug, brand_color, is_active").eq("is_active", true).order("name"),
      supabase.from("campaigns").select("id, name, business_unit_id").neq("status", "archived").order("name"),
      supabase.from("leads").select("id, business_unit_id, campaign_id, contact_name, client_company_name, email, phone, location, product_interest, status, lead_type, source, notes, sale_value, created_at, updated_at, campaigns(name), lead_status_history(id, previous_status, new_status, changed_at)").order("created_at", { ascending: false }).limit(500),
      supabase.auth.getUser(),
    ]);
    if (unitError || campaignError || leadError) {
      setMessage(unitError?.message || campaignError?.message || leadError?.message || "No se pudieron cargar los datos.");
      return;
    }
    const mappedUnits: BusinessUnit[] = (unitData ?? []).map((row) => ({ id: row.id, name: row.name, slug: row.slug, accent: row.brand_color || "#2563eb", active: row.is_active }));
    setUnits(mappedUnits);
    setCampaignOptions((campaignData ?? []).map((row) => ({ id: row.id, name: row.name, businessUnitId: row.business_unit_id })));
    setRows((leadData ?? []).map((row) => mapLeadRow(row as Record<string, unknown>)));
    const user = authData.user;
    if (user) {
      const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
      setCanEdit(profile?.role !== "viewer");
    }
  }

  function persistDemo(next: Lead[]) {
    setRows(next);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }

  function openNew() {
    setEditingId(null);
    setDraft(blankDraft(units));
    setEditorOpen(true);
    setMessage(null);
  }

  function openEdit(lead: Lead) {
    setEditingId(lead.id);
    setDraft({
      updatedAt: lead.updatedAt,
      businessUnitId: lead.businessUnitId,
      campaignId: lead.campaignId,
      campaign: lead.campaign,
      contactName: lead.contactName,
      clientCompanyName: lead.clientCompanyName,
      email: lead.email,
      phone: lead.phone,
      location: lead.location,
      productInterest: lead.productInterest,
      status: lead.status,
      type: lead.type,
      source: lead.source,
      notes: lead.notes,
      saleValue: lead.saleValue,
      statusHistory: lead.statusHistory,
    });
    setEditorOpen(true);
    setMessage(null);
  }

  function updateDraft<K extends keyof LeadDraft>(key: K, value: LeadDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function saveLead(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.businessUnitId || (!draft.contactName.trim() && !draft.clientCompanyName.trim())) {
      setMessage("Selecciona una unidad y añade el contacto o la empresa cliente.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      if (!configured) {
        const previous = editingId ? rows.find((lead) => lead.id === editingId) : null;
        const nextHistory = previous && previous.status !== draft.status
          ? [{ id: `H-${Date.now()}`, previousStatus: previous.status, newStatus: draft.status, changedAt: new Date().toISOString(), changedByName: "Alín" }, ...(previous.statusHistory ?? [])]
          : previous?.statusHistory ?? [];
        const selectedCampaign = campaignOptions.find((campaign) => campaign.id === draft.campaignId);
        const nextLead: Lead = {
          ...draft,
          id: editingId ?? `LD-${Date.now()}`,
          createdAt: previous?.createdAt ?? new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          campaign: selectedCampaign?.name ?? "",
          statusHistory: nextHistory,
        };
        const nextRows = editingId ? rows.map((lead) => lead.id === editingId ? nextLead : lead) : [nextLead, ...rows];
        persistDemo(nextRows);
        setMessage(editingId ? "Lead actualizado en el modo demostración." : "Lead creado en el modo demostración.");
      } else {
        const payload = {
          business_unit_id: draft.businessUnitId,
          campaign_id: draft.campaignId || null,
          contact_name: draft.contactName.trim() || null,
          client_company_name: draft.clientCompanyName.trim() || null,
          email: draft.email.trim() || null,
          phone: draft.phone.trim() || null,
          location: draft.location.trim() || null,
          product_interest: draft.productInterest.trim() || null,
          status: draft.status,
          lead_type: typeValueFromLabel(draft.type),
          source: draft.source.trim() || null,
          notes: draft.notes?.trim() || null,
          sale_value: draft.saleValue,
        };
        const supabase = createClient();
        const result = editingId ? await supabase.from("leads").update(payload).eq("id", editingId) : await supabase.from("leads").insert(payload);
        if (result.error) throw result.error;
        await loadRealData();
        setMessage(editingId ? "Lead actualizado correctamente." : "Lead creado correctamente.");
      }
      setEditorOpen(false);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "No se pudo guardar el lead.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmStatusChange() {
    if (!pendingStatus) return;
    setBusy(true);
    try {
      if (!configured) {
        const next = rows.map((lead) => lead.id === pendingStatus.lead.id ? {
          ...lead,
          status: pendingStatus.status,
          updatedAt: new Date().toISOString(),
          statusHistory: [{ id: `H-${Date.now()}`, previousStatus: lead.status, newStatus: pendingStatus.status, changedAt: new Date().toISOString(), changedByName: "Alín" }, ...(lead.statusHistory ?? [])],
        } : lead);
        persistDemo(next);
      } else {
        const { error } = await createClient().from("leads").update({ status: pendingStatus.status }).eq("id", pendingStatus.lead.id);
        if (error) throw error;
        await loadRealData();
      }
      setMessage(`Estado actualizado a ${leadStatusLabels[pendingStatus.status]}.`);
      setPendingStatus(null);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "No se pudo actualizar el estado.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-stack">
      <section className="section-heading">
        <div><span className="eyebrow">Base comercial</span><h2>Leads</h2><p>Edita la información, cambia estados de forma controlada y consulta el historial comercial.</p></div>
        {canEdit ? <button className="button button-primary" onClick={openNew}>+ Nuevo lead</button> : null}
      </section>
      {message ? <div className="form-message" role="status">{message}</div> : null}
      <section className="panel filter-bar lead-filters">
        <label><span>Buscar</span><input value={query} onChange={(event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)} placeholder="Nombre, empresa, teléfono o producto" /></label>
        <label><span>Unidad</span><select value={unitId} onChange={(event: ChangeEvent<HTMLSelectElement>) => setUnitId(event.target.value)}><option value="all">Todas</option>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>
        <label><span>Estado</span><select value={status} onChange={(event: ChangeEvent<HTMLSelectElement>) => setStatus(event.target.value)}><option value="all">Todos</option>{Object.entries(leadStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <div className="filter-summary"><span>Resultados</span><strong>{visibleRows.length} leads</strong></div>
      </section>
      <section className="panel table-panel">
        <div className="table-scroll">
          <table>
            <thead><tr><th>Fecha</th><th>Unidad</th><th>Contacto / empresa</th><th>Campaña</th><th>Estado</th><th>Interés</th><th>Valor</th><th>Acciones</th></tr></thead>
            <tbody>{visibleRows.map((lead) => {
              const unit = units.find((item) => item.id === lead.businessUnitId);
              return (
                <tr key={lead.id}>
                  <td>{formatDate(lead.createdAt)}</td>
                  <td><span className="unit-name"><i style={{ background: unit?.accent }} />{unit?.name ?? "—"}</span></td>
                  <td><strong>{lead.contactName || "Sin contacto"}</strong><small>{lead.clientCompanyName || "—"}</small></td>
                  <td>{lead.campaign || "General"}</td>
                  <td>{canEdit ? <select className={`table-select badge-select badge-${lead.status}`} value={lead.status} onChange={(event) => setPendingStatus({ lead, status: event.target.value as LeadStatus })}>{Object.entries(leadStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select> : <span className={`badge badge-${lead.status}`}>{leadStatusLabels[lead.status]}</span>}</td>
                  <td>{lead.productInterest || "—"}</td>
                  <td>{lead.saleValue ? currencyFormatter.format(lead.saleValue) : "—"}</td>
                  <td><button type="button" className="button button-compact button-secondary" onClick={() => openEdit(lead)}>{canEdit ? "Editar" : "Ver"}</button></td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      </section>

      <ConfirmationDialog
        open={Boolean(pendingStatus)}
        title="¿Quieres cambiar el estado del lead?"
        confirmLabel="Cambiar estado"
        busy={busy}
        onCancel={() => setPendingStatus(null)}
        onConfirm={() => void confirmStatusChange()}
      >
        {pendingStatus ? <div className="confirmation-summary"><span>Lead</span><strong>{pendingStatus.lead.contactName || pendingStatus.lead.clientCompanyName}</strong><span>Cambio</span><strong>{leadStatusLabels[pendingStatus.lead.status]} → {leadStatusLabels[pendingStatus.status]}</strong></div> : null}
      </ConfirmationDialog>

      <Modal open={editorOpen} title={editingId ? "Editar lead" : "Nuevo lead"} eyebrow="Gestión comercial" onClose={() => setEditorOpen(false)}>
        <form className="lead-editor-form" onSubmit={saveLead}>
          <div className="form-grid">
            <label><span>Unidad de negocio *</span><select value={draft.businessUnitId} disabled={!canEdit} onChange={(event) => { updateDraft("businessUnitId", event.target.value); updateDraft("campaignId", null); }}>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>
            <label><span>Campaña</span><select value={draft.campaignId ?? ""} disabled={!canEdit} onChange={(event) => updateDraft("campaignId", event.target.value || null)}><option value="">General / sin campaña</option>{filteredCampaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select></label>
            <label><span>Contacto</span><input value={draft.contactName} readOnly={!canEdit} onChange={(event) => updateDraft("contactName", event.target.value)} /></label>
            <label><span>Empresa cliente</span><input value={draft.clientCompanyName} readOnly={!canEdit} onChange={(event) => updateDraft("clientCompanyName", event.target.value)} /></label>
            <label><span>Email</span><input type="email" value={draft.email} readOnly={!canEdit} onChange={(event) => updateDraft("email", event.target.value)} /></label>
            <label><span>Teléfono</span><input value={draft.phone} readOnly={!canEdit} onChange={(event) => updateDraft("phone", event.target.value)} /></label>
            <label><span>Población</span><input value={draft.location} readOnly={!canEdit} onChange={(event) => updateDraft("location", event.target.value)} /></label>
            <label><span>Producto o interés</span><input value={draft.productInterest} readOnly={!canEdit} onChange={(event) => updateDraft("productInterest", event.target.value)} /></label>
            <label><span>Estado *</span><select value={draft.status} disabled={!canEdit} onChange={(event) => updateDraft("status", event.target.value as LeadStatus)}>{Object.entries(leadStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label><span>Tipo</span><select value={draft.type} disabled={!canEdit} onChange={(event) => updateDraft("type", event.target.value)}>{Object.values(leadTypeLabels).map((label) => <option key={label} value={label}>{label}</option>)}</select></label>
            <label><span>Fuente</span><input value={draft.source} readOnly={!canEdit} onChange={(event) => updateDraft("source", event.target.value)} /></label>
            <label><span>Valor de venta</span><input type="number" min="0" step="0.01" value={draft.saleValue ?? ""} readOnly={!canEdit} onChange={(event) => updateDraft("saleValue", event.target.value ? Number(event.target.value) : null)} /></label>
            <label className="form-field-wide"><span>Observaciones</span><textarea rows={4} value={draft.notes ?? ""} readOnly={!canEdit} onChange={(event) => updateDraft("notes", event.target.value)} /></label>
          </div>
          {editingId && draft.statusHistory?.length ? <div className="history-panel"><h3>Historial de estados</h3><div className="history-list">{draft.statusHistory.map((event) => <div key={event.id}><span>{formatDate(event.changedAt)}</span><strong>{event.previousStatus ? `${leadStatusLabels[event.previousStatus]} → ` : ""}{leadStatusLabels[event.newStatus]}</strong></div>)}</div></div> : null}
          <div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setEditorOpen(false)}>Cerrar</button>{canEdit ? <button type="submit" className="button button-primary" disabled={busy}>{busy ? "Guardando…" : "Guardar lead"}</button> : null}</div>
        </form>
      </Modal>
    </div>
  );
}
