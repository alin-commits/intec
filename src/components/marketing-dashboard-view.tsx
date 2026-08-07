"use client";

import { useEffect, useMemo, useState } from "react";
import { campaignStatusLabels } from "@/lib/constants";
import { monthKey } from "@/lib/dates";
import { currencyFormatter, formatPercent, numberFormatter } from "@/lib/format";
import { reportSafeError } from "@/lib/errors";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { KpiCard } from "@/components/kpi-card";
import type { BusinessUnit, CampaignStatus, LeadStatus } from "@/lib/types";

type CampaignRow = { id: string; businessUnitId: string; name: string; status: CampaignStatus; directSalesCount: number; directSaleValue: number };
type LeadStub = { businessUnitId: string; campaignId: string | null; status: LeadStatus; saleValue: number | null };

function campaignStatsFor(campaign: CampaignRow, leads: LeadStub[]) {
  const rows = leads.filter((lead) => lead.campaignId === campaign.id);
  const leadsWon = rows.filter((lead) => lead.status === "won").length;
  const leadsValue = rows.reduce((sum, lead) => sum + (lead.status === "won" ? lead.saleValue ?? 0 : 0), 0);
  return { total: rows.length, won: leadsWon + campaign.directSalesCount, value: leadsValue + campaign.directSaleValue };
}

