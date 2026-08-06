"use client";

import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { businessUnits as demoBusinessUnits, campaigns as demoCampaigns, demoLeads, monthlyStats as demoMonthlyStats } from "@/lib/demo-data";
import { campaignStatusLabels } from "@/lib/constants";
import { monthKey, monthShortLabel, previousMonthKey, previousYearMonthKey, yearOfMonth, yearRange } from "@/lib/dates";
import { currencyFormatter, formatPercent, numberFormatter } from "@/lib/format";
import { reportSafeError } from "@/lib/errors";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { KpiCard } from "@/components/kpi-card";
import { TrendChart } from "@/components/charts/trend-chart";
import { StatusBars } from "@/components/charts/status-bars";
import type { BusinessUnit, Campaign, CampaignStatus, LeadStatus, MonthlyStat } from "@/lib/types";

type ViewMode = "month" | "year";
type CompareMode = "previous" | "current" | "previous_year" | "none";
type CampaignRow = { id: string; businessUnitId: string; name: string; status: CampaignStatus };
type CampaignLeadStub = { campaignId: string | null; status: LeadStatus; saleValue: number | null };
type StatusCounts = Partial<Record<LeadStatus, number>>;

type Totals = { web: number; phone: number; leads: number; won: number; saleValue: number };

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

function deltaProps(value: number | null) {
  return value === null ? { delta: "Sin comparación", positive: true } : { delta: formatPercent(Math.abs(value)), positive: value >= 0 };
}

const compareModeHelpers: Record<CompareMode, string> = {
  previous: "frente al mes anterior",
  current: "frente al mes actual",
  previous_year: "frente al mismo mes del año anterior",
  none: "sin periodo de comparación",
};

const demoCampaignLeads: CampaignLeadStub[] = demoLeads.map((lead) => ({ campaignId: lead.campaignId ?? null, status: lead.status, saleValue: lead.saleValue }));
const demoStatusCounts: StatusCounts = demoLeads.reduce((acc, lead) => ({ ...acc, [lead.status]: (acc[lead.status] ?? 0) + 1 }), {} as StatusCounts);

function monthKeyOf(value: string): string {
  return value.slice(0, 7);
}

function campaignStatsFor(campaignId: string, leads: CampaignLeadStub[]) {
  const rows = leads.filter((lead) => lead.campaignId === campaignId);
  const won = rows.filter((lead) => lead.status === "won").length;
  const value = rows.reduce((sum, lead) => sum + (lead.status === "won" ? lead.saleValue ?? 0 : 0), 0);
  return { total: rows.length, won, value };
}

