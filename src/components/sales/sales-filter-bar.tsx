"use client";

import type { SalesFilters } from "@/lib/sales-model";
import { isDateKey, rangeLabel, sameDayYearBefore, type CompareChoice, type PeriodChoice, type SalesPeriod } from "@/lib/sales-period";
import type { SalesDimension } from "./sales-context";

/*
  La barra de filtros común a todas las páginas de Ventas. Lo mismo que se
  elige aquí se puede elegir pulsando en los gráficos y las tablas; las
  etiquetas de debajo dicen siempre qué está puesto y se quitan de un clic.

  El periodo puede ser un año, todos, los últimos 12 meses o las fechas que se
  quieran, y se compara con el mismo tramo del año anterior, con el periodo
  justo anterior o con otras fechas. Debajo se dice con palabras qué se está
  comparando con qué, para que no haya que adivinarlo.
*/

type Option = { value: string; label: string };

export type ActiveChip = { key: keyof SalesFilters; label: string; note: string | null };

export function SalesFilterBar({
  choice,
  onChoice,
  compare,
  onCompare,
  chosen,
  yearOptions,
  minDate,
  maxDate,
  basis,
  onBasis,
  requested,
  monthOptions,
  companyOptions,
  channelOptions,
  repOptions,
  familyOptions,
  onChange,
  chips,
  onClearAll,
}: {
  choice: PeriodChoice;
  onChoice: (choice: PeriodChoice) => void;
  compare: CompareChoice;
  onCompare: (compare: CompareChoice) => void;
  /** El periodo que se está eligiendo, ya resuelto: de ahí salen las fechas de partida. */
  chosen: SalesPeriod;
  yearOptions: number[];
  /** Entre qué fechas se puede elegir: del primer dato a hoy. */
  minDate: string | null;
  maxDate: string;
  basis: "albaran" | "factura";
  onBasis: (basis: "albaran" | "factura") => void;
  /** Los filtros tal como se eligieron, aunque en este periodo alguno no exista. */
  requested: SalesFilters;
  monthOptions: Option[];
  companyOptions: Option[];
  channelOptions: string[];
  repOptions: Option[];
  familyOptions: Option[];
  onChange: (patch: Partial<SalesFilters>) => void;
  chips: ActiveChip[];
  onClearAll: () => void;
}) {
  const periodValue = choice.kind === "year" ? String(choice.year) : choice.kind;
  const all = choice.kind === "all";

  function pickPeriod(value: string) {
    if (value === "all" || value === "last12") onChoice({ kind: value });
    // Las fechas empiezan siendo las del periodo que se miraba: se corrigen desde ahí.
    else if (value === "range") onChoice({ kind: "range", from: chosen.base.from, to: chosen.base.to });
    else onChoice({ kind: "year", year: Number(value) });
  }
  function pickCompare(value: string) {
    if (value === "range") {
      const start = chosen.baseCompare ?? { from: sameDayYearBefore(chosen.base.from), to: sameDayYearBefore(chosen.base.to) };
      onCompare({ kind: "range", from: start.from, to: start.to });
    } else {
      onCompare({ kind: value as "year" | "previous" | "none" });
    }
  }
  const dateInput = (label: string, value: string, onValue: (next: string) => void) => (
    <label className="sales-filter-date">
      <span>{label}</span>
      <input
        type="date"
        value={value}
        min={minDate ?? undefined}
        max={maxDate}
        // Mientras se escribe la fecha a mano llegan fechas a medias: solo vale una entera.
        onChange={(event) => { if (isDateKey(event.target.value)) onValue(event.target.value); }}
      />
    </label>
  );

  // Qué se compara con qué, dicho con palabras y con las fechas de verdad.
  const summary = (() => {
    const what = rangeLabel(chosen.base.from, chosen.base.to);
    if (all) return `Miras todas las ventas de Sage: ${what}. Sin comparación, porque antes no hay nada.`;
    if (chosen.compare) return `Miras ${what} y lo comparas con ${rangeLabel(chosen.compare.from, chosen.compare.to)}.`;
    if (chosen.compareNote) {
      return `Miras ${what}. El total no se compara (${chosen.compareNote})${chosen.baseCompare ? ", pero mes a mes sí" : ""}.`;
    }
    return `Miras ${what}, sin comparar.`;
  })();

  return (
    <section className="panel sales-filter-bar" aria-label="Filtros del cuadro de mando">
      <div className="sales-filter-fields sales-filter-period">
        <label>
          <span>Periodo</span>
          <select value={periodValue} onChange={(event) => pickPeriod(event.target.value)}>
            {yearOptions.map((value) => <option key={value} value={value}>{value}</option>)}
            <option value="last12">Últimos 12 meses</option>
            <option value="all">Todos los años</option>
            <option value="range">Elegir fechas…</option>
          </select>
        </label>
        {choice.kind === "range" ? (
          <>
            {dateInput("Desde", choice.from, (from) => onChoice({ kind: "range", from, to: choice.to }))}
            {dateInput("Hasta", choice.to, (to) => onChoice({ kind: "range", from: choice.from, to }))}
          </>
        ) : null}
        <label>
          <span>Comparar con</span>
          <select value={all ? "none" : compare.kind} onChange={(event) => pickCompare(event.target.value)} disabled={all}>
            {all ? <option value="none">Nada: no hay nada antes</option> : (
              <>
                <option value="year">Mismo tramo del año anterior</option>
                <option value="previous">Periodo justo anterior</option>
                <option value="range">Otras fechas…</option>
                <option value="none">No comparar</option>
              </>
            )}
          </select>
        </label>
        {!all && compare.kind === "range" ? (
          <>
            {dateInput("Comparar desde", compare.from, (from) => onCompare({ kind: "range", from, to: compare.to }))}
            {dateInput("Hasta", compare.to, (to) => onCompare({ kind: "range", from: compare.from, to }))}
          </>
        ) : null}
      </div>
      <p className="sales-period-summary">{summary}</p>

      <div className="sales-filter-fields">
        <label>
          <span>Mes</span>
          <select value={requested.month ?? ""} onChange={(event) => onChange({ month: event.target.value || null })}>
            <option value="">{choice.kind === "year" ? "Todo el año" : "Todo el periodo"}</option>
            {requested.month && !monthOptions.some((option) => option.value === requested.month) ? <option value={requested.month}>{requested.month}</option> : null}
            {monthOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label>
          <span>Sociedad</span>
          <select value={requested.company ?? ""} onChange={(event) => onChange({ company: event.target.value ? Number(event.target.value) : null })}>
            <option value="">Todas</option>
            {companyOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label>
          <span>Canal</span>
          <select value={requested.channel ?? ""} onChange={(event) => onChange({ channel: event.target.value || null })}>
            <option value="">Todos</option>
            {requested.channel && !channelOptions.includes(requested.channel) ? <option value={requested.channel}>{requested.channel}</option> : null}
            {channelOptions.map((label) => <option key={label} value={label}>{label}</option>)}
          </select>
        </label>
        <label>
          <span>Comercial</span>
          <select value={requested.repKey ?? ""} onChange={(event) => onChange({ repKey: event.target.value || null })}>
            <option value="">Todos</option>
            {requested.repKey && !repOptions.some((option) => option.value === requested.repKey)
              ? <option value={requested.repKey}>{chips.find((chip) => chip.key === "repKey")?.label.replace(/^Comercial: /, "") ?? requested.repKey}</option>
              : null}
            {repOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label>
          <span>Familia</span>
          <select value={requested.family ?? ""} onChange={(event) => onChange({ family: event.target.value || null })}>
            <option value="">Todas</option>
            {familyOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label>
          <span>Fecha que manda</span>
          <select value={basis} onChange={(event) => onBasis(event.target.value as "albaran" | "factura")}>
            <option value="albaran">Albarán</option>
            <option value="factura">Factura</option>
          </select>
        </label>
      </div>

      {chips.length > 0 ? (
        <div className="sales-chips" aria-label="Filtros puestos">
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              className={chip.note ? "sales-chip sales-chip-off" : "sales-chip"}
              onClick={() => onChange({ [chip.key]: null })}
              title={chip.note ?? "Quitar este filtro"}
            >
              {chip.label}{chip.note ? ` · ${chip.note}` : ""}<span aria-hidden="true">×</span>
              <span className="sr-only">Quitar este filtro</span>
            </button>
          ))}
          <button type="button" className="sales-chip sales-chip-clear" onClick={onClearAll}>Quitar todos</button>
        </div>
      ) : (
        <p className="sales-filter-hint">Pulsa un mes, un comercial, un canal o una sociedad en cualquier gráfico para filtrar todo el panel.</p>
      )}
    </section>
  );
}

/** Por qué un filtro puesto no se aplica en la página que se está viendo. */
export function chipNote(dimension: SalesDimension, applies: SalesDimension[], missingHere: boolean): string | null {
  if (missingHere) return "no está en este periodo";
  if (!applies.includes(dimension)) return "no se aplica en esta página";
  return null;
}
