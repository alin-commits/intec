"use client";

import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { DateField } from "@/components/ui/date-field";
import { CollapsibleFilters } from "@/components/ui/collapsible-filters";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Modal } from "@/components/ui/modal";
import { Toast } from "@/components/ui/toast";
import { ReportExportButtons } from "@/components/ui/report-export-buttons";
import { KpiCard } from "@/components/kpi-card";
import { CampanasIcon, ConversionIcon, EuroIcon, LeadsIcon } from "@/components/icons";
import { CAMPAIGNS_ROLES, hasAnyRole, campaignStatusLabels } from "@/lib/constants";
import { downloadCsvReport, type CsvSummaryItem } from "@/lib/csv-export";
import { businessUnits as demoBusinessUnits, campaigns as demoCampaigns, demoLeads } from "@/lib/demo-data";
import { currencyFormatter, numberFormatter, formatDate, formatPercent } from "@/lib/format";
import { PARTIAL_LOAD_MESSAGE, reportSafeError } from "@/lib/errors";
import { exportCampaignReportPdf, type CampaignReportRow } from "@/lib/campaign-report-pdf";
import { dateKeyInMadrid } from "@/lib/dates";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { writeRows } from "@/lib/supabase/write";
import { loadAdsSpendByMonth } from "@/lib/ads/spend-by-month";
import type { AdsPlatform } from "@/lib/ads/platforms";
import { fetchAllPages } from "@/lib/supabase/fetch-all";
import type { AppRole, BusinessUnit, Campaign, CampaignStatus, LeadStatus } from "@/lib/types";
import { PageLoadFailed, PageLoader } from "@/components/ui/page-loader";

const STORAGE_KEY = "intec-demo-campaigns";

type CampaignDraft = Omit<Campaign, "id" | "createdAt">;
type LeadStub = { campaignId: string | null; status: LeadStatus; saleValue: number | null; assigned?: boolean };
type TeamMember = { id: string; fullName: string; roles: AppRole[] };

const CLOSED_STATUSES: LeadStatus[] = ["won", "lost", "invalid"];

/** La fecha de una campaña para ordenarlas: su inicio o, si no tiene, el día en que se creó. */
function campaignDate(campaign: Campaign): string {
  return campaign.startDate ?? dateKeyInMadrid(campaign.createdAt);
}

/** Los leads abiertos de la campaña que no lleva nadie: los que se pueden repartir de golpe. */
function backlogOf(campaignId: string, leads: LeadStub[]): number {
  return leads.filter((lead) => lead.campaignId === campaignId && !lead.assigned && !CLOSED_STATUSES.includes(lead.status)).length;
}
type AdsStub = { platform: AdsPlatform; campaignId: string | null; amountSpent: number; revenue: number; leads: number };

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
    leadsAssignMode: "todos",
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
    leadsAssignMode: row.leads_assign_mode === "turnos" ? "turnos" : "todos",
    createdAt: String(row.created_at),
    updatedAt: row.updated_at ? String(row.updated_at) : undefined,
  };
}