export function DashboardClient() {
  const configured = isSupabaseConfigured();
  const currentMonthKey = monthKey();
  const [businessUnitId, setBusinessUnitId] = useState("all");
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [selectedMonth, setSelectedMonth] = useState(currentMonthKey);
  const [selectedYear, setSelectedYear] = useState(yearOfMonth(currentMonthKey));
  const [compareMode, setCompareMode] = useState<CompareMode>("previous");
  const [message, setMessage] = useState<string | null>(null);

  const [allBusinessUnits, setAllBusinessUnits] = useState<BusinessUnit[]>(demoBusinessUnits);
  const [monthlyStats, setMonthlyStats] = useState<MonthlyStat[]>(demoMonthlyStats);
  const [campaignRows, setCampaignRows] = useState<CampaignRow[]>(demoCampaigns.map((campaign: Campaign) => ({ id: campaign.id, businessUnitId: campaign.businessUnitId, name: campaign.name, status: campaign.status })));
  const [campaignLeads, setCampaignLeads] = useState<CampaignLeadStub[]>(demoCampaignLeads);
  const [statusCounts, setStatusCounts] = useState<StatusCounts>(demoStatusCounts);

  const businessUnits = useMemo(() => allBusinessUnits.filter((unit) => unit.active), [allBusinessUnits]);
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
        { data: leadData, error: leadError },
        { data: historyData, error: historyError },
        { data: campaignData, error: campaignError },
      ] = await Promise.all([
        supabase.from("business_units").select("id, name, slug, brand_color, logo_url, is_active").order("name"),
        supabase.from("inquiries").select("business_unit_id, inquiry_type, created_at, sale_value").gte("created_at", fetchStart).lt("created_at", fetchEnd),
        supabase.from("leads").select("id, business_unit_id, campaign_id, created_at, sale_value, status").limit(2000),
        supabase.from("lead_status_history").select("new_status, changed_at, leads(business_unit_id, sale_value)").in("new_status", ["won", "lost"]).limit(2000),
        supabase.from("campaigns").select("id, business_unit_id, name, status").neq("status", "archived").order("name"),
      ]);
      if (unitError || inquiryError || leadError || historyError || campaignError) {
        setMessage(reportSafeError(unitError ?? inquiryError ?? leadError ?? historyError ?? campaignError, "No se pudieron cargar los datos del dashboard."));
        return;
      }

      const units: BusinessUnit[] = (unitData ?? []).map((row) => ({ id: row.id, name: row.name, slug: row.slug, accent: row.brand_color || "#2563eb", active: row.is_active, logo: row.logo_url }));
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
        if (row.inquiry_type === "phone") b.phone += 1; else b.web += 1;
        b.saleValue += row.sale_value ?? 0;
      }
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

      setCampaignRows((campaignData ?? []).map((row) => ({ id: row.id, businessUnitId: row.business_unit_id, name: row.name, status: row.status as CampaignStatus })));

      const leadStubs: CampaignLeadStub[] = (leadData ?? []).map((row) => ({ campaignId: row.campaign_id, status: row.status as LeadStatus, saleValue: row.sale_value === null || row.sale_value === undefined ? null : Number(row.sale_value) }));
      setCampaignLeads(leadStubs);

      const counts: StatusCounts = {};
      for (const row of leadData ?? []) {
        const status = row.status as LeadStatus;
        counts[status] = (counts[status] ?? 0) + 1;
      }
      setStatusCounts(counts);
    })();
  }, [configured, selectedMonthYear, selectedYear]);

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

  const hasComparison = previousRows.length > 0;
  const current = sumRows(currentRows);
  const previous = sumRows(previousRows);
  const currentTotal = current.web + current.phone;
  const previousTotal = previous.web + previous.phone;
  const conversion = current.leads ? (current.won / current.leads) * 100 : 0;
  const previousConversion = previous.leads ? (previous.won / previous.leads) * 100 : null;

  const webDelta = hasComparison ? variation(current.web, previous.web) : null;
  const phoneDelta = hasComparison ? variation(current.phone, previous.phone) : null;
  const totalDelta = hasComparison ? variation(currentTotal, previousTotal) : null;
  const leadsDelta = hasComparison ? variation(current.leads, previous.leads) : null;
  const wonDelta = hasComparison ? current.won - previous.won : null;
  const conversionDelta = hasComparison && previousConversion !== null ? conversion - previousConversion : null;
  const saleValueDelta = hasComparison ? variation(current.saleValue, previous.saleValue) : null;

  const comparisonHelper = viewMode === "year" ? `frente a ${selectedYear - 1}` : compareModeHelpers[compareMode];

  const trendYear = viewMode === "year" ? selectedYear : yearOfMonth(selectedMonth);
  const trendMonths = useMemo(
    () => Array.from({ length: 12 }, (_, index) => `${trendYear}-${String(index + 1).padStart(2, "0")}`),
    [trendYear],
  );
  const trendData = trendMonths.map((month) => {
    const summed = sumRows(filtered.filter((row) => row.month === month));
    return { label: monthShortLabel(month), web: summed.web, phone: summed.phone };
  });

  const unitRows = businessUnits.map((unit) => {
    const rows = viewMode === "month"
      ? monthlyStats.filter((item) => item.month === selectedMonth && item.businessUnitId === unit.id)
      : monthlyStats.filter((item) => yearOfMonth(item.month) === selectedYear && item.businessUnitId === unit.id);
    const summed = sumRows(rows);
    return { unit, summed, inquiries: summed.web + summed.phone, conversion: summed.leads ? (summed.won / summed.leads) * 100 : 0 };
  });

  return (
    <div className="page-stack">
      {message ? <div className="form-message" role="status">{message}</div> : null}
      <section className="filter-bar panel">
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
      </section>

      <section className="kpi-grid">
        <KpiCard label="Consultas web" value={numberFormatter.format(current.web)} helper={comparisonHelper} {...deltaProps(webDelta)} />
        <KpiCard label="Consultas telefónicas" value={numberFormatter.format(current.phone)} helper={comparisonHelper} {...deltaProps(phoneDelta)} />
        <KpiCard label="Consultas totales" value={numberFormatter.format(currentTotal)} helper={comparisonHelper} {...deltaProps(totalDelta)} />
        <KpiCard label="Leads" value={numberFormatter.format(current.leads)} helper={comparisonHelper} {...deltaProps(leadsDelta)} />
        <KpiCard label="Ganados" value={numberFormatter.format(current.won)} delta={wonDelta === null ? "Sin comparación" : `${wonDelta >= 0 ? "+" : ""}${wonDelta}`} positive={wonDelta === null || wonDelta >= 0} helper={comparisonHelper} />
        <KpiCard label="Conversión" value={formatPercent(conversion)} delta={conversionDelta === null ? "Sin comparación" : `${conversionDelta >= 0 ? "+" : ""}${conversionDelta.toFixed(1).replace(".", ",")} pts`} positive={conversionDelta === null || conversionDelta >= 0} helper={comparisonHelper} />
        <KpiCard label="Valor ganado" value={currencyFormatter.format(current.saleValue)} helper={comparisonHelper} {...deltaProps(saleValueDelta)} />
      </section>

      <section className="dashboard-grid">
        <article className="panel chart-panel chart-panel-wide">
          <div className="panel-heading">
            <div><span className="eyebrow">Consultas</span><h2>Evolución mensual</h2></div>
            <span className="muted">Año {trendYear}</span>
          </div>
          <TrendChart data={trendData} />
        </article>
        <article className="panel chart-panel">
          <div className="panel-heading">
            <div><span className="eyebrow">Leads</span><h2>Distribución por estado</h2></div>
          </div>
          <StatusBars counts={statusCounts} />
        </article>
      </section>

      <section className="panel table-panel">
        <div className="panel-heading">
          <div><span className="eyebrow">Rendimiento</span><h2>Comparativa por unidad</h2></div>
          <button className="button button-secondary">Exportar CSV</button>
        </div>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Unidad</th><th>Web</th><th>Teléfono</th><th>Total</th><th>Leads</th><th>Ganados</th><th>Conversión</th><th>Valor</th></tr></thead>
            <tbody>
              {unitRows.map(({ unit, summed, inquiries, conversion: unitConversion }) => (
                <tr key={unit.id}>
                  <td><span className="unit-name"><i style={{ background: unit.accent }} />{unit.name}</span></td>
                  <td>{summed.web}</td><td>{summed.phone}</td><td><strong>{inquiries}</strong></td>
                  <td>{summed.leads}</td><td>{summed.won}</td><td>{formatPercent(unitConversion)}</td>
                  <td>{currencyFormatter.format(summed.saleValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel table-panel">
        <div className="panel-heading">
          <div><span className="eyebrow">Campañas</span><h2>Resumen general</h2></div>
          <a href="/campanas" className="text-link">Ver todas →</a>
        </div>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Campaña</th><th>Unidad</th><th>Estado</th><th>Leads</th><th>Ganados</th><th>Conversión</th><th>Valor</th></tr></thead>
            <tbody>
              {campaignRows.map((campaign) => {
                const unit = allBusinessUnits.find((item) => item.id === campaign.businessUnitId);
                const stats = campaignStatsFor(campaign.id, campaignLeads);
                return (
                  <tr key={campaign.id}>
                    <td><strong>{campaign.name}</strong></td><td>{unit?.name ?? "—"}</td>
                    <td><span className={campaign.status === "active" ? "badge badge-active" : "badge"}>{campaignStatusLabels[campaign.status]}</span></td>
                    <td>{stats.total}</td><td>{stats.won}</td><td>{formatPercent(stats.total ? (stats.won / stats.total) * 100 : 0)}</td>
                    <td>{currencyFormatter.format(stats.value)}</td>
                  </tr>
                );
              })}
              {campaignRows.length === 0 ? <tr><td colSpan={7} className="muted">Sin campañas activas.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