export function MarketingDashboardView() {
  const configured = isSupabaseConfigured();
  const [units, setUnits] = useState<BusinessUnit[]>([]);
  const [leads, setLeads] = useState<LeadStub[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [rrssSummary, setRrssSummary] = useState({ newFollowers: 0, adsLeads: 0, adsSpend: 0, mailingSent: 0, mailingOpenRate: 0 });
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!configured) return;
    void (async () => {
      const supabase = createClient();
      const currentMonth = `${monthKey()}-01`;
      const [
        { data: unitData, error: unitError },
        { data: leadData, error: leadError },
        { data: campaignData, error: campaignError },
        { data: socialData },
        { data: adsData },
        { data: mailingData },
      ] = await Promise.all([
        supabase.from("business_units").select("id, name, slug, brand_color, logo_url, is_active").eq("is_active", true).order("name"),
        supabase.from("leads").select("business_unit_id, campaign_id, status, sale_value").limit(2000),
        supabase.from("campaigns").select("id, business_unit_id, name, status, direct_sales_count, direct_sale_value").neq("status", "archived").order("name"),
        supabase.from("social_media_stats").select("new_followers").eq("period_month", currentMonth),
        supabase.from("meta_ads_entries").select("amount_spent, leads"),
        supabase.from("mailing_campaigns").select("sent_count, opens, delivered_count"),
      ]);
      if (unitError || leadError || campaignError) {
        setMessage(reportSafeError(unitError ?? leadError ?? campaignError, "No se pudieron cargar los datos de marketing."));
        return;
      }
      setUnits((unitData ?? []).map((row) => ({ id: row.id, name: row.name, slug: row.slug, accent: row.brand_color || "#2563eb", active: row.is_active, logo: row.logo_url })));
      setLeads((leadData ?? []).map((row) => ({ businessUnitId: row.business_unit_id, campaignId: row.campaign_id, status: row.status as LeadStatus, saleValue: row.sale_value === null || row.sale_value === undefined ? null : Number(row.sale_value) })));
      setCampaigns((campaignData ?? []).map((row) => ({ id: row.id, businessUnitId: row.business_unit_id, name: row.name, status: row.status as CampaignStatus, directSalesCount: Number(row.direct_sales_count ?? 0), directSaleValue: Number(row.direct_sale_value ?? 0) })));
      const totalDelivered = (mailingData ?? []).reduce((sum, row) => sum + Number(row.delivered_count ?? 0), 0);
      const totalOpens = (mailingData ?? []).reduce((sum, row) => sum + Number(row.opens ?? 0), 0);
      setRrssSummary({
        newFollowers: (socialData ?? []).reduce((sum, row) => sum + Number(row.new_followers ?? 0), 0),
        adsSpend: (adsData ?? []).reduce((sum, row) => sum + Number(row.amount_spent ?? 0), 0),
        adsLeads: (adsData ?? []).reduce((sum, row) => sum + Number(row.leads ?? 0), 0),
        mailingSent: (mailingData ?? []).reduce((sum, row) => sum + Number(row.sent_count ?? 0), 0),
        mailingOpenRate: totalDelivered ? (totalOpens / totalDelivered) * 100 : 0,
      });
    })();
  }, [configured]);

  const totalLeads = leads.length;
  const totalWon = leads.filter((lead) => lead.status === "won").length + campaigns.reduce((sum, campaign) => sum + campaign.directSalesCount, 0);
  const conversion = totalLeads ? (leads.filter((lead) => lead.status === "won").length / totalLeads) * 100 : 0;
  const totalValue = leads.reduce((sum, lead) => sum + (lead.status === "won" ? lead.saleValue ?? 0 : 0), 0) + campaigns.reduce((sum, campaign) => sum + campaign.directSaleValue, 0);

  const unitRows = useMemo(() => units.map((unit) => {
    const unitLeads = leads.filter((lead) => lead.businessUnitId === unit.id);
    const won = unitLeads.filter((lead) => lead.status === "won").length;
    return { unit, total: unitLeads.length, won, conversion: unitLeads.length ? (won / unitLeads.length) * 100 : 0 };
  }), [units, leads]);

  return (
    <div className="page-stack">
      <section className="section-heading">
        <div><span className="eyebrow">Marketing</span><h2>Resumen de leads y campañas</h2><p>Vista general de captación. Para gestionar registros, entra en Leads o Campañas.</p></div>
      </section>

      {message ? <div className="form-message" role="status">{message}</div> : null}

      <section className="kpi-grid">
        <KpiCard label="Leads" value={String(totalLeads)} delta="Sin comparación" helper="total actual" />
        <KpiCard label="Ganados" value={String(totalWon)} delta="Sin comparación" helper="total actual" />
        <KpiCard label="Conversión" value={formatPercent(conversion)} delta="Sin comparación" helper="total actual" />
        <KpiCard label="Valor ganado" value={currencyFormatter.format(totalValue)} delta="Sin comparación" helper="total actual" />
      </section>

      <section className="panel table-panel">
        <div className="panel-heading"><div><span className="eyebrow">Rendimiento</span><h2>Leads por unidad</h2></div></div>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Unidad</th><th>Leads</th><th>Ganados</th><th>Conversión</th></tr></thead>
            <tbody>
              {unitRows.map(({ unit, total, won, conversion: unitConversion }) => (
                <tr key={unit.id}>
                  <td><span className="unit-name"><i style={{ background: unit.accent }} />{unit.name}</span></td>
                  <td>{total}</td><td>{won}</td><td>{formatPercent(unitConversion)}</td>
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
              {campaigns.map((campaign) => {
                const unit = units.find((item) => item.id === campaign.businessUnitId);
                const stats = campaignStatsFor(campaign, leads);
                return (
                  <tr key={campaign.id}>
                    <td><strong>{campaign.name}</strong></td><td>{unit?.name ?? "—"}</td>
                    <td><span className={campaign.status === "active" ? "badge badge-active" : "badge"}>{campaignStatusLabels[campaign.status]}</span></td>
                    <td>{stats.total}</td><td>{stats.won}</td><td>{formatPercent(stats.total ? (stats.won / stats.total) * 100 : 0)}</td>
                    <td>{currencyFormatter.format(stats.value)}</td>
                  </tr>
                );
              })}
              {campaigns.length === 0 ? <tr><td colSpan={7} className="muted">Sin campañas activas.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel table-panel">
        <div className="panel-heading">
          <div><span className="eyebrow">RRSS</span><h2>Redes sociales, Meta Ads y mailing</h2></div>
          <a href="/rrss" className="text-link">Ver todas →</a>
        </div>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Nuevos seguidores (mes)</th><th>Gasto Meta Ads</th><th>Leads Meta Ads</th><th>Envíos de email</th><th>Open rate medio</th></tr></thead>
            <tbody>
              <tr>
                <td>{numberFormatter.format(rrssSummary.newFollowers)}</td>
                <td>{currencyFormatter.format(rrssSummary.adsSpend)}</td>
                <td>{numberFormatter.format(rrssSummary.adsLeads)}</td>
                <td>{numberFormatter.format(rrssSummary.mailingSent)}</td>
                <td>{formatPercent(rrssSummary.mailingOpenRate)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