function mapLeadStub(row: Record<string, unknown>, assigned: Set<string>): LeadStub {
  return {
    assigned: assigned.has(String(row.id)),
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
  const leads = rows.reduce((sum, ad) => sum + ad.leads, 0);
  return { count: rows.length, spend, revenue, leads, roas: spend > 0 ? revenue / spend : 0 };
}

const NOTIFIED_STATUSES: CampaignStatus[] = ["active", "finished", "archived"];

/** Emails commercials + dirección about the new status. A failure must not block saving. */
function notifyCampaignStatus(campaignId: string) {
  void fetch("/api/campaigns/notify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ campaignId }),
  }).catch((cause) => console.error("No se pudo enviar el aviso de campaña:", cause));
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
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CampaignDraft>(() => blankDraft(demoBusinessUnits));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [canEdit, setCanEdit] = useState(true);
  const [pendingArchive, setPendingArchive] = useState<Campaign | null>(null);
  const [access, setAccess] = useState<"checking" | "allowed" | "denied">(configured ? "checking" : "allowed");
  /** La primera carga falló: en vez de girar para siempre se dice y se puede reintentar. */
  const [loadFailed, setLoadFailed] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [team, setTeam] = useState<TeamMember[]>([]);
  /** Los comerciales de cada campaña, a quienes van sus leads solos. */
  const [assigneesOf, setAssigneesOf] = useState<Map<string, string[]>>(() => new Map());
  const [draftAssignees, setDraftAssignees] = useState<string[]>([]);
  const [pendingBacklog, setPendingBacklog] = useState<Campaign | null>(null);
  const [sort, setSort] = useState<"recent" | "oldest">("recent");

  useEffect(() => {
    if (!configured) return;
    loadRealData().catch((cause: unknown) => {
      setMessage(reportSafeError(cause, "No se pudieron cargar los datos."));
      setLoadFailed(true);
    });
  }, [configured]);

  function firstLoad() {
    setLoadFailed(false);
    loadRealData().catch((cause: unknown) => {
      setMessage(reportSafeError(cause, "No se pudieron cargar los datos."));
      setLoadFailed(true);
    });
  }

  async function loadRealData() {
    const supabase = createClient();
    const [{ data: unitData, error: unitError }, { data: campaignData, error: campaignError }, { data: leadData, error: leadError }, { rows: adsRows, error: adsError }, { data: authData }, { data: campaignAssignees }, { data: leadAssignees }] = await Promise.all([
      supabase.from("business_units").select("id, name, slug, brand_color, logo_url, is_active, sort_order, visible_in_consultas, visible_in_leads").order("sort_order"),
      supabase.from("campaigns").select("id, business_unit_id, name, channel, start_date, end_date, status, budget, notes, direct_sales_count, direct_sale_value, leads_assign_mode, created_at, updated_at").order("created_at", { ascending: false }),
      fetchAllPages((from, to) => supabase.from("leads").select("id, campaign_id, status, sale_value").order("id").range(from, to)),
      // El gasto no sale de lo que alguien escribió a mano: lo trae la capa
      // común de publicidad, que cruza cada campaña con la de su plataforma.
      loadAdsSpendByMonth(supabase),
      supabase.auth.getUser(),
      supabase.from("campaign_assignees").select("campaign_id, profile_id").order("added_at"),
      // Solo para saber qué leads no lleva nadie (los que se pueden repartir).
      fetchAllPages<{ lead_id: string }>((from, to) => supabase.from("lead_assignees").select("lead_id").order("lead_id").order("profile_id").range(from, to)),
    ]);

    if (unitError || campaignError || leadError) {
      setMessage(reportSafeError(unitError ?? campaignError ?? leadError, "No se pudieron cargar las campañas."));
      setLoadFailed(true);
      return;
    }
    setUnits((unitData ?? []).map((row) => ({ id: row.id, name: row.name, slug: row.slug, accent: row.brand_color || "#2563eb", active: row.is_active, logo: row.logo_url, sortOrder: row.sort_order ?? 0, visibleInConsultas: row.visible_in_consultas ?? true, visibleInLeads: row.visible_in_leads ?? true })));
    setCampaigns((campaignData ?? []).map((row) => mapCampaignRow(row as Record<string, unknown>)));
    const assignedLeads = new Set((leadAssignees ?? []).map((row) => row.lead_id));
    setLeads((leadData ?? []).map((row) => mapLeadStub(row as Record<string, unknown>, assignedLeads)));
    const byCampaign = new Map<string, string[]>();
    for (const row of campaignAssignees ?? []) byCampaign.set(row.campaign_id as string, [...(byCampaign.get(row.campaign_id as string) ?? []), row.profile_id as string]);
    setAssigneesOf(byCampaign);
    if (adsError) setMessage(PARTIAL_LOAD_MESSAGE);
    // Una fila por campaña de la aplicación y plataforma: los totales suman
    // todas, y el desglose por plataforma sigue estando si hace falta.
    const porCampana = new Map<string, AdsStub>();
    for (const fila of adsRows) {
      if (!fila.campaignId) continue;
      const clave = `${fila.platform}|${fila.campaignId}`;
      const actual = porCampana.get(clave) ?? { platform: fila.platform, campaignId: fila.campaignId, amountSpent: 0, revenue: 0, leads: 0 };
      actual.amountSpent += fila.amountSpent;
      actual.leads += fila.leads;
      actual.revenue += fila.revenue;
      porCampana.set(clave, actual);
    }
    setAds([...porCampana.values()]);
    const user = authData.user;
    if (user) {
      const [{ data: profile }, { data: teamData }] = await Promise.all([
        supabase.from("profiles").select("roles").eq("id", user.id).maybeSingle(),
        supabase.rpc("list_team_members"),
      ]);
      setTeam(((teamData ?? []) as { id: string; full_name: string | null; roles: AppRole[] }[]).map((row) => ({ id: row.id, fullName: row.full_name || "Usuario", roles: row.roles })));
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
    const runsFrom = campaign.startDate ?? campaign.endDate ?? dateKeyInMadrid(campaign.createdAt);
    const runsTo = campaign.endDate ?? "9999-12-31";
    const matchesFrom = !dateFrom || runsTo >= dateFrom;
    const matchesTo = !dateTo || runsFrom <= dateTo;
    return matchesQuery && (unitId === "all" || campaign.businessUnitId === unitId) && (status === "all" || campaign.status === status) && matchesFrom && matchesTo;
  }).sort((a, b) => {
    // Por cuándo empezó; la que no tiene fecha de inicio, por cuándo se creó.
    const byDate = campaignDate(a).localeCompare(campaignDate(b)) || a.createdAt.localeCompare(b.createdAt);
    return sort === "recent" ? -byDate : byDate;
  }), [campaigns, query, status, unitId, dateFrom, dateTo, sort]);

  const campaignSummary = useMemo(() => {
    const stats = visibleCampaigns.map((campaign) => statsFor(campaign, leads));
    const leadsTotal = stats.reduce((sum, item) => sum + item.total, 0);
    const won = stats.reduce((sum, item) => sum + item.won, 0);
    return {
      active: visibleCampaigns.filter((campaign) => campaign.status === "active").length,
      leads: leadsTotal,
      won,
      value: stats.reduce((sum, item) => sum + item.value, 0),
      spend: visibleCampaigns.reduce((sum, campaign) => sum + adsStatsFor(campaign, ads).spend, 0),
    };
  }, [visibleCampaigns, leads, ads]);

  const memberName = (id: string) => team.find((member) => member.id === id)?.fullName ?? "Usuario inactivo";
  // Los leads solo los llevan comerciales; si alguien dejó de serlo sigue saliendo para poder quitarlo.
  const assignOptions = team.filter((member) => member.roles.includes("commercial") || draftAssignees.includes(member.id));

  function openNew() {
    setEditingId(null);
    setDraft(blankDraft(units));
    setDraftAssignees([]);
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
      leadsAssignMode: campaign.leadsAssignMode ?? "todos",
    });
    setDraftAssignees(assigneesOf.get(campaign.id) ?? []);
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
          leads_assign_mode: draft.leadsAssignMode ?? "todos",
        };
        const supabase = createClient();
        const previousStatus = editingId ? campaigns.find((campaign) => campaign.id === editingId)?.status ?? null : null;
        let savedId = editingId;
        if (editingId) {
          await writeRows(
            supabase.from("campaigns").update(payload).eq("id", editingId),
            "No se pudo guardar la campaña: puede que alguien la haya borrado o que tu rol no permita cambiarla.",
          );
        } else {
          const { data, error } = await supabase.from("campaigns").insert(payload).select("id").single();
          if (error) throw error;
          savedId = data.id;
        }
        // Sus comerciales: se quitan los desmarcados y se añaden los nuevos.
        if (savedId) {
          const before = assigneesOf.get(savedId) ?? [];
          const removed = before.filter((id) => !draftAssignees.includes(id));
          const added = draftAssignees.filter((id) => !before.includes(id));
          if (removed.length) {
            const { error } = await supabase.from("campaign_assignees").delete().eq("campaign_id", savedId).in("profile_id", removed);
            if (error) throw error;
          }
          if (added.length) {
            const { error } = await supabase.from("campaign_assignees").insert(added.map((profileId) => ({ campaign_id: savedId, profile_id: profileId })));
            if (error) throw error;
          }
        }
        if (savedId && draft.status !== previousStatus && NOTIFIED_STATUSES.includes(draft.status)) notifyCampaignStatus(savedId);
        await loadRealData();
        const pending = savedId && draftAssignees.length ? backlogOf(savedId, leads) : 0;
        setMessage(`${editingId ? "Campaña actualizada correctamente." : "Campaña creada correctamente."}${pending ? ` Tiene ${pending === 1 ? "1 lead abierto" : `${pending} leads abiertos`} sin responsable: puedes repartirlos desde su tarjeta.` : ""}`);
      }
      setEditorOpen(false);
    } catch (cause) {
      setMessage(reportSafeError(cause, "No se pudo guardar la campaña. Comprueba que no exista ya una con ese nombre en esta unidad."));
    } finally {
      setBusy(false);
    }
  }

  function toggleDraftAssignee(id: string) {
    setDraftAssignees((current) => current.includes(id) ? current.filter((other) => other !== id) : [...current, id]);
  }

  /** Reparte de golpe los leads abiertos sin responsable de la campaña, con su forma de repartir. */
  async function confirmBacklog() {
    if (!pendingBacklog) return;
    setBusy(true);
    try {
      const { data, error } = await createClient().rpc("assign_campaign_backlog", { p_campaign: pendingBacklog.id });
      if (error) throw error;
      const rows = (data ?? []) as { lead_id: string; profile_ids: string[] }[];
      const perPerson = new Map<string, number>();
      for (const row of rows) for (const id of row.profile_ids) perPerson.set(id, (perPerson.get(id) ?? 0) + 1);
      const detail = [...perPerson].map(([id, count]) => `${memberName(id)} ${count}`).join(" · ");
      await loadRealData();
      setMessage(rows.length
        ? `${rows.length === 1 ? "Repartido 1 lead" : `Repartidos ${rows.length} leads`} de "${pendingBacklog.name}": ${detail}. Los verán en Leads, en "Mis leads"; por estos no se manda correo.`
        : "No había leads que repartir.");
      setPendingBacklog(null);
    } catch (cause) {
      setMessage(reportSafeError(cause, "No se pudieron repartir los leads."));
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
        await writeRows(
          createClient().from("campaigns").update({ status: "archived" }).eq("id", pendingArchive.id),
          "No se pudo archivar la campaña: puede que alguien la haya borrado o que tu rol no permita cambiarla.",
        );
        if (pendingArchive.status !== "archived") notifyCampaignStatus(pendingArchive.id);
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

  function exportReportCsv() {
    const stats = visibleCampaigns.map((campaign) => statsFor(campaign, leads));
    const adsStats = visibleCampaigns.map((campaign) => adsStatsFor(campaign, ads));
    const summary: CsvSummaryItem[] = [
      { label: "Campañas", value: visibleCampaigns.length },
      { label: "Leads totales", value: stats.reduce((sum, item) => sum + item.total, 0) },
      { label: "Ganados", value: stats.reduce((sum, item) => sum + item.won, 0) },
      { label: "Valor total (€)", value: stats.reduce((sum, item) => sum + item.value, 0) },
      { label: "Gasto en Ads (€)", value: adsStats.reduce((sum, item) => sum + item.spend, 0) },
      { label: "Ingresos de Ads (€)", value: adsStats.reduce((sum, item) => sum + item.revenue, 0) },
    ];
    downloadCsvReport(`informe_campanas_${new Date().toISOString().slice(0, 10)}.csv`, summary, visibleCampaigns, [
      { header: "Unidad", value: (campaign) => units.find((unit) => unit.id === campaign.businessUnitId)?.name ?? "" },
      { header: "Nombre", value: (campaign) => campaign.name },
      { header: "Canal", value: (campaign) => campaign.channel ?? "" },
      { header: "Estado", value: (campaign) => campaignStatusLabels[campaign.status] },
      { header: "Fecha inicio", value: (campaign) => campaign.startDate ? formatDate(campaign.startDate) : "" },
      { header: "Fecha fin", value: (campaign) => campaign.endDate ? formatDate(campaign.endDate) : "" },
      { header: "Presupuesto (€)", value: (campaign) => campaign.budget ?? "" },
      { header: "Leads", value: (campaign) => statsFor(campaign, leads).total },
      { header: "Ganados", value: (campaign) => statsFor(campaign, leads).won },
      { header: "Conversión (%)", value: (campaign) => statsFor(campaign, leads).conversion.toFixed(1).replace(".", ",") },
      { header: "Valor total (€)", value: (campaign) => statsFor(campaign, leads).value },
      { header: "Gasto en Ads (€)", value: (campaign) => adsStatsFor(campaign, ads).spend },
      { header: "Ingresos de Ads (€)", value: (campaign) => adsStatsFor(campaign, ads).revenue },
    ]);
  }

  async function exportReportPdf() {
    setPdfBusy(true);
    try {
      const rows: CampaignReportRow[] = visibleCampaigns.map((campaign) => {
        const stats = statsFor(campaign, leads);
        const adsStats = adsStatsFor(campaign, ads);
        return {
          unitName: units.find((unit) => unit.id === campaign.businessUnitId)?.name ?? "—",
          name: campaign.name,
          channel: campaign.channel,
          status: campaign.status,
          startDate: campaign.startDate,
          endDate: campaign.endDate,
          budget: campaign.budget,
          leadsTotal: stats.total,
          leadsWon: stats.won,
          conversion: stats.conversion,
          value: stats.value,
          adsSpend: adsStats.spend,
          adsRevenue: adsStats.revenue,
        };
      });
      await exportCampaignReportPdf({
        totalLeads: rows.reduce((sum, row) => sum + row.leadsTotal, 0),
        totalWon: rows.reduce((sum, row) => sum + row.leadsWon, 0),
        totalValue: rows.reduce((sum, row) => sum + row.value, 0),
        totalAdsSpend: rows.reduce((sum, row) => sum + row.adsSpend, 0),
        totalAdsRevenue: rows.reduce((sum, row) => sum + row.adsRevenue, 0),
        rows,
      });
    } catch (cause) {
      setMessage(reportSafeError(cause, "No se pudo generar el PDF."));
    } finally {
      setPdfBusy(false);
    }
  }

  if (access === "checking") return loadFailed ? <PageLoadFailed message={message} onRetry={firstLoad} /> : <PageLoader label="Cargando las campañas…" />;

  if (access === "denied") {
    return (
      <div className="page-stack">
        <section className="panel panel-padded">
          <h2>No tienes permiso para ver esta página</h2>
          <p>Campañas no está disponible para tu rol.</p>
        </section>
      </div>
    );
  }

  return (
    <div className="page-stack">
      <section className="section-heading">
        <div><p>Crea campañas, sigue sus leads y su conversión, y archívalas cuando terminen (nunca se eliminan).</p></div>
        <div className="panel-heading-trailing">
          <ReportExportButtons onExportCsv={exportReportCsv} onExportPdf={() => void exportReportPdf()} pdfBusy={pdfBusy} />
          {canEdit ? <button className="button button-primary" onClick={openNew}>+ Nueva campaña</button> : null}
        </div>
      </section>

      {!canEdit ? <div className="notice"><strong>Cuenta de solo lectura</strong><span>Puedes consultar las campañas, pero no crear ni editar registros.</span></div> : null}

      <Toast message={message} onDismiss={() => setMessage(null)} />

      <CollapsibleFilters
        hasActiveFilters={query !== "" || unitId !== "all" || status !== "all" || dateFrom !== "" || dateTo !== ""}
        onClear={() => { setQuery(""); setUnitId("all"); setStatus("all"); setDateFrom(""); setDateTo(""); }}
        resultCount={visibleCampaigns.length}
        resultLabel="Campañas"
        barEnd={
          <label className="filters-sort"><span>Ordenar</span><select value={sort} onChange={(event: ChangeEvent<HTMLSelectElement>) => setSort(event.target.value === "oldest" ? "oldest" : "recent")}>
            <option value="recent">Más recientes primero</option>
            <option value="oldest">Más antiguas primero</option>
          </select></label>
        }
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
          <label><span>Desde</span><DateField value={dateFrom} onChange={(value) => setDateFrom(value)} /></label>
          <label><span>Hasta</span><DateField value={dateTo} onChange={(value) => setDateTo(value)} /></label>
        </div>
      </CollapsibleFilters>

      <section className="kpi-grid">
        <KpiCard label="Campañas activas" value={String(campaignSummary.active)} delta="Sin comparación" helper={`de ${visibleCampaigns.length} según los filtros`} icon={<CampanasIcon />} tone="indigo" />
        <KpiCard label="Leads generados" value={String(campaignSummary.leads)} delta="Sin comparación" helper="asociados a estas campañas" icon={<LeadsIcon />} tone="sky" />
        <KpiCard label="Ventas ganadas" value={String(campaignSummary.won)} delta="Sin comparación" helper="leads ganados + ventas directas" icon={<ConversionIcon />} tone="emerald" />
        <KpiCard label="Valor total" value={currencyFormatter.format(campaignSummary.value)} delta="Sin comparación" helper={campaignSummary.spend > 0 ? `${currencyFormatter.format(campaignSummary.spend)} invertidos en publicidad` : "sin gasto en publicidad"} icon={<EuroIcon />} tone="amber" />
      </section>

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
                <p className="muted campaign-direct-sales-note">Publicidad: gasto {currencyFormatter.format(adsStats.spend)} · {numberFormatter.format(adsStats.leads)} lead{adsStats.leads === 1 ? "" : "s"} · ingresos {currencyFormatter.format(adsStats.revenue)} · ROAS {adsStats.roas.toFixed(2).replace(".", ",")}x</p>
              ) : null}
              {(assigneesOf.get(campaign.id) ?? []).length ? (
                <p className="muted campaign-direct-sales-note">
                  Sus leads van solos a {(assigneesOf.get(campaign.id) ?? []).map(memberName).join(", ")}{(assigneesOf.get(campaign.id) ?? []).length > 1 ? (campaign.leadsAssignMode === "turnos" ? " (por turnos)" : " (a todos)") : ""}.
                </p>
              ) : null}
              {canEdit ? (
                <div className="modal-actions campaign-card-actions">
                  {(assigneesOf.get(campaign.id) ?? []).length && backlogOf(campaign.id, leads) > 0 ? (
                    <button type="button" className="button button-compact button-primary" onClick={() => setPendingBacklog(campaign)}>
                      Repartir {backlogOf(campaign.id, leads)} sin responsable
                    </button>
                  ) : null}
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

      <ConfirmationDialog
        open={Boolean(pendingBacklog)}
        title="¿Repartir los leads sin responsable?"
        confirmLabel="Repartir"
        busy={busy}
        onCancel={() => setPendingBacklog(null)}
        onConfirm={() => void confirmBacklog()}
      >
        {pendingBacklog ? (
          <div className="confirmation-summary">
            <span>Campaña</span><strong>{pendingBacklog.name}</strong>
            <span>Leads</span><strong>{backlogOf(pendingBacklog.id, leads)} abiertos que no lleva nadie</strong>
            <span>Para</span><strong>{(assigneesOf.get(pendingBacklog.id) ?? []).map(memberName).join(", ")}{(assigneesOf.get(pendingBacklog.id) ?? []).length > 1 ? (pendingBacklog.leadsAssignMode === "turnos" ? ", por turnos" : ", cada lead a todos") : ""}</strong>
          </div>
        ) : null}
      </ConfirmationDialog>

      <Modal open={editorOpen} title={editingId ? "Editar campaña" : "Nueva campaña"} eyebrow="Gestión de captación" scrollInside onClose={() => setEditorOpen(false)}>
        <form className="lead-editor-form" onSubmit={saveCampaign}>
          <div className="form-grid">
            <label><span>Unidad de negocio *</span><select value={draft.businessUnitId} disabled={!canEdit} onChange={(event) => updateDraft("businessUnitId", event.target.value)}>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>
            <label><span>Nombre *</span><input value={draft.name} readOnly={!canEdit} onChange={(event) => updateDraft("name", event.target.value)} /></label>
            <label><span>Canal</span><input value={draft.channel ?? ""} readOnly={!canEdit} onChange={(event) => updateDraft("channel", event.target.value)} placeholder="Email, Web, RRSS…" /></label>
            <label><span>Estado</span><select value={draft.status} disabled={!canEdit} onChange={(event) => updateDraft("status", event.target.value as CampaignStatus)}>{Object.entries(campaignStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label><span>Fecha inicio</span><DateField value={draft.startDate ?? ""} readOnly={!canEdit} onChange={(value) => updateDraft("startDate", value || null)} /></label>
            <label><span>Fecha fin</span><DateField value={draft.endDate ?? ""} readOnly={!canEdit} onChange={(value) => updateDraft("endDate", value || null)} /></label>
            <label><span>Presupuesto</span><input type="number" min="0" step="0.01" value={draft.budget ?? ""} readOnly={!canEdit} onChange={(event) => updateDraft("budget", event.target.value ? Number(event.target.value) : null)} /></label>
            <label><span>Ventas directas (sin lead)</span><input type="number" min="0" step="1" value={draft.directSalesCount} readOnly={!canEdit} onChange={(event) => updateDraft("directSalesCount", Number(event.target.value) || 0)} /></label>
            <label><span>Valor de ventas directas</span><input type="number" min="0" step="0.01" value={draft.directSaleValue} readOnly={!canEdit} onChange={(event) => updateDraft("directSaleValue", Number(event.target.value) || 0)} /></label>
            <div className="form-field-wide owner-picker">
              <span>Comerciales de sus leads</span>
              {assignOptions.length === 0 ? <p className="muted">No hay comerciales activos.</p> : (
                <div className="role-chip-group">
                  {assignOptions.map((member) => (
                    <button
                      key={member.id}
                      type="button"
                      className={draftAssignees.includes(member.id) ? "role-chip active" : "role-chip"}
                      disabled={!canEdit}
                      aria-pressed={draftAssignees.includes(member.id)}
                      onClick={() => toggleDraftAssignee(member.id)}
                    >
                      {member.fullName}
                    </button>
                  ))}
                </div>
              )}
              <small className="muted">
                {draftAssignees.length === 0
                  ? "Sin ninguno, los leads que entren de esta campaña se quedan sin responsable y avisan a administración."
                  : "Los leads que entren de esta campaña (los de Meta, solos) se les asignan y les llega el aviso por correo. Queda apuntado en el registro del lead."}
              </small>
            </div>
            {draftAssignees.length > 1 ? (
              <label className="form-field-wide">
                <span>Cómo se reparten</span>
                <select value={draft.leadsAssignMode ?? "todos"} disabled={!canEdit} onChange={(event) => updateDraft("leadsAssignMode", event.target.value === "turnos" ? "turnos" : "todos")}>
                  <option value="todos">Cada lead, a todos ellos</option>
                  <option value="turnos">Por turnos: cada lead a uno, al que menos lleve de esta campaña</option>
                </select>
              </label>
            ) : null}
            <label className="form-field-wide"><span>Notas</span><textarea rows={4} value={draft.notes ?? ""} readOnly={!canEdit} onChange={(event) => updateDraft("notes", event.target.value)} /></label>
          </div>
          <div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setEditorOpen(false)}>Cerrar</button>{canEdit ? <button type="submit" className="button button-primary" disabled={busy}>{busy ? "Guardando…" : "Guardar campaña"}</button> : null}</div>
        </form>
      </Modal>
    </div>
  );
}
