"use client";

import { useState, type ReactNode } from "react";

function FilterIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M3 4.5h14M6 10h8M8.5 15.5h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

type CollapsibleFiltersProps = {
  children: ReactNode;
  hasActiveFilters: boolean;
  onClear: () => void;
  resultCount?: number;
  resultLabel?: string;
  defaultOpen?: boolean;
  /** Lo que va siempre a la vista al final de la barra, como el orden de la lista. */
  barEnd?: ReactNode;
};

export function CollapsibleFilters({ children, hasActiveFilters, onClear, resultCount, resultLabel, defaultOpen = false, barEnd }: CollapsibleFiltersProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="panel filters-collapsible">
      <div className="filters-collapsible-bar">
        <button type="button" className={hasActiveFilters ? "filters-toggle-button active" : "filters-toggle-button"} onClick={() => setOpen((current) => !current)} aria-expanded={open}>
          <FilterIcon />
          Filtros
          {hasActiveFilters ? <span className="filters-toggle-dot" /> : null}
        </button>
        {hasActiveFilters ? <button type="button" className="filters-clear-button" onClick={onClear}>Limpiar filtros</button> : null}
        {resultCount !== undefined ? <div className="filter-summary"><span>{resultLabel ?? "Resultados"}</span><strong>{resultCount}</strong></div> : null}
        {barEnd ? <div className="filters-bar-end">{barEnd}</div> : null}
      </div>
      {open ? <div className="filters-collapsible-body">{children}</div> : null}
    </section>
  );
}
