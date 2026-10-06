"use client";

import { useSearchParams } from "next/navigation";
import { DateField } from "@/components/ui/date-field";
import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { LEADS_ROLES, LEAD_ASSIGN_ROLES, hasAnyRole, leadStatusLabels, leadTypeLabels, type LeadTypeValue } from "@/lib/constants";
import { downloadCsvReport, type CsvSummaryItem } from "@/lib/csv-export";
import { businessUnits as demoBusinessUnits, campaigns as demoCampaigns, demoLeads } from "@/lib/demo-data";
import { writeRows } from "@/lib/supabase/write";
import { reportSafeError } from "@/lib/errors";
import { currencyFormatter, formatDate, formatDateTime, formatPercent, numberFormatter } from "@/lib/format";
import { leadRecord, leadRecordText } from "@/lib/lead-log";
import { exportLeadReportPdf } from "@/lib/lead-report-pdf";
import { inDateKeyRange } from "@/lib/dates";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { fetchAllPages } from "@/lib/supabase/fetch-all";
import type { AppRole, BusinessUnit, Lead, LeadStatus } from "@/lib/types";
import { CollapsibleFilters } from "@/components/ui/collapsible-filters";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Modal } from "@/components/ui/modal";
import { Toast } from "@/components/ui/toast";
import { ReportExportButtons } from "@/components/ui/report-export-buttons";
import { UnitBrandMark } from "@/components/unit-brand-mark";
import { KpiCard } from "@/components/kpi-card";
import { MetaFreshness } from "@/components/meta-freshness";
import { ConversionIcon, EuroIcon, LeadsIcon, PlusCircleIcon } from "@/components/icons";
import { PageLoadFailed, PageLoader } from "@/components/ui/page-loader";

const STORAGE_KEY = "intec-demo-leads";
/** Al pasar a estos estados se pide el importe: es el de su oferta o su venta en Consultas. */
const VALUE_STATUSES: LeadStatus[] = ["offer_sent", "won"];

/** Qué le pasa a su apunte de Consultas con el cambio, si ya tenía uno (lo hace la base). */
function consultasNote(from: LeadStatus, to: LeadStatus): string | null {
  if (!["offer_sent", "interested", "won"].includes(from)) return null;
  if (to === "interested") return "Su oferta en Consultas pasa a seguimiento.";
  if (to === "lost") return "Su apunte en Consultas pasa a perdido.";
  if (to === "offer_sent" || to === "won") return null;
  return "Su apunte en Consultas se quita: la oferta deja de estar en pie.";
}

type CampaignOption = { id: string; name: string; businessUnitId: string };
type TeamMember = { id: string; fullName: string; roles: AppRole[] };
type OwnerFilter = "all" | "mine" | "unassigned" | string;
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
    assignees: [],
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

function mapLeadRow(row: Record<string, unknown>, asignados: Map<string, string[]>): Lead {
  const historyValue = Array.isArray(row.lead_status_history) ? row.lead_status_history : [];
  const logValue = Array.isArray(row.lead_log) ? row.lead_log as Record<string, unknown>[] : [];
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
    assignees: asignados.get(String(row.id)) ?? [],
    statusHistory: historyValue.map((item) => {
      const history = item as Record<string, unknown>;
      return {
        id: String(history.id),
        previousStatus: history.previous_status ? history.previous_status as LeadStatus : null,
        newStatus: history.new_status as LeadStatus,
        changedAt: String(history.changed_at),
        changedBy: history.changed_by ? String(history.changed_by) : null,
      };
    }).sort((a, b) => b.changedAt.localeCompare(a.changedAt)),
    log: logValue.map((item) => ({ id: String(item.id), createdAt: String(item.created_at), kind: String(item.kind), text: String(item.text ?? "") })),
  };
}

function typeValueFromLabel(label: string): LeadTypeValue {
  const entry = Object.entries(leadTypeLabels).find(([, value]) => value === label);
  return (entry?.[0] as LeadTypeValue | undefined) ?? "other";
}

/**
 * Avisa por correo del lead nuevo. Sin `avisarA` va a sus responsables, y si no
 * tiene ninguno a administración. Que falle el correo no puede tumbar el
 * guardado, así que no se espera la respuesta.
 */
