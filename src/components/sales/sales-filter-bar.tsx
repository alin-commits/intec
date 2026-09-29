"use client";

import { monthLongNames, type SalesFilters } from "@/lib/sales-model";
import type { SalesDimension } from "./sales-context";

/*
  La barra de filtros común a todas las páginas de Ventas. Lo mismo que se
  elige aquí se puede elegir pulsando en los gráficos y las tablas; las
  etiquetas de debajo dicen siempre qué está puesto y se quitan de un clic.
*/

type Option = { value: string; label: string };

export type ActiveChip = { key: keyof SalesFilters; label: string; note: string | null };

export function SalesFilterBar({
  year,
  yearOptions,
  onYear,
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
  year: number;
  yearOptions: number[];
  onYear: (year: number) => void;
  basis: "albaran" | "factura";
  onBasis: (basis: "albaran" | "factura") => void;
  /** Los filtros tal como se eligieron, aunque este año alguno no exista. */
  requested: SalesFilters;
  monthOptions: string[];
  companyOptions: Option[];
  channelOptions: string[];
  repOptions: Option[];
  familyOptions: Option[];
  onChange: (patch: Partial<SalesFilters>) => void;
  chips: ActiveChip[];
  onClearAll: () => void;
}) {
  return (
    <section className="panel sales-filter-bar" aria-label="Filtros del cuadro de mando">
      <div className="sales-filter-fields">
        <label>
          <span>Año</span>
          <select value={year} onChange={(event) => onYear(Number(event.target.value))}>
            {yearOptions.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label>
          <span>Mes</span>
          <select value={requested.month ?? ""} onChange={(event) => onChange({ month: event.target.value || null })}>
            <option value="">Todo el año</option>
            {monthOptions.map((month) => (
              <option key={month} value={month}>{monthLongNames[Number(month.slice(5, 7)) - 1]}</option>
            ))}
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
export function chipNote(dimension: SalesDimension, applies: SalesDimension[], missingThisYear: boolean, year: number): string | null {
  if (missingThisYear) return `no está en ${year}`;
  if (!applies.includes(dimension)) return "no se aplica en esta página";
  return null;
}
