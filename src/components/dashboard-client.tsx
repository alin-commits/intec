"use client";

import { useMemo, useState, type ChangeEvent } from "react";
import { businessUnits, campaigns, monthlyStats } from "@/lib/demo-data";
import { currencyFormatter, formatPercent, numberFormatter } from "@/lib/format";
import { KpiCard } from "@/components/kpi-card";
import { TrendChart } from "@/components/charts/trend-chart";
import { StatusBars } from "@/components/charts/status-bars";

export function DashboardClient() {
  const [businessUnitId, setBusinessUnitId] = useState("all");
  const [period, setPeriod] = useState("aug-2026");

  const filtered = useMemo(
    () => monthlyStats.filter((item) => businessUnitId === "all" || item.businessUnitId === businessUnitId),
    [businessUnitId],
  );

  const currentMonth = filtered.filter((item) => item.month === "Ago");
  const previousMonth = filtered.filter((item) => item.month === "Jul");
  const total = (rows: typeof filtered, key: keyof (typeof filtered)[number]) =>
    rows.reduce((sum, row) => sum + Number(row[key]), 0);

  const web = total(currentMonth, "web");
  const phone = total(currentMonth, "phone");
  const leads = total(currentMonth, "leads");
  const won = total(currentMonth, "won");
  const saleValue = total(currentMonth, "saleValue");
  const previousTotal = total(previousMonth, "web") + total(previousMonth, "phone");
  const currentTotal = web + phone;
  const totalDelta = previousTotal ? ((currentTotal - previousTotal) / previousTotal) * 100 : 0;
  const conversion = leads ? (won / leads) * 100 : 0;

  const trendData = ["Mar", "Abr", "May", "Jun", "Jul", "Ago"].map((month) => {
    const rows = filtered.filter((item) => item.month === month);
    return { label: month, web: total(rows, "web"), phone: total(rows, "phone") };
  });

  const unitRows = businessUnits.map((unit) => {
    const row = monthlyStats.find((item) => item.month === "Ago" && item.businessUnitId === unit.id);
    const inquiries = (row?.web ?? 0) + (row?.phone ?? 0);
    return { unit, row, inquiries, conversion: row?.leads ? ((row.won / row.leads) * 100) : 0 };
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
          <span>Periodo</span>
          <select value={period} onChange={(event: ChangeEvent<HTMLSelectElement>) => setPeriod(event.target.value)}>
            <option value="aug-2026">Agosto 2026</option>
            <option value="jul-2026">Julio 2026</option>
            <option value="year-2026">Año 2026</option>
          </select>
        </label>
        <label>
          <span>Comparar con</span>
          <select defaultValue="previous">
            <option value="previous">Mes anterior</option>
            <option value="year">Mismo mes del año anterior</option>
            <option value="none">Sin comparación</option>
          </select>
        </label>
        <div className="filter-summary">
          <span>Vista actual</span>
          <strong>{period === "aug-2026" ? "Agosto 2026" : "Periodo seleccionado"}</strong>
        </div>
      </section>

      <section className="kpi-grid">
        <KpiCard label="Consultas web" value={numberFormatter.format(web)} delta="12,4 %" />
        <KpiCard label="Consultas telefónicas" value={numberFormatter.format(phone)} delta="4,8 %" />
        <KpiCard label="Consultas totales" value={numberFormatter.format(currentTotal)} delta={formatPercent(Math.abs(totalDelta))} positive={totalDelta >= 0} />
        <KpiCard label="Leads" value={numberFormatter.format(leads)} delta="9,1 %" />
        <KpiCard label="Ganados" value={numberFormatter.format(won)} delta="2 más" helper="que el mes anterior" />
        <KpiCard label="Conversión" value={formatPercent(conversion)} delta="1,6 puntos" />
        <KpiCard label="Valor ganado" value={currencyFormatter.format(saleValue)} delta="18,2 %" />
      </section>

      <section className="dashboard-grid">
        <article className="panel chart-panel chart-panel-wide">
          <div className="panel-heading">
            <div><span className="eyebrow">Consultas</span><h2>Evolución mensual</h2></div>
            <span className="muted">Marzo — agosto 2026</span>
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
              {unitRows.map(({ unit, row, inquiries, conversion: unitConversion }) => (
                <tr key={unit.id}>
                  <td><span className="unit-name"><i style={{ background: unit.accent }} />{unit.name}</span></td>
                  <td>{row?.web ?? 0}</td><td>{row?.phone ?? 0}</td><td><strong>{inquiries}</strong></td>
                  <td>{row?.leads ?? 0}</td><td>{row?.won ?? 0}</td><td>{formatPercent(unitConversion)}</td>
                  <td>{currencyFormatter.format(row?.saleValue ?? 0)}</td>
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
                const unit = businessUnits.find((item) => item.id === campaign.businessUnitId);
                return (
                  <tr key={campaign.id}>
                    <td><strong>{campaign.name}</strong></td><td>{unit?.name}</td>
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
