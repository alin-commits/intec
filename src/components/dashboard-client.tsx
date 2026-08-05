"use client";

import { useMemo, useState, type ChangeEvent } from "react";
import { businessUnits as allBusinessUnits, campaigns, monthlyStats } from "@/lib/demo-data";
import { monthKey, monthShortLabel, previousMonthKey, previousYearMonthKey, yearOfMonth } from "@/lib/dates";
import { currencyFormatter, formatPercent, numberFormatter } from "@/lib/format";
import { KpiCard } from "@/components/kpi-card";
import { TrendChart } from "@/components/charts/trend-chart";
import { StatusBars } from "@/components/charts/status-bars";
import type { MonthlyStat } from "@/lib/types";

type ViewMode = "month" | "year";
type CompareMode = "previous" | "current" | "previous_year" | "none";

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

const businessUnits = allBusinessUnits.filter((unit) => unit.active);

const compareModeHelpers: Record<CompareMode, string> = {
  previous: "frente al mes anterior",
  current: "frente al mes actual",
  previous_year: "frente al mismo mes del año anterior",
  none: "sin periodo de comparación",
};

export function DashboardClient() {
  const currentMonthKey = monthKey();
  const [businessUnitId, setBusinessUnitId] = useState("all");
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [selectedMonth, setSelectedMonth] = useState(currentMonthKey);
  const [selectedYear, setSelectedYear] = useState(yearOfMonth(currentMonthKey));
  const [compareMode, setCompareMode] = useState<CompareMode>("previous");

  const availableYears = useMemo(() => Array.from(new Set(monthlyStats.map((row) => yearOfMonth(row.month)))).sort(), []);

  const filtered = useMemo(
    () => monthlyStats.filter((item) => businessUnitId === "all" || item.businessUnitId === businessUnitId),
    [businessUnitId],
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
    () => Array.from(new Set(monthlyStats.filter((row) => yearOfMonth(row.month) === trendYear).map((row) => row.month))).sort(),
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
          <StatusBars />
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
          <div><span className="eyebrow">Campañas</span><h2>Resultados del periodo</h2></div>
          <a href="/campanas" className="text-link">Ver todas →</a>
        </div>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Campaña</th><th>Unidad</th><th>Estado</th><th>Leads</th><th>Ganados</th><th>Conversión</th><th>Valor</th></tr></thead>
            <tbody>
              {campaigns.map((campaign) => {
                const unit = allBusinessUnits.find((item) => item.id === campaign.businessUnitId);
                return (
                  <tr key={campaign.id}>
                    <td><strong>{campaign.name}</strong></td><td>{unit?.name ?? "—"}</td>
                    <td><span className={campaign.status === "Activa" ? "badge badge-active" : "badge"}>{campaign.status}</span></td>
                    <td>{campaign.leads}</td><td>{campaign.won}</td><td>{formatPercent((campaign.won / campaign.leads) * 100)}</td>
                    <td>{currencyFormatter.format(campaign.value)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
