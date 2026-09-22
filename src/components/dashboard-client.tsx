"use client";

import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { businessUnits as demoBusinessUnits, campaigns as demoCampaigns, demoCrmContacts, demoInquiries, demoLeads, monthlyStats as demoMonthlyStats } from "@/lib/demo-data";
import { CONSULTAS_ROLES, CRM_ROLES, LEADS_ROLES, campaignStatusLabels, hasAnyRole, inquiryChannelColors, inquiryChannelLabels, inquiryChannelOrder, leadStatusLabels } from "@/lib/constants";
import { dateKeyInMadrid, monthKey, monthKeyInMadrid, monthLabel, monthShortLabel, previousMonthKey, previousYearMonthKey, yearOfMonth, yearRange } from "@/lib/dates";
import { downloadCsv } from "@/lib/csv-export";
import { currencyFormatter, formatPercent, numberFormatter } from "@/lib/format";
import { PARTIAL_LOAD_MESSAGE, reportSafeError } from "@/lib/errors";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { fetchAllPages } from "@/lib/supabase/fetch-all";
import { OPEN_TICKET_STATUSES } from "@/lib/tickets/map";
import { TICKET_VIEW_ROLES } from "@/lib/tickets/constants";
import { KpiCard } from "@/components/kpi-card";
import { CollapsibleFilters } from "@/components/ui/collapsible-filters";
import { Toast } from "@/components/ui/toast";
import { TrendChart } from "@/components/charts/trend-chart";
import { DonutChart, type DonutItem } from "@/components/charts/donut-chart";
import { ClockIcon, ConsultasIcon, ConversionIcon, CrmIcon, EuroIcon, LeadsIcon, TicketsIcon } from "@/components/icons";
import type { AppRole, BusinessUnit, Campaign, CampaignStatus, InquiryType, LeadStatus, MonthlyStat } from "@/lib/types";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
const ACTIVITY_LIMIT = 7;

type ActivityKind = "inquiry" | "lead" | "ticket" | "crm";
type ActivityItem = { id: string; kind: ActivityKind; title: string; detail: string; unitId: string | null; at: string; href: string };

const LEAD_STATUS_COLORS: Record<LeadStatus, string> = {
  new: "#6366f1",
  contact_attempt: "#818cf8",
  contacted: "#0ea5e9",
  offer_sent: "#f59e0b",
  interested: "#fbbf24",
  won: "#10b981",
  lost: "#ef4444",
  invalid: "#94a3b8",
};

const relativeTime = new Intl.RelativeTimeFormat("es-ES", { numeric: "auto" });

function timeAgo(iso: string): string {
  const diffMinutes = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
  if (Math.abs(diffMinutes) < 60) return relativeTime.format(diffMinutes, "minute");
  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) return relativeTime.format(diffHours, "hour");
  return relativeTime.format(Math.round(diffHours / 24), "day");
}

function ActivityIcon({ kind }: { kind: ActivityKind }) {
  if (kind === "inquiry") return <ConsultasIcon />;
  if (kind === "lead") return <LeadsIcon />;
  if (kind === "ticket") return <TicketsIcon />;
  return <CrmIcon />;
}

type ViewMode = "month" | "year";
type CompareMode = "previous" | "current" | "previous_year" | "none";
type CampaignRow = { id: string; businessUnitId: string; name: string; status: CampaignStatus; directSalesCount: number; directSaleValue: number };
type CampaignLeadStub = { campaignId: string | null; businessUnitId: string; createdAt: string; status: LeadStatus; saleValue: number | null };
type StatusCounts = Partial<Record<LeadStatus, number>>;

function countByStatus(leads: CampaignLeadStub[]): StatusCounts {
  const counts: StatusCounts = {};
  for (const lead of leads) counts[lead.status] = (counts[lead.status] ?? 0) + 1;
  return counts;
}

type Totals = { web: number; phone: number; leads: number; won: number; saleValue: number };
type ChannelStat = { businessUnitId: string; month: string; channel: InquiryType; count: number };
type ChannelCounts = Record<InquiryType, number>;

function sumChannels(rows: ChannelStat[]): ChannelCounts {
  const counts = Object.fromEntries(inquiryChannelOrder.map((channel) => [channel, 0])) as ChannelCounts;
  for (const row of rows) counts[row.channel] += row.count;
  return counts;
}

function bucketChannels(rows: { businessUnitId: string; createdAt: string; channel: InquiryType; count: number }[]): ChannelStat[] {
  const buckets = new Map<string, ChannelStat>();
  for (const row of rows) {
    const month = monthKeyInMadrid(row.createdAt);
    const key = `${row.businessUnitId}|${month}|${row.channel}`;
    const bucket = buckets.get(key) ?? { businessUnitId: row.businessUnitId, month, channel: row.channel, count: 0 };
    bucket.count += row.count;
    buckets.set(key, bucket);
  }
  return Array.from(buckets.values());
}

const demoChannelStats = bucketChannels(demoInquiries.map((record) => ({ businessUnitId: record.businessUnitId, createdAt: record.createdAt, channel: record.inquiryType, count: record.count })));
type SocialStub = { businessUnitId: string; periodMonth: string; newFollowers: number };
type InquirySaleStub = { businessUnitId: string; month: string; value: number };
type AdsStub = { businessUnitId: string; campaignId: string | null; amountSpent: number; leads: number; revenue: number };
type MailingStub = { businessUnitId: string; sentCount: number; opens: number; deliveredCount: number; revenue: number };