function avisarLeadNuevo(leadId: string, avisarA?: string[]) {
  void fetch("/api/leads/notify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(avisarA ? { leadId, avisarA } : { leadId }),
  }).catch((cause) => console.error("No se pudo enviar el aviso del lead:", cause));
}

function initialDemoLeads(configured: boolean): Lead[] {
  if (configured || typeof window === "undefined") return demoLeads;
  const saved = window.localStorage.getItem(STORAGE_KEY);
  return saved ? (JSON.parse(saved) as Lead[]) : demoLeads;
}

export function LeadsTable() {
  const configured = isSupabaseConfigured();
  const [rows, setRows] = useState<Lead[]>(() => initialDemoLeads(configured));
  const [units, setUnits] = useState<BusinessUnit[]>(() => demoBusinessUnits.filter((unit) => unit.active));
  const [campaignOptions, setCampaignOptions] = useState<CampaignOption[]>(demoCampaigns.map((campaign) => ({ id: campaign.id, name: campaign.name, businessUnitId: campaign.businessUnitId })));
  const [query, setQuery] = useState("");
  const [unitId, setUnitId] = useState<string>("all");
  const [status, setStatus] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<LeadDraft>(() => blankDraft(demoBusinessUnits.filter((unit) => unit.active)));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [canEdit, setCanEdit] = useState(true);
  const [pendingStatus, setPendingStatus] = useState<{ lead: Lead; status: LeadStatus } | null>(null);
  /** El importe que se pide al pasar a oferta o a ganado: es el de su apunte en Consultas. */
  const [pendingValue, setPendingValue] = useState("");
  const [access, setAccess] = useState<"checking" | "allowed" | "denied">(configured ? "checking" : "allowed");
  /** La primera carga falló: en vez de girar para siempre se dice y se puede reintentar. */
  const [loadFailed, setLoadFailed] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  /** Repartir leads es cosa de administración; un comercial ve el responsable pero no lo cambia. */
  const [canAssign, setCanAssign] = useState(true);
  /** false mientras no se haya aplicado la migración de lead_assignees. */
  const [asignacionesOk, setAsignacionesOk] = useState(true);
  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>("all");
  const searchParams = useSearchParams();
  const urlQuery = searchParams.get("q") ?? "";
  const urlOwner = searchParams.get("owner") ?? "";
  // Desde Inicio se llega con un estado ya elegido (las tarjetas de conversión y valor ganado).
  const urlStatus = searchParams.get("status") ?? "";
  const urlKey = `${urlQuery}|${urlOwner}|${urlStatus}`;
  const [appliedUrlKey, setAppliedUrlKey] = useState("||");
  if (urlKey !== "||" && urlKey !== appliedUrlKey) {
    setAppliedUrlKey(urlKey);
    setUnitId("all");
    if (urlQuery) setQuery(urlQuery);
    if (urlOwner === "mine") {
      setOwnerFilter("mine");
      setStatus("new");
    }
    if (urlStatus in leadStatusLabels) setStatus(urlStatus);
  }
  // Nuevos leads solo ofrecen unidades marcadas visibleInLeads; al editar uno
  // existente se mantienen todas para no perder su marca si se ocultó después.
  const registrableUnits = useMemo(() => units.filter((unit) => unit.visibleInLeads), [units]);
  const unitOptions = editingId ? units : registrableUnits;

  useEffect(() => {
    if (!configured) return;
    loadRealData().catch((cause: unknown) => {
      setMessage(reportSafeError(cause, "No se pudieron cargar los datos."));
      setLoadFailed(true);
    });
  }, [configured]);

  const filteredCampaigns = useMemo(() => campaignOptions.filter((campaign) => !draft.businessUnitId || campaign.businessUnitId === draft.businessUnitId), [campaignOptions, draft.businessUnitId]);
  const visibleRows = useMemo(() => rows.filter((lead) => {
    const matchesQuery = `${lead.contactName} ${lead.clientCompanyName} ${lead.productInterest} ${lead.phone} ${lead.email}`.toLowerCase().includes(query.toLowerCase());
    const matchesDates = inDateKeyRange(lead.createdAt, dateFrom, dateTo);
    const owners = lead.assignees ?? [];
    const matchesOwner = ownerFilter === "all"
      || (ownerFilter === "mine"
        ? Boolean(currentUserId) && owners.includes(currentUserId as string)
        : ownerFilter === "unassigned" ? owners.length === 0 : owners.includes(ownerFilter));
    return matchesQuery && (unitId === "all" || lead.businessUnitId === unitId) && (status === "all" || lead.status === status) && matchesDates && matchesOwner;
  }), [query, rows, status, unitId, dateFrom, dateTo, ownerFilter, currentUserId]);

  const teamById = useMemo(() => new Map(team.map((member) => [member.id, member.fullName])), [team]);
  const ownerName = (id: string) => teamById.get(id) ?? "Usuario inactivo";
  const recordOf = (lead: Lead) => leadRecord({
    createdAt: lead.createdAt,
    source: lead.source,
    statusLabel: (value) => leadStatusLabels[value as LeadStatus] ?? value,
    log: lead.log ?? [],
    history: (lead.statusHistory ?? []).map((change) => ({ ...change, changedByName: change.changedByName ?? (change.changedBy ? teamById.get(change.changedBy) ?? null : null) })),
  });
  const editingLead = editingId ? rows.find((lead) => lead.id === editingId) ?? null : null;
  const ownerNames = (lead: Lead) => {
    const owners = lead.assignees ?? [];
    return owners.length ? owners.map(ownerName).join(" · ") : "Sin asignar";
  };
  // Only commercials can own leads; keep the current owners listed even if their role changed.
  const ownerOptions = useMemo(
    () => team.filter((member) => member.roles.includes("commercial") || (draft.assignees ?? []).includes(member.id)),
    [team, draft.assignees],
  );

  /**
   * Pulsar una tarjeta filtra la lista por su estado, y volver a pulsarla lo
   * quita. Las cuatro hablan del mismo filtro —"Estado"—, así que "Conversión"
   * y "Valor ganado" llevan las dos a los ganados, y "Leads" lo deja en todos.
   */
  const filtrarPorEstado = (destino: string) => () => {
    setStatus((actual) => (destino !== "all" && actual === destino ? "all" : destino));
  };

  const leadSummary = useMemo(() => {
    const won = visibleRows.filter((lead) => lead.status === "won");
    return {
      total: visibleRows.length,
      fresh: visibleRows.filter((lead) => lead.status === "new").length,
      won: won.length,
      conversion: visibleRows.length ? (won.length / visibleRows.length) * 100 : 0,
      value: won.reduce((sum, lead) => sum + (lead.saleValue ?? 0), 0),
    };
  }, [visibleRows]);

  function firstLoad() {
    setLoadFailed(false);
    loadRealData().catch((cause: unknown) => {
      setMessage(reportSafeError(cause, "No se pudieron cargar los datos."));
      setLoadFailed(true);
    });
  }

  async function loadRealData() {
    const supabase = createClient();
    const [{ data: unitData, error: unitError }, { data: campaignData, error: campaignError }, { data: leadData, error: leadError }, { data: authData }, { data: asignadosData, error: asignadosError }] = await Promise.all([
      supabase.from("business_units").select("id, name, slug, brand_color, logo_url, is_active, sort_order, visible_in_consultas, visible_in_leads").eq("is_active", true).order("sort_order"),
      supabase.from("campaigns").select("id, name, business_unit_id").neq("status", "archived").order("name"),
      fetchAllPages((from, to) => supabase.from("leads").select("id, business_unit_id, campaign_id, contact_name, client_company_name, email, phone, location, product_interest, status, lead_type, source, notes, sale_value, created_at, updated_at, campaigns(name), lead_status_history(id, previous_status, new_status, changed_at, changed_by), lead_log(id, created_at, kind, text)").order("created_at", { ascending: false }).order("id").range(from, to)),
      supabase.auth.getUser(),
      // En consulta aparte y no anidada en la de leads: si la migración de
      // responsables no está aplicada todavía, la página sigue funcionando.
      fetchAllPages<{ lead_id: string; profile_id: string }>((from, to) => supabase.from("lead_assignees").select("lead_id, profile_id").order("lead_id").order("profile_id").range(from, to)),
    ]);
    if (unitError || campaignError || leadError) {
      setMessage(reportSafeError(unitError ?? campaignError ?? leadError, "No se pudieron cargar los datos."));
      setLoadFailed(true);
      return;
    }
    const mappedUnits: BusinessUnit[] = (unitData ?? []).map((row) => ({ id: row.id, name: row.name, slug: row.slug, accent: row.brand_color || "#2563eb", active: row.is_active, logo: row.logo_url, sortOrder: row.sort_order ?? 0, visibleInConsultas: row.visible_in_consultas ?? true, visibleInLeads: row.visible_in_leads ?? true }));
    setUnits(mappedUnits);
    setUnitId((current) => (current === "all" || mappedUnits.some((unit) => unit.id === current)) ? current : (mappedUnits[0]?.id ?? "all"));
    setCampaignOptions((campaignData ?? []).map((row) => ({ id: row.id, name: row.name, businessUnitId: row.business_unit_id })));
    const asignados = new Map<string, string[]>();
    for (const fila of asignadosData ?? []) {
      const lista = asignados.get(fila.lead_id) ?? [];
      lista.push(fila.profile_id);
      asignados.set(fila.lead_id, lista);
    }
    setAsignacionesOk(!asignadosError);
    setRows((leadData ?? []).map((row) => mapLeadRow(row as Record<string, unknown>, asignados)));
    const user = authData.user;
    if (user) {
      const [{ data: profile }, { data: teamData }] = await Promise.all([
        supabase.from("profiles").select("roles").eq("id", user.id).maybeSingle(),
        supabase.rpc("list_team_members"),
      ]);
      setCurrentUserId(user.id);
      setTeam(((teamData ?? []) as { id: string; full_name: string | null; roles: AppRole[] }[]).map((row) => ({ id: row.id, fullName: row.full_name || "Usuario", roles: row.roles })));
      setCanEdit(Boolean(profile && hasAnyRole(profile.roles, ["admin", "commercial", "marketing"])));
      setCanAssign(Boolean(profile && hasAnyRole(profile.roles, LEAD_ASSIGN_ROLES)));
      setAccess(profile && hasAnyRole(profile.roles, LEADS_ROLES) ? "allowed" : "denied");
    } else {
      setAccess("denied");
    }
  }

  function persistDemo(next: Lead[]) {
    setRows(next);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }

  function openNew() {
    setEditingId(null);
    // Sin responsable de partida: lo pone administración, que además recibe un
    // aviso por correo en cuanto el lead entra sin nadie detrás.
    const draftForNew = blankDraft(registrableUnits);
    setDraft(unitId !== "all" ? { ...draftForNew, businessUnitId: unitId } : { ...draftForNew, businessUnitId: "" });
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
      assignees: lead.assignees ?? [],
      statusHistory: lead.statusHistory,
    });
    setEditorOpen(true);
    setMessage(null);
  }

  function updateDraft<K extends keyof LeadDraft>(key: K, value: LeadDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function toggleAssignee(id: string) {
    setDraft((current) => {
      const actuales = current.assignees ?? [];
      return { ...current, assignees: actuales.includes(id) ? actuales.filter((otro) => otro !== id) : [...actuales, id] };
    });
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
        let leadId = editingId;
        if (editingId) {
          await writeRows(
            supabase.from("leads").update(payload).eq("id", editingId),
            "No se pudo guardar el lead: puede que alguien lo haya borrado o que tu rol no permita cambiarlo.",
          );
        } else {
          const { data, error } = await supabase.from("leads").insert(payload).select("id").single();
          if (error) throw error;
          leadId = String(data.id);
        }
        // Los responsables viven en su propia tabla, y solo los toca quien puede
        // repartir: para un comercial esto no se ejecuta nunca.
        const anteriores = editingId ? rows.find((lead) => lead.id === editingId)?.assignees ?? [] : [];
        const deseados = draft.assignees ?? [];
        const anadidos = deseados.filter((id) => !anteriores.includes(id));
        if (leadId && canAssign && asignacionesOk) {
          const quitados = anteriores.filter((id) => !deseados.includes(id));
          if (quitados.length) {
            const { error } = await supabase.from("lead_assignees").delete().eq("lead_id", leadId).in("profile_id", quitados);
            if (error) throw error;
          }
          if (anadidos.length) {
            const { error } = await supabase.from("lead_assignees").insert(anadidos.map((profileId) => ({ lead_id: leadId, profile_id: profileId })));
            if (error) throw error;
          }
          // Lead nuevo sin nadie marcado: los comerciales de su campaña, si los
          // tiene. Si falla, se queda sin responsable y el aviso va a administración.
          if (!editingId && deseados.length === 0 && draft.campaignId) {
            const { error } = await supabase.rpc("assign_lead_from_campaign", { p_lead: leadId });
            if (error) console.error("No se pudo asignar el lead por su campaña:", error.message);
          }
        }
        if (leadId) {
          // Lead nuevo: se avisa a quien lo lleve, o a administración si no lo
          // lleva nadie. Lead que ya existía: solo a los que se acaban de sumar.
          if (!editingId) avisarLeadNuevo(leadId);
          else if (anadidos.length) avisarLeadNuevo(leadId, anadidos);
        }
        await loadRealData();
        setMessage(editingId ? "Lead actualizado correctamente." : "Lead creado correctamente.");
      }
      setEditorOpen(false);
    } catch (cause) {
      setMessage(reportSafeError(cause, "No se pudo guardar el lead."));
    } finally {
      setBusy(false);
    }
  }

  function askStatusChange(lead: Lead, status: LeadStatus) {
    setPendingStatus({ lead, status });
    setPendingValue(lead.saleValue === null ? "" : String(lead.saleValue));
  }

  async function confirmStatusChange() {
    if (!pendingStatus) return;
    const withValue = VALUE_STATUSES.includes(pendingStatus.status);
    const saleValue = withValue ? (pendingValue.trim() === "" ? null : Number(pendingValue)) : pendingStatus.lead.saleValue;
    if (saleValue !== null && (!Number.isFinite(saleValue) || saleValue < 0)) {
      setMessage("El importe tiene que ser un número igual o mayor que cero.");
      return;
    }
    setBusy(true);
    try {
      if (!configured) {
        const next = rows.map((lead) => lead.id === pendingStatus.lead.id ? {
          ...lead,
          status: pendingStatus.status,
          saleValue,
          updatedAt: new Date().toISOString(),
          statusHistory: [{ id: `H-${Date.now()}`, previousStatus: lead.status, newStatus: pendingStatus.status, changedAt: new Date().toISOString(), changedByName: "Alín" }, ...(lead.statusHistory ?? [])],
        } : lead);
        persistDemo(next);
      } else {
        await writeRows(
          createClient().from("leads").update(withValue ? { status: pendingStatus.status, sale_value: saleValue } : { status: pendingStatus.status }).eq("id", pendingStatus.lead.id),
          "No se pudo cambiar el estado: puede que alguien haya borrado el lead o que tu rol no permita cambiarlo.",
        );
        await loadRealData();
      }
      setMessage(`Estado actualizado a ${leadStatusLabels[pendingStatus.status]}.`);
      setPendingStatus(null);
    } catch (cause) {
      setMessage(reportSafeError(cause, "No se pudo actualizar el estado."));
    } finally {
      setBusy(false);
    }
  }

  const activeUnitLabel = unitId === "all" ? "Todas las unidades" : units.find((unit) => unit.id === unitId)?.name ?? "Leads";

  function exportReportCsv() {
    const won = visibleRows.filter((lead) => lead.status === "won");
    const totalValue = won.reduce((sum, lead) => sum + (lead.saleValue ?? 0), 0);
    const summary: CsvSummaryItem[] = [
      { label: "Unidad", value: activeUnitLabel },
      { label: "Leads totales", value: visibleRows.length },
      { label: "Ganados", value: won.length },
      { label: "Conversión (%)", value: visibleRows.length ? formatPercent((won.length / visibleRows.length) * 100) : "0,0 %" },
      { label: "Valor ganado (€)", value: totalValue },
    ];
    downloadCsvReport(`informe_leads_${new Date().toISOString().slice(0, 10)}.csv`, summary, visibleRows, [
      { header: "Fecha", value: (lead) => formatDate(lead.createdAt) },
      { header: "Unidad", value: (lead) => units.find((unit) => unit.id === lead.businessUnitId)?.name ?? "" },
      { header: "Contacto", value: (lead) => lead.contactName },
      { header: "Empresa", value: (lead) => lead.clientCompanyName },
      { header: "Email", value: (lead) => lead.email },
      { header: "Teléfono", value: (lead) => lead.phone },
      { header: "Campaña", value: (lead) => lead.campaign || "General" },
      { header: "Estado", value: (lead) => leadStatusLabels[lead.status] },
      { header: "Tipo", value: (lead) => lead.type },
      { header: "Interés", value: (lead) => lead.productInterest },
      { header: "Fuente", value: (lead) => lead.source },
      { header: "Responsables", value: (lead) => ownerNames(lead) },
      { header: "Valor (€)", value: (lead) => lead.saleValue ?? "" },
      { header: "Notas", value: (lead) => lead.notes ?? "" },
      { header: "Registro", value: (lead) => leadRecordText(recordOf(lead), formatDateTime) },
    ]);
  }

  async function exportReportPdf() {
    setPdfBusy(true);
    try {
      const won = visibleRows.filter((lead) => lead.status === "won");
      const totalValue = won.reduce((sum, lead) => sum + (lead.saleValue ?? 0), 0);
      await exportLeadReportPdf({
        activeUnitLabel,
        totalLeads: visibleRows.length,
        wonCount: won.length,
        conversionLabel: visibleRows.length ? formatPercent((won.length / visibleRows.length) * 100) : "0,0 %",
        wonValue: totalValue,
        leads: visibleRows,
        units,
        ownerNames,
      });
    } catch (cause) {
      setMessage(reportSafeError(cause, "No se pudo generar el PDF."));
    } finally {
      setPdfBusy(false);
    }
  }

  if (access === "checking") return loadFailed ? <PageLoadFailed message={message} onRetry={firstLoad} /> : <PageLoader label="Cargando los leads…" />;

  if (access === "denied") {
    return (
      <div className="page-stack">
        <section className="panel panel-padded">
          <h2>No tienes permiso para ver esta página</h2>
          <p>Leads no está disponible para tu rol.</p>
        </section>
      </div>
    );
  }

  return (
    <div className="page-stack">
      <section className="section-heading">
        <div><span className="eyebrow">Base comercial</span><h2>Leads · {activeUnitLabel}</h2><p>Al entrar salen los de todas las marcas. Elige una arriba para ver solo los suyos; la marca de cada lead se elige en su ficha.</p></div>
        <div className="panel-heading-trailing">
          <ReportExportButtons onExportCsv={exportReportCsv} onExportPdf={() => void exportReportPdf()} pdfBusy={pdfBusy} />
          {canEdit ? <button className="button button-primary" onClick={openNew}>+ Nuevo lead</button> : null}
        </div>
      </section>

      <section className="brand-picker">
        {units.map((unit) => (
          <button key={unit.id} type="button" className={unitId === unit.id ? "brand-tile active" : "brand-tile"} onClick={() => setUnitId(unit.id)}>
            <UnitBrandMark unit={unit} width={150} height={56} />
          </button>
        ))}
        <button type="button" className={unitId === "all" ? "brand-tile active" : "brand-tile"} onClick={() => setUnitId("all")}>
          <strong>Todas las unidades</strong>
        </button>
      </section>

      {!canEdit ? <div className="notice"><strong>Cuenta de solo lectura</strong><span>Puedes consultar los leads, pero no crear ni editar registros.</span></div> : null}

      <MetaFreshness />

      <Toast message={message} onDismiss={() => setMessage(null)} />
      <CollapsibleFilters
        hasActiveFilters={query !== "" || status !== "all" || ownerFilter !== "all" || dateFrom !== "" || dateTo !== ""}
        onClear={() => { setQuery(""); setStatus("all"); setOwnerFilter("all"); setDateFrom(""); setDateTo(""); }}
        resultCount={visibleRows.length}
        resultLabel="Leads"
      >
        <div className="filter-bar lead-filters">
          <label><span>Buscar</span><input value={query} onChange={(event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)} placeholder="Nombre, empresa, teléfono o producto" /></label>
          <label><span>Estado</span><select value={status} onChange={(event: ChangeEvent<HTMLSelectElement>) => setStatus(event.target.value)}><option value="all">Todos</option>{Object.entries(leadStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label><span>Responsable</span><select value={ownerFilter} onChange={(event: ChangeEvent<HTMLSelectElement>) => setOwnerFilter(event.target.value)}>
            <option value="all">Todos</option>
            {currentUserId ? <option value="mine">Mis leads</option> : null}
            <option value="unassigned">Sin asignar</option>
            {team.filter((member) => member.roles.includes("commercial")).map((member) => <option key={member.id} value={member.id}>{member.fullName}</option>)}
          </select></label>
          <label><span>Desde</span><DateField value={dateFrom} onChange={(value) => setDateFrom(value)} /></label>
          <label><span>Hasta</span><DateField value={dateTo} onChange={(value) => setDateTo(value)} /></label>
        </div>
      </CollapsibleFilters>
      <section className="kpi-grid">
        <KpiCard label="Leads" value={numberFormatter.format(leadSummary.total)} delta="Sin comparación" helper="según los filtros" icon={<LeadsIcon />} tone="sky" onClick={filtrarPorEstado("all")} actionLabel="Ver todos" active={status === "all"} />
        <KpiCard label="Sin contactar" value={numberFormatter.format(leadSummary.fresh)} delta="Sin comparación" helper="en estado nuevo" icon={<PlusCircleIcon />} tone={leadSummary.fresh > 0 ? "rose" : "indigo"} onClick={filtrarPorEstado("new")} actionLabel={status === "new" ? "Quitar filtro" : "Ver los nuevos"} active={status === "new"} />
        <KpiCard label="Conversión" value={formatPercent(leadSummary.conversion)} delta="Sin comparación" helper={`${numberFormatter.format(leadSummary.won)} ganados`} icon={<ConversionIcon />} tone="emerald" onClick={filtrarPorEstado("won")} actionLabel={status === "won" ? "Quitar filtro" : "Ver los ganados"} active={status === "won"} />
        <KpiCard label="Valor ganado" value={currencyFormatter.format(leadSummary.value)} delta="Sin comparación" helper="de los leads ganados" icon={<EuroIcon />} tone="amber" onClick={filtrarPorEstado("won")} actionLabel={status === "won" ? "Quitar filtro" : "Ver los ganados"} active={status === "won"} />
      </section>
      <section className="panel table-panel">
        <div className="table-scroll">
          <table>
            <thead><tr><th>Fecha</th><th>Unidad</th><th>Contacto / empresa</th><th>Campaña</th><th>Estado</th><th>Responsables</th><th>Interés</th><th>Valor</th><th>Acciones</th></tr></thead>
            <tbody>{visibleRows.map((lead) => {
              const unit = units.find((item) => item.id === lead.businessUnitId);
              return (
                <tr key={lead.id} className="table-row-clickable" onClick={() => openEdit(lead)}>
                  <td>{formatDate(lead.createdAt)}</td>
                  <td><span className="unit-name"><i style={{ background: unit?.accent }} />{unit?.name ?? "—"}</span></td>
                  <td><strong>{lead.contactName || "Sin contacto"}</strong><small>{lead.clientCompanyName || "—"}</small></td>
                  <td>{lead.campaign || "General"}</td>
                  <td onClick={(event) => event.stopPropagation()}>{canEdit ? <select className={`table-select badge-select badge-${lead.status}`} value={lead.status} onChange={(event) => askStatusChange(lead, event.target.value as LeadStatus)}>{Object.entries(leadStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select> : <span className={`badge badge-${lead.status}`}>{leadStatusLabels[lead.status]}</span>}</td>
                  <td className={(lead.assignees ?? []).length ? undefined : "muted"}>{ownerNames(lead)}</td>
                  <td>{lead.productInterest || "—"}</td>
                  <td>{lead.saleValue ? currencyFormatter.format(lead.saleValue) : "—"}</td>
                  <td onClick={(event) => event.stopPropagation()}><button type="button" className="button button-compact button-secondary" onClick={() => openEdit(lead)}>{canEdit ? "Editar" : "Ver"}</button></td>
                </tr>
              );
            })}
            {visibleRows.length === 0 ? <tr><td colSpan={9} className="muted">Sin leads que coincidan con los filtros seleccionados.</td></tr> : null}
            </tbody>
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
        {pendingStatus && VALUE_STATUSES.includes(pendingStatus.status) ? (
          <div className="confirmation-sale-form">
            <label>
              <span>{pendingStatus.status === "won" ? "Valor de la venta (€)" : "Valor de la oferta (€)"}</span>
              <input type="number" min="0" step="0.01" placeholder="0,00" value={pendingValue} onChange={(event) => setPendingValue(event.target.value)} />
            </label>
            <p className="muted">
              {pendingStatus.status === "won"
                ? "Pasa a Consultas como pedido (venta) y suma en su campaña y en el total de ventas, una sola vez."
                : "Se apunta en Consultas → Ventas comerciales como oferta enviada."}
            </p>
          </div>
        ) : pendingStatus && consultasNote(pendingStatus.lead.status, pendingStatus.status) ? (
          <p className="muted">{consultasNote(pendingStatus.lead.status, pendingStatus.status)}</p>
        ) : null}
      </ConfirmationDialog>

      <Modal open={editorOpen} title={editingId ? "Editar lead" : "Nuevo lead"} eyebrow="Gestión comercial" scrollInside onClose={() => setEditorOpen(false)}>
        <form className="lead-editor-form" onSubmit={saveLead}>
          <div className="form-grid">
            <label><span>Unidad de negocio *</span><select value={draft.businessUnitId} disabled={!canEdit || (!editingId && unitId !== "all")} onChange={(event) => { updateDraft("businessUnitId", event.target.value); updateDraft("campaignId", null); }}>{draft.businessUnitId ? null : <option value="">Elige una marca…</option>}{unitOptions.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>
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
            <label><span>Valor de la oferta o venta</span><input type="number" min="0" step="0.01" value={draft.saleValue ?? ""} readOnly={!canEdit} onChange={(event) => updateDraft("saleValue", event.target.value ? Number(event.target.value) : null)} /></label>
            <div className="form-field-wide owner-picker">
              <span>Responsables</span>
              {ownerOptions.length === 0 ? <p className="muted">No hay comerciales activos a quien asignarlo.</p> : (
                <div className="role-chip-group">
                  {ownerOptions.map((member) => (
                    <button
                      key={member.id}
                      type="button"
                      className={(draft.assignees ?? []).includes(member.id) ? "role-chip active" : "role-chip"}
                      disabled={!canEdit || !canAssign || !asignacionesOk}
                      aria-pressed={(draft.assignees ?? []).includes(member.id)}
                      onClick={() => toggleAssignee(member.id)}
                    >
                      {member.fullName}
                    </button>
                  ))}
                </div>
              )}
              <small className="muted">
                {!asignacionesOk
                  ? "Falta aplicar la migración de responsables en la base de datos."
                  : canAssign
                    ? `Puedes marcar varios. Los que añadas recibirán un aviso por correo.${editingId ? "" : " Si no marcas a nadie y su campaña tiene comerciales, se le asignan esos."}`
                    : "Quién lleva el lead lo decide administración."}
              </small>
            </div>
            <label className="form-field-wide"><span>Observaciones</span><textarea rows={4} value={draft.notes ?? ""} readOnly={!canEdit} onChange={(event) => updateDraft("notes", event.target.value)} /></label>
          </div>
          {editingLead ? (
            <div className="history-panel lead-record">
              <h3>Registro <small>Se apunta solo y no se puede modificar</small></h3>
              <ol className="lead-record-list">
                {recordOf(editingLead).map((entry) => <li key={entry.id} className={`lead-record-${entry.kind}`}><span>{formatDateTime(entry.at)}</span><p>{entry.text}</p></li>)}
              </ol>
            </div>
          ) : null}
          <div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setEditorOpen(false)}>Cerrar</button>{canEdit ? <button type="submit" className="button button-primary" disabled={busy}>{busy ? "Guardando…" : "Guardar lead"}</button> : null}</div>
        </form>
      </Modal>
    </div>
  );
}
