"use client";

import { useState } from "react";
import { KpiCard } from "@/components/kpi-card";
import { TrendChart } from "@/components/charts/trend-chart";
import { TrophyIcon, EuroIcon, CalendarIcon } from "@/components/icons";
import { formatPercent } from "@/lib/format";
import { euros, filterRows, groupRows, monthLongNames, monthNames, targetsFor, targetToDate, type SummaryRow } from "@/lib/sales-model";
import { createClient } from "@/lib/supabase/client";
import type { SalesContext } from "./sales-context";
import { Panel } from "./sales-ui";

/*
  Objetivos: el presupuesto de ventas, que no está en Sage y se pone aquí, y
  cómo se va contra él. El objetivo es del ámbito elegido arriba: sin sociedad
  ni comercial es el del grupo; con sociedad, el de esa sociedad; con
  comercial, el de esa persona. No se reparte solo de uno a otro: eso lo decide
  Dirección.
*/

const parseAmount = (text: string): number | null => {
  const clean = text.replace(/[€\s]/g, "").replace(/\./g, "").replace(",", ".");
  if (clean === "") return null;
  const value = Number(clean);
  return Number.isFinite(value) && value >= 0 ? value : Number.NaN;
};
const formatInput = (value: number | null) => (value === null ? "" : new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2 }).format(value));

export function TargetsPage({ ctx }: { ctx: SalesContext }) {
  // Los objetivos se ponen mes a mes dentro de un año: con otro periodo no hay año que enseñar.
  if (ctx.period.year === null) return <TargetsNeedYear ctx={ctx} />;
  return <TargetsOfYear ctx={ctx} shownYear={ctx.period.year} />;
}

function TargetsNeedYear({ ctx }: { ctx: SalesContext }) {
  const year = ctx.today.getFullYear();
  return (
    <section className="panel panel-padded sales-need-year">
      <h2>Los objetivos son por año</h2>
      <p className="muted">
        Se ponen mes a mes dentro de un año natural, y ahora estás mirando {ctx.period.baseLabel}. Elige un año en
        «Periodo» para ver cómo se va contra su objetivo o para ponerlo.
      </p>
      <button type="button" className="button button-primary" onClick={() => ctx.choosePeriod({ kind: "year", year })}>Ver {year}</button>
    </section>
  );
}