function sumRows(rows: MonthlyStat[]): Totals {
  return rows.reduce((acc, row) => ({
    web: acc.web + row.web,
    phone: acc.phone + row.phone,
    leads: acc.leads + row.leads,
    won: acc.won + row.won,
    saleValue: acc.saleValue + row.saleValue,
  }), { web: 0, phone: 0, leads: 0, won: 0, saleValue: 0 });
}

function variation(current: number, previous: number): number | null {
  return previous ? ((current - previous) / previous) * 100 : null;
}

// Spread after `helper`: with nothing to compare against, the card should say
// so instead of showing a lone "frente al mes anterior".
function deltaProps(value: number | null) {
  return value === null
    ? { delta: "Sin comparación", positive: true, helper: "sin datos del periodo anterior" }
    : { delta: formatPercent(Math.abs(value)), positive: value >= 0 };
}

const compareModeHelpers: Record<CompareMode, string> = {
  previous: "frente al mes anterior",
  current: "frente al mes actual",
  previous_year: "frente al mismo mes del año anterior",
  none: "sin periodo de comparación",
};

const demoCampaignLeads: CampaignLeadStub[] = demoLeads.map((lead) => ({ campaignId: lead.campaignId ?? null, businessUnitId: lead.businessUnitId, createdAt: lead.createdAt, status: lead.status, saleValue: lead.saleValue }));

function monthKeyOf(value: string): string {
  return monthKeyInMadrid(value);
}

function campaignStatsFor(campaign: CampaignRow, leads: CampaignLeadStub[]) {
  const rows = leads.filter((lead) => lead.campaignId === campaign.id);
  const leadsWon = rows.filter((lead) => lead.status === "won").length;
  const leadsValue = rows.reduce((sum, lead) => sum + (lead.status === "won" ? lead.saleValue ?? 0 : 0), 0);
  return { total: rows.length, won: leadsWon + campaign.directSalesCount, value: leadsValue + campaign.directSaleValue };
}

function adsStatsFor(campaignId: string, ads: AdsStub[]) {
  const rows = ads.filter((ad) => ad.campaignId === campaignId);
  const spend = rows.reduce((sum, ad) => sum + ad.amountSpent, 0);
  const revenue = rows.reduce((sum, ad) => sum + ad.revenue, 0);
  return { count: rows.length, spend, roas: spend > 0 ? revenue / spend : 0 };
}

