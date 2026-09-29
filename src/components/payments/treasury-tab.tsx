"use client";

import { useState } from "react";
import { KpiCard } from "@/components/kpi-card";
import { TrendChart } from "@/components/charts/trend-chart";
import { CalendarIcon, EuroIcon, WalletIcon, XCircleIcon } from "@/components/icons";
import { cashDate, settingKey, treasuryWeeks, type OpenItem } from "@/lib/payments";
import { createClient } from "@/lib/supabase/client";
import { fetchAllPages } from "@/lib/supabase/fetch-all";
import { DataTable, LoadFailed, Panel, useSageQuery, type Column } from "@/components/sales/sales-ui";
import type { PaymentsContext } from "./payments-view";

/*
  Tesorería: lo que se va a cobrar y a pagar semana a semana, con lo vencido
  aparte. Los pagos de confirming con aplazamiento salen de la cuenta cuando el
  banco los carga, no cuando vencen: por eso hay dos cifras de pagos.
*/

const euros = (value: number) => `${new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0 }).format(Math.round(value))} €`;
const shortDate = (day: string | null) => (day ? new Date(`${day}T12:00:00`).toLocaleDateString("es-ES", { day: "numeric", month: "short" }) : "—");

type Row = OpenItem & { taken_on: string };
type Named = { company_code: number; code: string; name: string };