function TargetsOfYear({ ctx, shownYear }: { ctx: SalesContext; shownYear: number }) {
  const { filters, today } = ctx;
  const months = targetsFor(ctx.targets, shownYear, filters.company, filters.repKey);
  const scopeKey = JSON.stringify([shownYear, filters.company, filters.repKey, ctx.targets]);
  const [draft, setDraft] = useState<string[]>(() => months.map(formatInput));
  const [draftKey, setDraftKey] = useState(scopeKey);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [yearTotal, setYearTotal] = useState("");
  const [growth, setGrowth] = useState("5");
  // Otro ámbito u objetivos recién guardados: el formulario vuelve a lo que hay.
  if (draftKey !== scopeKey) {
    setDraftKey(scopeKey);
    setDraft(months.map(formatInput));
  }

  // La venta real del ámbito, mes a mes (sin canal ni mes: el objetivo es del mes entero).
  const realRows = filterRows(ctx.rows, filters, ctx.repOf, ["channel", "month"]);
  const realByMonth = groupRows(realRows, (row) => row.month);
  const real = Array.from({ length: 12 }, (_, index) => realByMonth.get(`${shownYear}-${String(index + 1).padStart(2, "0")}`)?.net ?? 0);
  const monthIndex = filters.month ? Number(filters.month.slice(5, 7)) - 1 : null;
  const soFar = targetToDate(months, shownYear, today, monthIndex);
  const realSoFar = soFar ? soFar.months.reduce((sum, key) => sum + (realByMonth.get(key)?.net ?? 0), 0) : 0;
  const yearTarget = months.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  const yearReal = real.reduce((sum, value) => sum + value, 0);
  const hasTargets = months.some((value) => value !== null);
  const lastMonthIndex = shownYear === today.getFullYear() ? today.getMonth() : 11;

  const upTo = (list: (number | null)[], index: number) => list.slice(0, index + 1).reduce<number>((sum, value) => sum + (value ?? 0), 0);
  const points = months.map((_, index) => ({
    label: monthNames[index],
    objetivo: Math.round(upTo(months, index)),
    ventas: index <= lastMonthIndex ? Math.round(upTo(real, index)) : 0,
  }));

  const scopeLabel = [
    filters.company === null ? "Todo el grupo" : ctx.companyLabel,
    filters.repKey ? ctx.repName(filters.repKey) : null,
  ].filter(Boolean).join(" · ");

  async function save() {
    const parsed = draft.map(parseAmount);
    if (parsed.some((value) => Number.isNaN(value))) {
      setMessage({ tone: "error", text: "Hay algún importe que no es un número. Escribe solo cifras, por ejemplo 250.000." });
      return;
    }
    setSaving(true);
    setMessage(null);
    const supabase = createClient();
    const existing = ctx.targets.filter((target) => target.year === shownYear && target.company_code === filters.company && target.rep_key === filters.repKey);
    const byMonth = new Map(existing.map((target) => [target.month, target]));
    const errors: string[] = [];
    for (let index = 0; index < 12; index += 1) {
      const value = parsed[index];
      const current = byMonth.get(index + 1);
      if (value === null) {
        if (current) {
          const { error } = await supabase.from("sales_targets").delete().eq("id", current.id);
          if (error) errors.push(monthLongNames[index]);
        }
        continue;
      }
      if (current && Number(current.amount) === value) continue;
      const { error } = current
        ? await supabase.from("sales_targets").update({ amount: value }).eq("id", current.id)
        : await supabase.from("sales_targets").insert({ year: shownYear, month: index + 1, company_code: filters.company, rep_key: filters.repKey, amount: value });
      if (error) errors.push(monthLongNames[index]);
    }
    setSaving(false);
    ctx.reloadTargets();
    setMessage(errors.length > 0
      ? { tone: "error", text: `No se pudo guardar ${errors.join(", ")}. Vuelve a intentarlo.` }
      : { tone: "ok", text: "Objetivos guardados." });
  }

  function spread() {
    // Reparte un total anual a partes iguales, para empezar desde algo.
    const value = parseAmount(yearTotal);
    if (value === null || Number.isNaN(value)) {
      setMessage({ tone: "error", text: "Escribe el objetivo del año entero, por ejemplo 3.000.000." });
      return;
    }
    setMessage(null);
    setDraft(Array.from({ length: 12 }, () => formatInput(Math.round((value / 12) * 100) / 100)));
  }

  async function fromLastYear() {
    // El mismo mes del año anterior más un porcentaje, que es como se suele
    // presupuestar. Se pide el año anterior entero: el panel solo tiene cargado
    // hasta hoy para poder comparar.
    const percent = Number(growth.replace(",", "."));
    if (!Number.isFinite(percent)) {
      setMessage({ tone: "error", text: "El crecimiento tiene que ser un número, por ejemplo 5 o -2." });
      return;
    }
    const { data, error } = await createClient().rpc("sage_sales_summary", { p_from: `${shownYear - 1}-01-01`, p_to: `${shownYear - 1}-12-31`, p_basis: "albaran" });
    if (error) {
      setMessage({ tone: "error", text: `No se pudo leer la venta de ${shownYear - 1}.` });
      return;
    }
    setMessage(null);
    const before = groupRows(filterRows((data ?? []) as SummaryRow[], filters, ctx.repOf, ["channel", "month"]), (row) => row.month);
    setDraft(Array.from({ length: 12 }, (_, index) => {
      const value = before.get(`${shownYear - 1}-${String(index + 1).padStart(2, "0")}`)?.net ?? 0;
      return value > 0 ? formatInput(Math.round(value * (1 + percent / 100))) : "";
    }));
  }

  return (
    <div className="page-stack">
      <section className="kpi-grid kpi-grid-sales">
        <KpiCard
          label={filters.month ? `Cumplimiento de ${monthLongNames[monthIndex ?? 0]}` : "Cumplimiento a hoy"}
          value={soFar ? formatPercent((realSoFar / Math.max(soFar.target, 1)) * 100) : "Sin objetivo"}
          helper={soFar ? `${euros(realSoFar)} de ${euros(soFar.target)}` : "escribe el objetivo abajo"}
          icon={<TrophyIcon />}
          tone={soFar ? (realSoFar >= soFar.target ? "emerald" : "rose") : "amber"}
          {...(soFar ? { delta: `${realSoFar >= soFar.target ? "+" : "-"}${euros(Math.abs(realSoFar - soFar.target))}`, positive: realSoFar >= soFar.target } : { delta: "Sin comparación", positive: true })}
        />
        <KpiCard label={`Objetivo ${shownYear}`} value={hasTargets ? euros(yearTarget) : "—"} helper={scopeLabel} delta="Sin comparación" icon={<CalendarIcon />} tone="indigo" />
        <KpiCard
          label="Falta para el año"
          value={hasTargets ? euros(Math.max(yearTarget - yearReal, 0)) : "—"}
          helper={hasTargets ? `vendido ${euros(yearReal)} (${formatPercent((yearReal / Math.max(yearTarget, 1)) * 100)})` : "sin objetivo"}
          delta="Sin comparación"
          icon={<EuroIcon />}
          tone="sky"
        />
      </section>

      <section className="sales-board">
        <Panel
          title={`Ventas contra objetivo, acumulado ${shownYear}`}
          subtitle={`${scopeLabel}. Pulsa un mes para filtrar`}
          className="panel chart-panel sales-board-wide"
        >
          <TrendChart
            data={points}
            series={[
              { key: "objetivo", label: "Objetivo", color: "#f59e0b" },
              { key: "ventas", label: "Ventas", color: "#4f46e5" },
            ]}
            ariaLabel={`Ventas acumuladas contra objetivo en ${shownYear}`}
            onSelect={(index) => index <= lastMonthIndex && ctx.toggle("month", `${shownYear}-${String(index + 1).padStart(2, "0")}`)}
            selectedIndex={monthIndex}
          />
        </Panel>

        <Panel
          title="Objetivo por mes"
          subtitle={`De: ${scopeLabel}. Cambia la sociedad o el comercial arriba para poner el suyo`}
          className="panel panel-padded sales-board-narrow"
        >
          <div className="sales-targets-actions">
            <label>
              <span>Total del año</span>
              <input inputMode="decimal" value={yearTotal} onChange={(event) => setYearTotal(event.target.value)} placeholder="3.000.000" />
              <button type="button" className="button button-compact button-secondary" onClick={spread}>Repartir</button>
            </label>
            <label>
              <span>{shownYear - 1} más un %</span>
              <input inputMode="decimal" value={growth} onChange={(event) => setGrowth(event.target.value)} aria-label="Crecimiento en porcentaje" />
              <button type="button" className="button button-compact button-secondary" onClick={() => void fromLastYear()}>Calcular</button>
            </label>
          </div>
          <div className="sales-targets-grid">
            {draft.map((value, index) => {
              const target = parseAmount(value);
              const done = index <= lastMonthIndex && target !== null && !Number.isNaN(target) && target > 0 ? (real[index] / target) * 100 : null;
              return (
                <label key={monthLongNames[index]} className={monthIndex === index ? "is-active" : undefined}>
                  <span className="sales-capitalize">{monthLongNames[index]}</span>
                  <input
                    inputMode="decimal"
                    value={value}
                    placeholder="—"
                    onChange={(event) => setDraft((current) => current.map((item, position) => (position === index ? event.target.value : item)))}
                    aria-label={`Objetivo de ${monthLongNames[index]}`}
                  />
                  <small className={done === null ? "muted" : done >= 100 ? "sales-up" : "sales-down"}>
                    {done === null ? (index <= lastMonthIndex ? euros(real[index]) : "") : formatPercent(done)}
                  </small>
                </label>
              );
            })}
          </div>
          <div className="sales-targets-footer">
            {message ? <span className={message.tone === "ok" ? "sales-up" : "sales-down"} role="status">{message.text}</span> : <span className="muted">Deja vacío un mes para quitarle el objetivo.</span>}
            <button type="button" className="button button-primary" onClick={() => void save()} disabled={saving}>{saving ? "Guardando…" : "Guardar"}</button>
          </div>
        </Panel>
      </section>
    </div>
  );
}