export function DashboardClient() {
  const configured = isSupabaseConfigured();
  const currentMonthKey = monthKey();
  const [businessUnitId, setBusinessUnitId] = useState("all");
  const [viewMode, setViewMode] = useState<ViewMode>("year");
  const [selectedMonth, setSelectedMonth] = useState(currentMonthKey);
  const [selectedYear, setSelectedYear] = useState(yearOfMonth(currentMonthKey));
  const [compareMode, setCompareMode] = useState<CompareMode>("previous");
  const [message, setMessage] = useState<string | null>(null);

  const [allBusinessUnits, setAllBusinessUnits] = useState<BusinessUnit[]>(demoBusinessUnits);
  const [monthlyStats, setMonthlyStats] = useState<MonthlyStat[]>(demoMonthlyStats);
  const [channelStats, setChannelStats] = useState<ChannelStat[]>(demoChannelStats);
  const [campaignRows, setCampaignRows] = useState<CampaignRow[]>(demoCampaigns.map((campaign: Campaign) => ({ id: campaign.id, businessUnitId: campaign.businessUnitId, name: campaign.name, status: campaign.status, directSalesCount: campaign.directSalesCount, directSaleValue: campaign.directSaleValue })));
  const [campaignLeads, setCampaignLeads] = useState<CampaignLeadStub[]>(demoCampaignLeads);
  const [socialStats, setSocialStats] = useState<SocialStub[]>([]);
  const [inquirySales, setInquirySales] = useState<InquirySaleStub[]>([]);
  const [adsEntries, setAdsEntries] = useState<AdsStub[]>([]);
  const [mailingRows, setMailingRows] = useState<MailingStub[]>([]);
  const [operationalRoles, setOperationalRoles] = useState<AppRole[]>(() => configured ? [] : ["admin"]);
  const [assignedUnitIds, setAssignedUnitIds] = useState<string[] | null>(null);
  const [openTicketsCount, setOpenTicketsCount] = useState<number | null>(null);
  const [staleTicketsCount, setStaleTicketsCount] = useState<number | null>(null);
  const [recentActivity, setRecentActivity] = useState<ActivityItem[]>([]);
  const [newCrmContactsCount, setNewCrmContactsCount] = useState<number | null>(() => configured ? null : demoCrmContacts.filter((contact) => Date.now() - new Date(contact.createdAt).getTime() < SEVEN_DAYS_MS).length);

  // Un comercial sin roles de supervisión (admin/viewer) solo ve sus marcas asignadas.
  const businessUnits = useMemo(
    () => allBusinessUnits.filter((unit) => unit.active && (assignedUnitIds === null || assignedUnitIds.includes(unit.id))),
    [allBusinessUnits, assignedUnitIds],
  );
  const selectedMonthYear = yearOfMonth(selectedMonth);

  useEffect(() => {
    if (!configured) return;
    const fetchFromYear = Math.min(selectedYear, selectedMonthYear) - 1;
    const fetchToYear = Math.max(selectedYear, selectedMonthYear) + 1;
    const fetchStart = yearRange(fetchFromYear).start;
    const fetchEnd = yearRange(fetchToYear).end;
    void (async () => {
      const supabase = createClient();
      const [
        { data: unitData, error: unitError },
        { data: inquiryData, error: inquiryError },
        { data: salesData, error: salesError },
        { data: leadData, error: leadError },
        { data: historyData, error: historyError },
        { data: campaignData, error: campaignError },
        { data: socialData, error: socialError },
        { data: adsData, error: adsError },
        { data: mailingData, error: mailingError },
      ] = await Promise.all([
        supabase.from("business_units").select("id, name, slug, brand_color, logo_url, is_active, sort_order, visible_in_consultas, visible_in_leads").order("sort_order"),
        fetchAllPages((from, to) => supabase.from("inquiries").select("business_unit_id, inquiry_type, created_at, count").gte("created_at", fetchStart).lt("created_at", fetchEnd).order("id").range(from, to)),
        fetchAllPages((from, to) => supabase.from("sales_entries").select("business_unit_id, occurred_on, value, entry_mode, sale_type").gte("occurred_on", dateKeyInMadrid(fetchStart)).lt("occurred_on", dateKeyInMadrid(fetchEnd)).order("id").range(from, to)),
        fetchAllPages((from, to) => supabase.from("leads").select("id, business_unit_id, campaign_id, created_at, sale_value, status").order("id").range(from, to)),
        fetchAllPages((from, to) => supabase.from("lead_status_history").select("new_status, changed_at, leads(business_unit_id, sale_value)").in("new_status", ["won", "lost"]).order("id").range(from, to)),
        supabase.from("campaigns").select("id, business_unit_id, name, status, direct_sales_count, direct_sale_value").neq("status", "archived").order("name"),
        supabase.from("social_media_stats").select("business_unit_id, period_month, new_followers"),
        supabase.from("meta_ads_entries").select("business_unit_id, campaign_id, amount_spent, leads, revenue"),
        supabase.from("mailing_campaigns").select("business_unit_id, sent_count, opens, delivered_count, revenue"),
      ]);
      if (unitError || inquiryError || salesError || leadError || historyError || campaignError) {
        setMessage(reportSafeError(unitError ?? inquiryError ?? salesError ?? leadError ?? historyError ?? campaignError, "No se pudieron cargar los datos del dashboard."));
        return;
      }

      const units: BusinessUnit[] = (unitData ?? []).map((row) => ({ id: row.id, name: row.name, slug: row.slug, accent: row.brand_color || "#2563eb", active: row.is_active, logo: row.logo_url, sortOrder: row.sort_order ?? 0, visibleInConsultas: row.visible_in_consultas ?? true, visibleInLeads: row.visible_in_leads ?? true }));
      setAllBusinessUnits(units);

      const buckets = new Map<string, MonthlyStat>();
      function bucket(unitId: string, month: string): MonthlyStat {
        const key = `${unitId}|${month}`;
        let row = buckets.get(key);
        if (!row) {
          row = { month, businessUnitId: unitId, web: 0, phone: 0, leads: 0, won: 0, lost: 0, saleValue: 0 };
          buckets.set(key, row);
        }
        return row;
      }
      for (const row of inquiryData ?? []) {
        const b = bucket(row.business_unit_id, monthKeyOf(row.created_at));
        const amount = Number(row.count ?? 1);
        if (row.inquiry_type === "phone") b.phone += amount; else b.web += amount;
      }
      // Las ventas de Consultas (sales_entries) son un embudo propio de esa página
      // (oferta/seguimiento/pedido/perdido) y no deben sumarse al "Valor ganado"
      // de Leads/Campañas, que solo cuenta leads realmente ganados. Solo los
      // "pedido" (venta confirmada) cuentan como ingreso real de Consultas.
      const inquirySaleBuckets = new Map<string, number>();
      for (const row of salesData ?? []) {
        if (row.sale_type !== "pedido") continue;
        const key = `${row.business_unit_id}|${monthKeyOf(row.occurred_on)}`;
        inquirySaleBuckets.set(key, (inquirySaleBuckets.get(key) ?? 0) + (row.value ?? 0));
      }
      setInquirySales(Array.from(inquirySaleBuckets.entries()).map(([key, value]) => {
        const [businessUnitId, month] = key.split("|");
        return { businessUnitId, month, value };
      }));
      for (const row of leadData ?? []) {
        bucket(row.business_unit_id, monthKeyOf(row.created_at)).leads += 1;
      }
      for (const row of historyData ?? []) {
        const leadInfo = row.leads as unknown as { business_unit_id: string; sale_value: number | null } | null;
        if (!leadInfo) continue;
        const b = bucket(leadInfo.business_unit_id, monthKeyOf(row.changed_at));
        if (row.new_status === "won") {
          b.won += 1;
          b.saleValue += leadInfo.sale_value ?? 0;
        } else if (row.new_status === "lost") {
          b.lost += 1;
        }
      }
      setMonthlyStats(Array.from(buckets.values()));
      setChannelStats(bucketChannels((inquiryData ?? []).map((row) => ({ businessUnitId: row.business_unit_id, createdAt: row.created_at, channel: row.inquiry_type as InquiryType, count: Number(row.count ?? 1) }))));

      setCampaignRows((campaignData ?? []).map((row) => ({ id: row.id, businessUnitId: row.business_unit_id, name: row.name, status: row.status as CampaignStatus, directSalesCount: Number(row.direct_sales_count ?? 0), directSaleValue: Number(row.direct_sale_value ?? 0) })));

      const leadStubs: CampaignLeadStub[] = (leadData ?? []).map((row) => ({ campaignId: row.campaign_id, businessUnitId: row.business_unit_id, createdAt: row.created_at, status: row.status as LeadStatus, saleValue: row.sale_value === null || row.sale_value === undefined ? null : Number(row.sale_value) }));
      setCampaignLeads(leadStubs);

      setSocialStats((socialData ?? []).map((row) => ({ businessUnitId: row.business_unit_id, periodMonth: String(row.period_month).slice(0, 7), newFollowers: Number(row.new_followers ?? 0) })));
      setAdsEntries((adsData ?? []).map((row) => ({ businessUnitId: row.business_unit_id, campaignId: row.campaign_id, amountSpent: Number(row.amount_spent ?? 0), leads: Number(row.leads ?? 0), revenue: Number(row.revenue ?? 0) })));
      if (socialError || adsError || mailingError) {
        console.error("Métricas de marketing no disponibles en el dashboard:", socialError ?? adsError ?? mailingError);
        setMessage(PARTIAL_LOAD_MESSAGE);
      }
      setMailingRows((mailingData ?? []).map((row) => ({ businessUnitId: row.business_unit_id, sentCount: Number(row.sent_count ?? 0), opens: Number(row.opens ?? 0), deliveredCount: Number(row.delivered_count ?? 0), revenue: Number(row.revenue ?? 0) })));
    })();
  }, [configured, selectedMonthYear, selectedYear]);

  useEffect(() => {
    if (!configured) return;
    void (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase.from("profiles").select("roles").eq("id", user.id).maybeSingle();
      const roles = (profile?.roles as AppRole[] | undefined) ?? [];
      setOperationalRoles(roles);

      const unitScoped = hasAnyRole(roles, ["commercial"]) && !hasAnyRole(roles, ["admin", "viewer"]);
      if (unitScoped) {
        const { data: assignments } = await supabase.from("profile_business_units").select("business_unit_id").eq("profile_id", user.id);
        setAssignedUnitIds((assignments ?? []).map((row) => String(row.business_unit_id)));
      } else {
        setAssignedUnitIds(null);
      }

      const canSeeTickets = hasAnyRole(roles, TICKET_VIEW_ROLES);
      const canSeeCrm = hasAnyRole(roles, CRM_ROLES);
      const canSeeInquiries = hasAnyRole(roles, CONSULTAS_ROLES);
      const canSeeLeads = hasAnyRole(roles, LEADS_ROLES);

      if (canSeeTickets) {
        const staleBefore = new Date(Date.now() - THREE_DAYS_MS).toISOString();
        const [{ count: openCount }, { count: staleCount }] = await Promise.all([
          supabase.from("tickets").select("id", { count: "exact", head: true }).in("status", OPEN_TICKET_STATUSES).is("archived_at", null),
          supabase.from("tickets").select("id", { count: "exact", head: true }).in("status", OPEN_TICKET_STATUSES).is("archived_at", null).lt("created_at", staleBefore),
        ]);
        setOpenTicketsCount(openCount ?? 0);
        setStaleTicketsCount(staleCount ?? 0);
      }
      if (canSeeCrm) {
        const since = new Date(Date.now() - SEVEN_DAYS_MS).toISOString();
        const { count } = await supabase.from("crm_contacts").select("id", { count: "exact", head: true }).gte("created_at", since);
        setNewCrmContactsCount(count ?? 0);
      }

      const activity = await Promise.all([
        canSeeInquiries ? supabase.from("inquiries").select("id, business_unit_id, inquiry_type, count, created_at").order("created_at", { ascending: false }).limit(ACTIVITY_LIMIT) : null,
        canSeeLeads ? supabase.from("leads").select("id, business_unit_id, contact_name, client_company_name, created_at").order("created_at", { ascending: false }).limit(ACTIVITY_LIMIT) : null,
        canSeeTickets ? supabase.from("tickets").select("id, ticket_number, title, created_at").is("archived_at", null).order("created_at", { ascending: false }).limit(ACTIVITY_LIMIT) : null,
        canSeeCrm ? supabase.from("crm_contacts").select("id, business_unit_id, full_name, company_name, created_at").order("created_at", { ascending: false }).limit(ACTIVITY_LIMIT) : null,
      ]);
      const [inquiryRes, leadRes, ticketRes, crmRes] = activity;
      if (activity.some((result) => result?.error)) setMessage(PARTIAL_LOAD_MESSAGE);
      const activityItems: ActivityItem[] = [
        ...(inquiryRes?.data ?? []).map((row) => ({
          id: `inquiry-${row.id}`,
          kind: "inquiry" as const,
          title: Number(row.count) > 1 ? `${row.count} consultas registradas` : "Nueva consulta",
          detail: inquiryChannelLabels[row.inquiry_type as InquiryType] ?? "",
          unitId: row.business_unit_id,
          at: row.created_at,
          href: "/consultas",
        })),
        ...(leadRes?.data ?? []).map((row) => ({
          id: `lead-${row.id}`,
          kind: "lead" as const,
          title: "Nuevo lead",
          detail: row.contact_name || row.client_company_name || "",
          unitId: row.business_unit_id,
          at: row.created_at,
          href: "/leads",
        })),
        ...(ticketRes?.data ?? []).map((row) => ({
          id: `ticket-${row.id}`,
          kind: "ticket" as const,
          title: `Ticket ${row.ticket_number}`,
          detail: row.title,
          unitId: null,
          at: row.created_at,
          href: `/tickets/${row.id}`,
        })),
        ...(crmRes?.data ?? []).map((row) => ({
          id: `crm-${row.id}`,
          kind: "crm" as const,
          title: "Nuevo contacto en el CRM",
          detail: row.company_name ? `${row.full_name} · ${row.company_name}` : row.full_name,
          unitId: row.business_unit_id,
          at: row.created_at,
          href: "/crm",
        })),
      ];
      setRecentActivity(activityItems.sort((a, b) => b.at.localeCompare(a.at)).slice(0, ACTIVITY_LIMIT));
    })();
  }, [configured]);

  const availableYears = useMemo(() => {
    const years = new Set(monthlyStats.map((row) => yearOfMonth(row.month)));
    years.add(yearOfMonth(currentMonthKey));
    years.add(yearOfMonth(currentMonthKey) - 1);
    return Array.from(years).sort();
  }, [currentMonthKey, monthlyStats]);

  const filtered = useMemo(
    () => monthlyStats.filter((item) => businessUnitId === "all" || item.businessUnitId === businessUnitId),
    [businessUnitId, monthlyStats],
  );

  const currentRows = useMemo(
    () => (viewMode === "month" ? filtered.filter((row) => row.month === selectedMonth) : filtered.filter((row) => yearOfMonth(row.month) === selectedYear)),
    [filtered, selectedMonth, selectedYear, viewMode],
  );

  const previousRows = useMemo(() => {
    if (viewMode === "year") return filtered.filter((row) => yearOfMonth(row.month) === selectedYear - 1);
    if (compareMode === "none") return [];
    const key = compareMode === "current" ? currentMonthKey : compareMode === "previous" ? previousMonthKey(selectedMonth) : previousYearMonthKey(selectedMonth);
    return filtered.filter((row) => row.month === key);
  }, [compareMode, currentMonthKey, filtered, selectedMonth, selectedYear, viewMode]);

  const filteredInquirySales = useMemo(
    () => inquirySales.filter((item) => businessUnitId === "all" || item.businessUnitId === businessUnitId),
    [businessUnitId, inquirySales],
  );
  const currentInquirySaleValue = useMemo(() => {
    const rows = viewMode === "month" ? filteredInquirySales.filter((row) => row.month === selectedMonth) : filteredInquirySales.filter((row) => yearOfMonth(row.month) === selectedYear);
    return rows.reduce((sum, row) => sum + row.value, 0);
  }, [filteredInquirySales, selectedMonth, selectedYear, viewMode]);

  const hasComparison = previousRows.length > 0;
  const current = sumRows(currentRows);
  const previous = sumRows(previousRows);
  const currentTotal = current.web + current.phone;
  const previousTotal = previous.web + previous.phone;
  const conversion = current.leads ? (current.won / current.leads) * 100 : 0;
  const previousConversion = previous.leads ? (previous.won / previous.leads) * 100 : null;

  const totalDelta = hasComparison ? variation(currentTotal, previousTotal) : null;
  const leadsDelta = hasComparison ? variation(current.leads, previous.leads) : null;
  const conversionDelta = hasComparison && previousConversion !== null ? conversion - previousConversion : null;
  const saleValueDelta = hasComparison ? variation(current.saleValue, previous.saleValue) : null;

  const comparisonHelper = viewMode === "year" ? `frente a ${selectedYear - 1}` : compareModeHelpers[compareMode];

  const trendYear = viewMode === "year" ? selectedYear : yearOfMonth(selectedMonth);
  const trendMonths = useMemo(
    () => Array.from({ length: 12 }, (_, index) => `${trendYear}-${String(index + 1).padStart(2, "0")}`),
    [trendYear],
  );
  const filteredChannelStats = channelStats.filter((row) => businessUnitId === "all" || row.businessUnitId === businessUnitId);
  const inPeriod = (month: string) => (viewMode === "month" ? month === selectedMonth : yearOfMonth(month) === selectedYear);
  const trendData = trendMonths.map((month) => ({ label: monthShortLabel(month), ...sumChannels(filteredChannelStats.filter((row) => row.month === month)) }));
  const periodChannelCounts = sumChannels(filteredChannelStats.filter((row) => inPeriod(row.month)));

  const rrssSocialFiltered = useMemo(() => socialStats.filter((row) => businessUnitId === "all" || row.businessUnitId === businessUnitId), [socialStats, businessUnitId]);
  const rrssAdsFiltered = useMemo(() => adsEntries.filter((row) => businessUnitId === "all" || row.businessUnitId === businessUnitId), [adsEntries, businessUnitId]);
  const rrssMailingFiltered = useMemo(() => mailingRows.filter((row) => businessUnitId === "all" || row.businessUnitId === businessUnitId), [mailingRows, businessUnitId]);

  const rrssSummary = useMemo(() => {
    const spend = rrssAdsFiltered.reduce((sum, row) => sum + row.amountSpent, 0);
    const adsLeads = rrssAdsFiltered.reduce((sum, row) => sum + row.leads, 0);
    const adsRevenue = rrssAdsFiltered.reduce((sum, row) => sum + row.revenue, 0);
    const mailingRevenue = rrssMailingFiltered.reduce((sum, row) => sum + row.revenue, 0);
    const delivered = rrssMailingFiltered.reduce((sum, row) => sum + row.deliveredCount, 0);
    const opens = rrssMailingFiltered.reduce((sum, row) => sum + row.opens, 0);
    const followersGained = rrssSocialFiltered.reduce((sum, row) => sum + row.newFollowers, 0);
    return {
      adsSpend: spend,
      adsLeads,
      revenue: adsRevenue + mailingRevenue,
      mailingSent: rrssMailingFiltered.reduce((sum, row) => sum + row.sentCount, 0),
      mailingOpenRate: delivered ? (opens / delivered) * 100 : 0,
      followersGained,
    };
  }, [rrssAdsFiltered, rrssMailingFiltered, rrssSocialFiltered]);

  const rrssTrend = useMemo(() => {
    const byMonth = new Map<string, number>();
    for (const row of rrssSocialFiltered) byMonth.set(row.periodMonth, (byMonth.get(row.periodMonth) ?? 0) + row.newFollowers);
    return Array.from(byMonth.entries()).sort(([a], [b]) => a.localeCompare(b)).slice(-6).map(([month, newFollowers]) => ({ label: monthShortLabel(month), newFollowers }));
  }, [rrssSocialFiltered]);

  const unitRows = businessUnits.map((unit) => {
    const rows = viewMode === "month"
      ? monthlyStats.filter((item) => item.month === selectedMonth && item.businessUnitId === unit.id)
      : monthlyStats.filter((item) => yearOfMonth(item.month) === selectedYear && item.businessUnitId === unit.id);
    const summed = sumRows(rows);
    const inquiryRows = viewMode === "month"
      ? inquirySales.filter((item) => item.month === selectedMonth && item.businessUnitId === unit.id)
      : inquirySales.filter((item) => yearOfMonth(item.month) === selectedYear && item.businessUnitId === unit.id);
    const inquiryValue = inquiryRows.reduce((sum, item) => sum + item.value, 0);
    const channels = sumChannels(channelStats.filter((row) => row.businessUnitId === unit.id && inPeriod(row.month)));
    return { unit, summed, channels, inquiries: summed.web + summed.phone, conversion: summed.leads ? (summed.won / summed.leads) * 100 : 0, inquiryValue };
  });

  const sparkMonths = trendMonths.filter((month) => month <= currentMonthKey);
  const monthlyTotals = sparkMonths.map((month) => sumRows(filtered.filter((row) => row.month === month)));
  const sparkInquiries = monthlyTotals.map((row) => row.web + row.phone);
  const sparkLeads = monthlyTotals.map((row) => row.leads);
  const sparkConversion = monthlyTotals.map((row) => (row.leads ? (row.won / row.leads) * 100 : 0));
  const sparkValue = monthlyTotals.map((row) => row.saleValue);

  const visibleUnitIds = new Set(businessUnits.map((unit) => unit.id));
  const unitLeads = campaignLeads.filter((lead) => (businessUnitId === "all" ? visibleUnitIds.has(lead.businessUnitId) : lead.businessUnitId === businessUnitId));
  const periodLeads = unitLeads.filter((lead) => (viewMode === "month" ? monthKeyOf(lead.createdAt) === selectedMonth : yearOfMonth(monthKeyOf(lead.createdAt)) === selectedYear));
  const periodStatusCounts = countByStatus(periodLeads);
  const unitStatusCounts = countByStatus(unitLeads);
  const leadStatusItems: DonutItem[] = (Object.keys(leadStatusLabels) as LeadStatus[]).map((status) => ({
    label: leadStatusLabels[status],
    value: periodStatusCounts[status] ?? 0,
    color: LEAD_STATUS_COLORS[status],
  }));
  const channelItems: DonutItem[] = inquiryChannelOrder.map((channel) => ({ label: inquiryChannelLabels[channel], value: periodChannelCounts[channel], color: inquiryChannelColors[channel] }));

  const canSeeLeads = hasAnyRole(operationalRoles, LEADS_ROLES);
  const canSeeTickets = hasAnyRole(operationalRoles, TICKET_VIEW_ROLES);
  const activeCampaignsCount = campaignRows.filter((campaign) => campaign.status === "active").length;
  const pendingItems = [
    canSeeLeads ? { key: "leads", label: "Leads nuevos sin contactar", value: unitStatusCounts.new ?? 0, href: "/leads", icon: <LeadsIcon />, alert: false } : null,
    canSeeTickets && openTicketsCount !== null ? { key: "tickets", label: "Tickets abiertos", value: openTicketsCount, href: "/tickets", icon: <TicketsIcon />, alert: false } : null,
    canSeeTickets && staleTicketsCount !== null ? { key: "stale", label: "Tickets abiertos hace +3 días", value: staleTicketsCount, href: "/tickets", icon: <ClockIcon />, alert: staleTicketsCount > 0 } : null,
    hasAnyRole(operationalRoles, CRM_ROLES) && newCrmContactsCount !== null ? { key: "crm", label: "Contactos CRM nuevos (7 días)", value: newCrmContactsCount, href: "/crm", icon: <CrmIcon />, alert: false } : null,
    { key: "campaigns", label: "Campañas activas", value: activeCampaignsCount, href: "/campanas", icon: <ConversionIcon />, alert: false },
  ].filter((item) => item !== null);

  const topCampaigns = [...campaignRows].sort((a, b) => Number(b.status === "active") - Number(a.status === "active")).slice(0, 5);
  const unitName = (unitId: string | null) => (unitId ? allBusinessUnits.find((unit) => unit.id === unitId)?.name ?? null : null);
  const hasRecordedData = monthlyStats.length > 0;
  const periodLabel = viewMode === "month" ? monthLabel(selectedMonth) : `el año ${selectedYear}`;

  function exportUnitComparisonCsv() {
    const periodLabel = viewMode === "month" ? selectedMonth : String(selectedYear);
    downloadCsv(`comparativa_unidades_${periodLabel}.csv`, unitRows, [
      { header: "Unidad", value: (row) => row.unit.name },
      ...inquiryChannelOrder.map((channel) => ({ header: inquiryChannelLabels[channel], value: (row: (typeof unitRows)[number]) => row.channels[channel] })),
      { header: "Total", value: (row) => row.inquiries },
      { header: "Leads", value: (row) => row.summed.leads },
      { header: "Ganados", value: (row) => row.summed.won },
      { header: "Conversión (%)", value: (row) => row.conversion.toFixed(1).replace(".", ",") },
      { header: "Valor (€)", value: (row) => row.summed.saleValue },
      { header: "Valor de venta Consultas (€)", value: (row) => row.inquiryValue },
    ]);
  }

  return (
    <div className="page-stack">
      <Toast message={message} onDismiss={() => setMessage(null)} />
      <CollapsibleFilters
        hasActiveFilters={businessUnitId !== "all" || viewMode !== "year" || compareMode !== "previous"}
        onClear={() => { setBusinessUnitId("all"); setViewMode("year"); setSelectedYear(yearOfMonth(currentMonthKey)); setCompareMode("previous"); }}
      >
        <div className="filter-bar">
          <label>
            <span>Unidad de negocio</span>
            <select value={businessUnitId} onChange={(event: ChangeEvent<HTMLSelectElement>) => setBusinessUnitId(event.target.value)}>
              <option value="all">Todas las unidades</option>
              {businessUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
            </select>
          </label>
          <label>
            <span>Vista</span>
            <select value={viewMode} onChange={(event: ChangeEvent<HTMLSelectElement>) => setViewMode(event.target.value as ViewMode)}>
              <option value="month">Mensual</option>
              <option value="year">Anual</option>
            </select>
          </label>
          {viewMode === "month" ? (
            <label>
              <span>Mes</span>
              <input type="month" value={selectedMonth} max={currentMonthKey} onChange={(event: ChangeEvent<HTMLInputElement>) => setSelectedMonth(event.target.value)} />
            </label>
          ) : (
            <label>
              <span>Año</span>
              <select value={selectedYear} onChange={(event: ChangeEvent<HTMLSelectElement>) => setSelectedYear(Number(event.target.value))}>
                {availableYears.map((year) => <option key={year} value={year}>{year}</option>)}
              </select>
            </label>
          )}
          {viewMode === "month" ? (
            <label>
              <span>Comparar con</span>
              <select value={compareMode} onChange={(event: ChangeEvent<HTMLSelectElement>) => setCompareMode(event.target.value as CompareMode)}>
                <option value="previous">Mes anterior</option>
                <option value="current">Mes actual</option>
                <option value="previous_year">Mismo mes del año anterior</option>
                <option value="none">Sin comparación</option>
              </select>
            </label>
          ) : (
            <div className="filter-summary"><span>Comparando con</span><strong>Año {selectedYear - 1}</strong></div>
          )}
        </div>
      </CollapsibleFilters>

      {!hasRecordedData ? (
        <section className="panel dashboard-empty-notice">
          <div>
            <strong>Todavía no hay consultas ni leads registrados</strong>
            <p>Las cifras de este resumen se rellenan solas en cuanto se registre la primera consulta o el primer lead.</p>
          </div>
          <div className="dashboard-empty-actions">
            <a href="/consultas" className="button button-primary">Registrar consulta</a>
            <a href="/leads" className="button button-secondary">Ir a leads</a>
          </div>
        </section>
      ) : null}

      <section className="kpi-grid kpi-grid-main">
        <KpiCard label="Consultas" value={numberFormatter.format(currentTotal)} helper={comparisonHelper} icon={<ConsultasIcon />} tone="indigo" sparkline={sparkInquiries} {...deltaProps(totalDelta)} />
        <KpiCard label="Leads" value={numberFormatter.format(current.leads)} helper={comparisonHelper} icon={<LeadsIcon />} tone="sky" sparkline={sparkLeads} {...deltaProps(leadsDelta)} />
        <KpiCard
          label="Conversión"
          value={formatPercent(conversion)}
          delta={conversionDelta === null ? "Sin comparación" : `${conversionDelta >= 0 ? "+" : ""}${conversionDelta.toFixed(1).replace(".", ",")} pts`}
          positive={conversionDelta === null || conversionDelta >= 0}
          helper={`${numberFormatter.format(current.won)} ganados`}
          icon={<ConversionIcon />}
          tone="emerald"
          sparkline={sparkConversion}
        />
        <KpiCard label="Valor ganado" value={currencyFormatter.format(current.saleValue)} helper={comparisonHelper} icon={<EuroIcon />} tone="amber" sparkline={sparkValue} {...deltaProps(saleValueDelta)} />
      </section>

      <section className="dashboard-grid">
        <article className="panel chart-panel">
          <div className="panel-heading">
            <div><h2>Evolución de consultas</h2><p className="panel-subtitle">Por canal · año {trendYear}</p></div>
            <a href="/consultas" className="text-link">Ver consultas →</a>
          </div>
          <TrendChart
            data={trendData}
            series={inquiryChannelOrder.map((channel) => ({ key: channel, label: inquiryChannelLabels[channel], color: inquiryChannelColors[channel] }))}
            ariaLabel="Evolución de consultas por canal"
          />
        </article>
        <article className="panel chart-panel">
          <div className="panel-heading">
            <div><h2>Leads por estado</h2><p className="panel-subtitle">Creados en {periodLabel}</p></div>
            <a href="/leads" className="text-link">Ver leads →</a>
          </div>
          <DonutChart items={leadStatusItems} centerLabel="leads" ariaLabel="Distribución de leads por estado" emptyMessage="Sin leads en este periodo." />
        </article>
      </section>

      <section className="dashboard-grid-3">
        <article className="panel chart-panel">
          <div className="panel-heading"><div><h2>Actividad reciente</h2><p className="panel-subtitle">Lo último registrado en la plataforma</p></div></div>
          {recentActivity.length === 0 ? (
            <p className="muted">Todavía no hay actividad registrada.</p>
          ) : (
            <ul className="activity-list">
              {recentActivity.map((item) => {
                const unit = unitName(item.unitId);
                return (
                  <li key={item.id}>
                    <a href={item.href}>
                      <span className={`activity-icon activity-${item.kind}`}><ActivityIcon kind={item.kind} /></span>
                      <span className="activity-text">
                        <strong>{item.title}</strong>
                        <small>{[item.detail, unit].filter(Boolean).join(" · ")}</small>
                      </span>
                      <time dateTime={item.at}>{timeAgo(item.at)}</time>
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </article>

        <article className="panel chart-panel">
          <div className="panel-heading"><div><h2>Pendientes</h2><p className="panel-subtitle">Lo que requiere atención</p></div></div>
          <ul className="pending-list">
            {pendingItems.map((item) => (
              <li key={item.key} className={item.alert ? "pending-alert" : undefined}>
                <a href={item.href}>
                  <span className="pending-icon">{item.icon}</span>
                  <span className="pending-label">{item.label}</span>
                  <strong>{numberFormatter.format(item.value)}</strong>
                </a>
              </li>
            ))}
          </ul>
        </article>

        <article className="panel chart-panel">
          <div className="panel-heading"><div><h2>Consultas por canal</h2><p className="panel-subtitle">En {periodLabel}</p></div></div>
          <DonutChart items={channelItems} centerLabel="consultas" ariaLabel="Consultas del periodo por canal" emptyMessage="Sin consultas en este periodo." />
          <div className="panel-footer-stat">
            <span>Valor de venta de consultas</span>
            <strong>{currencyFormatter.format(currentInquirySaleValue)}</strong>
          </div>
        </article>
      </section>

      <section className="dashboard-grid">
        <article className="panel chart-panel">
          <div className="panel-heading">
            <div><h2>Nuevos seguidores en RRSS</h2><p className="panel-subtitle">Últimos 6 meses registrados</p></div>
            <a href="/rrss" className="text-link">Ver RRSS →</a>
          </div>
          <TrendChart
            data={rrssTrend}
            series={[{ key: "newFollowers", label: "Nuevos seguidores", color: "#4f46e5" }]}
            ariaLabel="Evolución mensual de nuevos seguidores"
          />
        </article>
        <article className="panel chart-panel">
          <div className="panel-heading"><div><h2>Meta Ads y mailing</h2><p className="panel-subtitle">Total registrado</p></div></div>
          <ul className="stat-list">
            <li><span>Gasto en Meta Ads</span><strong>{currencyFormatter.format(rrssSummary.adsSpend)}</strong></li>
            <li><span>Valor de venta RRSS</span><strong>{currencyFormatter.format(rrssSummary.revenue)}</strong></li>
            <li><span>Leads de Meta Ads</span><strong>{numberFormatter.format(rrssSummary.adsLeads)}</strong></li>
            <li><span>Seguidores ganados</span><strong>{numberFormatter.format(rrssSummary.followersGained)}</strong></li>
            <li><span>Envíos de email</span><strong>{numberFormatter.format(rrssSummary.mailingSent)}</strong></li>
            <li><span>Open rate medio</span><strong>{formatPercent(rrssSummary.mailingOpenRate)}</strong></li>
          </ul>
        </article>
      </section>

      <section className="panel table-panel">
        <div className="panel-heading">
          <div><h2>Comparativa por unidad</h2><p className="panel-subtitle">En {periodLabel}</p></div>
          <button type="button" className="button button-secondary button-compact" onClick={exportUnitComparisonCsv}>Exportar CSV</button>
        </div>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Unidad</th>{inquiryChannelOrder.map((channel) => <th key={channel}>{inquiryChannelLabels[channel]}</th>)}<th>Total</th><th>Leads</th><th>Ganados</th><th>Conversión</th><th>Valor</th><th>Valor de venta Consultas</th></tr></thead>
            <tbody>
              {unitRows.map(({ unit, summed, channels, inquiries, conversion: unitConversion, inquiryValue }) => (
                <tr key={unit.id}>
                  <td><span className="unit-name"><i style={{ background: unit.accent }} />{unit.name}</span></td>
                  {inquiryChannelOrder.map((channel) => <td key={channel}>{channels[channel]}</td>)}<td><strong>{inquiries}</strong></td>
                  <td>{summed.leads}</td><td>{summed.won}</td><td>{formatPercent(unitConversion)}</td>
                  <td>{currencyFormatter.format(summed.saleValue)}</td>
                  <td>{currencyFormatter.format(inquiryValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel table-panel">
        <div className="panel-heading">
          <div><h2>Campañas</h2><p className="panel-subtitle">Las activas primero</p></div>
          <a href="/campanas" className="text-link">Ver todas →</a>
        </div>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Campaña</th><th>Unidad</th><th>Estado</th><th>Leads</th><th>Ganados</th><th>Conversión</th><th>Valor</th><th>Meta Ads</th></tr></thead>
            <tbody>
              {topCampaigns.map((campaign) => {
                const unit = allBusinessUnits.find((item) => item.id === campaign.businessUnitId);
                const stats = campaignStatsFor(campaign, campaignLeads);
                const ads = adsStatsFor(campaign.id, adsEntries);
                return (
                  <tr key={campaign.id}>
                    <td><strong>{campaign.name}</strong></td><td>{unit?.name ?? "—"}</td>
                    <td><span className={campaign.status === "active" ? "badge badge-active" : "badge"}>{campaignStatusLabels[campaign.status]}</span></td>
                    <td>{stats.total}</td><td>{stats.won}</td><td>{formatPercent(stats.total ? (stats.won / stats.total) * 100 : 0)}</td>
                    <td>{currencyFormatter.format(stats.value)}</td>
                    <td>{ads.count > 0 ? `${currencyFormatter.format(ads.spend)} · ${ads.roas.toFixed(2)}x` : "—"}</td>
                  </tr>
                );
              })}
              {topCampaigns.length === 0 ? <tr><td colSpan={8} className="muted">Todavía no hay campañas.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