export function TreasuryTab({ ctx }: { ctx: PaymentsContext }) {
  const [company, setCompany] = useState<number | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const data = useSageQuery<Row[]>(JSON.stringify(["cartera"]), async () => {
    const supabase = createClient();
    return fetchAllPages<Row>((from, to) =>
      supabase.from("sage_open_items")
        .select("company_code, kind, counterpart_code, invoice_number, due_date, pending, remittance_number, bank_code, taken_on")
        .order("id").range(from, to));
  });

  const deferrals = new Map(ctx.settings.filter((setting) => setting.active).map((setting) => [settingKey(setting.company_code, setting.sage_bank_code), setting.deferral_days]));
  const deferralFor = (companyCode: number, bankCode: string) => deferrals.get(settingKey(companyCode, bankCode)) ?? null;
  const items = (data.data ?? []).filter((item) => company === null || item.company_code === company);
  const weeks = treasuryWeeks(items, ctx.today, deferralFor);
  const takenOn = (data.data ?? []).reduce<string | null>((latest, item) => (!latest || item.taken_on > latest ? item.taken_on : latest), null);

  const ahead = weeks.filter((week) => week.key !== "vencido");
  const overdue = weeks[0];
  const deferred = items.filter((item) => item.kind === "pago" && item.due_date && cashDate(item, deferralFor) !== item.due_date);
  const selectedWeek = weeks.find((week) => week.key === selected) ?? null;

  // Los nombres de quien cobra o paga, solo para la semana elegida.
  const codes = selectedWeek ? [...new Set(selectedWeek.items.map((item) => `${item.kind}|${item.company_code}|${item.counterpart_code}`))] : [];
  const names = useSageQuery<{ suppliers: Named[]; customers: Named[] }>(selectedWeek ? JSON.stringify(["nombres", codes]) : null, async () => {
    const supabase = createClient();
    const supplierCodes = [...new Set(selectedWeek?.items.filter((item) => item.kind === "pago").map((item) => item.counterpart_code) ?? [])];
    const customerCodes = [...new Set(selectedWeek?.items.filter((item) => item.kind === "cobro").map((item) => item.counterpart_code) ?? [])];
    const [suppliers, customers] = await Promise.all([
      supplierCodes.length ? supabase.from("sage_suppliers").select("company_code, code, name").in("code", supplierCodes.slice(0, 900)) : Promise.resolve({ data: [], error: null }),
      customerCodes.length ? supabase.from("sage_customers").select("company_code, code, name").in("code", customerCodes.slice(0, 900)) : Promise.resolve({ data: [], error: null }),
    ]);
    const error = suppliers.error ?? customers.error;
    return { data: error ? null : { suppliers: (suppliers.data ?? []) as Named[], customers: (customers.data ?? []) as Named[] }, error };
  });
  const nameOf = (item: OpenItem) => {
    const list = item.kind === "pago" ? names.data?.suppliers : names.data?.customers;
    return list?.find((row) => row.company_code === item.company_code && row.code === item.counterpart_code)?.name ?? item.counterpart_code;
  };

  const points = weeks.map((week) => ({ label: week.key === "vencido" ? "Vencido" : week.key === "despues" ? "Después" : week.label.split("–")[0], cobros: Math.round(week.cobros), salidas: Math.round(week.salidas), acumulado: Math.round(week.acumulado) }));

  type WeekItem = OpenItem & { cash: string | null };
  const weekItems: WeekItem[] = (selectedWeek?.items ?? []).map((item) => ({ ...item, cash: cashDate(item, deferralFor) }));
  const columns: Column<WeekItem>[] = [
    { key: "quien", header: "Cliente o proveedor", text: true, render: (row) => (
      <span className="sales-article">
        <strong>{nameOf(row)}</strong>
        <small>{row.kind === "cobro" ? "Cobro" : "Pago"}{row.invoice_number ? ` · factura ${row.invoice_number}` : ""}{ctx.companies.length > 1 ? ` · ${ctx.companyName(row.company_code)}` : ""}</small>
      </span>
    ), sort: (row) => nameOf(row) },
    { key: "vence", header: "Vence", render: (row) => shortDate(row.due_date), sort: (row) => row.due_date ?? "" },
    { key: "cargo", header: "Sale de cuenta", optional: true, render: (row) => (row.kind === "pago" && row.cash !== row.due_date ? <span className="sales-up">{shortDate(row.cash)}</span> : <span className="muted">—</span>), sort: (row) => row.cash ?? "" },
    { key: "importe", header: "Importe", render: (row) => <span className={row.kind === "cobro" ? "sales-up" : "sales-down"}>{row.kind === "cobro" ? "+" : "−"}{euros(Number(row.pending))}</span>, sort: (row) => (row.kind === "cobro" ? 1 : -1) * Number(row.pending) },
  ];

  if (data.failed) return <LoadFailed what="la cartera pendiente" />;
  if (data.data && data.data.length === 0) {
    return (
      <section className="panel sales-pending">
        <strong>Todavía no ha llegado la cartera pendiente de Sage</strong>
        <span>Llega con la lectura de la noche (o con la carga larga). A partir de ahí esta página se llena sola cada día.</span>
      </section>
    );
  }

  return (
    <div className="page-stack">
      <section className="sales-section-heading">
        <p>
          Cobros y pagos pendientes en Sage{takenOn ? `, según la foto del ${shortDate(takenOn)}` : ""}. Los pagos de confirming con
          aplazamiento salen de la cuenta el día que los carga el banco.
        </p>
        <select className="panel-heading-select" value={company ?? ""} onChange={(event) => setCompany(event.target.value ? Number(event.target.value) : null)} aria-label="Sociedad">
          <option value="">Todas las sociedades</option>
          {ctx.companies.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}
        </select>
      </section>

      <section className="kpi-grid kpi-grid-sales">
        <KpiCard label="Por cobrar (13 semanas)" value={euros(ahead.slice(0, -1).reduce((sum, week) => sum + week.cobros, 0))} helper="cobros pendientes que vencen" delta="Sin comparación" icon={<EuroIcon />} tone="emerald" />
        <KpiCard label="Sale de cuenta (13 semanas)" value={euros(ahead.slice(0, -1).reduce((sum, week) => sum + week.salidas, 0))} helper="pagos, con los aplazamientos" delta="Sin comparación" icon={<WalletIcon />} tone="amber" />
        <KpiCard label="Cobros vencidos" value={euros(overdue.cobros)} helper="vencidos y sin cobrar" delta="Sin comparación" icon={<XCircleIcon />} tone="rose" onClick={() => setSelected("vencido")} actionLabel="Ver cuáles" active={selected === "vencido"} />
        <KpiCard label="Confirming aplazado" value={euros(deferred.reduce((sum, item) => sum + Number(item.pending), 0))} helper={`${deferred.length} pagos que el banco carga más tarde`} delta="Sin comparación" icon={<CalendarIcon />} tone="sky" />
      </section>

      <section className="sales-board">
        <Panel title="Semana a semana" subtitle="Cobros, lo que sale de la cuenta y el saldo acumulado desde hoy. Pulsa una semana para ver el detalle" className="panel chart-panel sales-board-wide">
          <TrendChart
            data={points}
            series={[
              { key: "cobros", label: "Cobros", color: "#10b981" },
              { key: "salidas", label: "Salidas", color: "#f43f5e" },
              { key: "acumulado", label: "Acumulado", color: "#4f46e5" },
            ]}
            ariaLabel="Previsión de tesorería por semanas"
            onSelect={(index) => setSelected((current) => (current === weeks[index]?.key ? null : weeks[index]?.key ?? null))}
            selectedIndex={selected ? weeks.findIndex((week) => week.key === selected) : null}
          />
        </Panel>
        <Panel title="Por semanas" subtitle="Neto = cobros − salidas" className="panel table-panel sales-board-narrow">
          <table className="sales-data-table payments-weeks">
            <thead><tr><th className="is-text">Semana</th><th>Neto</th><th>Acumulado</th></tr></thead>
            <tbody>
              {weeks.map((week) => (
                <tr key={week.key} className={`is-clickable${selected === week.key ? " is-active" : ""}`} onClick={() => setSelected((current) => (current === week.key ? null : week.key))}>
                  <td className="is-text"><button type="button" className="sales-row-button" aria-pressed={selected === week.key}>{week.label}</button></td>
                  <td className={week.neto >= 0 ? "sales-up" : "sales-down"}>{euros(week.neto)}</td>
                  <td>{euros(week.acumulado)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </section>

      {selectedWeek ? (
        <Panel
          title={selectedWeek.key === "vencido" ? "Vencido y pendiente" : `Semana ${selectedWeek.label}`}
          subtitle={`Cobros ${euros(selectedWeek.cobros)} · pagos que vencen ${euros(selectedWeek.pagos)} · sale de cuenta ${euros(selectedWeek.salidas)}`}
          trailing={<button type="button" className="sales-chip sales-chip-clear" onClick={() => setSelected(null)}>Cerrar</button>}
          className="panel table-panel"
        >
          <DataTable rows={weekItems} columns={columns} rowKey={(row) => `${row.kind}-${row.company_code}-${row.counterpart_code}-${row.invoice_number}-${row.due_date}-${row.pending}`} initialSort={{ key: "importe", desc: false }} limit={40} empty="Nada esta semana." />
        </Panel>
      ) : null}
    </div>
  );
}
