"use client";

import { useMemo, useState, type ChangeEvent } from "react";
import { businessUnits, demoLeads } from "@/lib/demo-data";
import { currencyFormatter, formatDate } from "@/lib/format";
import type { LeadStatus } from "@/lib/types";

const labels: Record<LeadStatus, string> = {
  new: "Nuevo",
  contact_attempt: "Intento",
  contacted: "Contactado",
  offer_sent: "Oferta enviada",
  interested: "Interesado",
  won: "Ganado",
  lost: "Perdido",
  invalid: "No válido",
};

export function LeadsTable() {
  const [query, setQuery] = useState("");
  const [unitId, setUnitId] = useState("all");
  const [status, setStatus] = useState("all");

  const rows = useMemo(() => demoLeads.filter((lead) => {
    const matchesQuery = `${lead.contactName} ${lead.clientCompanyName} ${lead.productInterest}`.toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (unitId === "all" || lead.businessUnitId === unitId) && (status === "all" || lead.status === status);
  }), [query, unitId, status]);

  return (
    <div className="page-stack">
      <section className="section-heading">
        <div><span className="eyebrow">Base comercial</span><h2>Leads</h2><p>Centraliza los registros de todas las campañas y unidades de negocio.</p></div>
        <button className="button button-primary">+ Nuevo lead</button>
      </section>
      <section className="panel filter-bar lead-filters">
        <label><span>Buscar</span><input value={query} onChange={(event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)} placeholder="Nombre, empresa o producto" /></label>
        <label><span>Unidad</span><select value={unitId} onChange={(event: ChangeEvent<HTMLSelectElement>) => setUnitId(event.target.value)}><option value="all">Todas</option>{businessUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>
        <label><span>Estado</span><select value={status} onChange={(event: ChangeEvent<HTMLSelectElement>) => setStatus(event.target.value)}><option value="all">Todos</option>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <div className="filter-summary"><span>Resultados</span><strong>{rows.length} leads</strong></div>
      </section>
      <section className="panel table-panel">
        <div className="table-scroll">
          <table>
            <thead><tr><th>Fecha</th><th>Unidad</th><th>Contacto / empresa</th><th>Campaña</th><th>Estado</th><th>Interés</th><th>Valor</th></tr></thead>
            <tbody>
              {rows.map((lead) => {
                const unit = businessUnits.find((item) => item.id === lead.businessUnitId);
                return (
                  <tr key={lead.id}>
                    <td>{formatDate(lead.createdAt)}</td>
                    <td><span className="unit-name"><i style={{ background: unit?.accent }} />{unit?.name}</span></td>
                    <td><strong>{lead.contactName}</strong><small>{lead.clientCompanyName}</small></td>
                    <td>{lead.campaign}</td>
                    <td><span className={`badge badge-${lead.status}`}>{labels[lead.status]}</span></td>
                    <td>{lead.productInterest}</td>
                    <td>{lead.saleValue ? currencyFormatter.format(lead.saleValue) : "—"}</td>
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
