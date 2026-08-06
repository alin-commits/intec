import { ticketCategoryLabels, ticketCategoryOrder, ticketPriorityLabels, ticketPriorityOrder, ticketStatusLabels, ticketStatusOrder } from "@/lib/tickets/constants";
import type { TicketCategory, TicketPriority, TicketStatus } from "@/lib/tickets/types";

export type TicketFilterState = {
  query: string;
  status: TicketStatus | "all";
  priority: TicketPriority | "all";
  category: TicketCategory | "all";
  department: string;
  dateFrom: string;
  dateTo: string;
  onlyOpen: boolean;
};

export function blankTicketFilters(): TicketFilterState {
  return { query: "", status: "all", priority: "all", category: "all", department: "all", dateFrom: "", dateTo: "", onlyOpen: false };
}

type TicketFiltersProps = {
  filters: TicketFilterState;
  departments: string[];
  resultCount: number;
  onChange: (next: TicketFilterState) => void;
};

export function TicketFilters({ filters, departments, resultCount, onChange }: TicketFiltersProps) {
  function set<K extends keyof TicketFilterState>(key: K, value: TicketFilterState[K]) {
    onChange({ ...filters, [key]: value });
  }

  return (
    <section className="panel filter-bar ticket-filters">
      <label><span>Buscar</span><input value={filters.query} onChange={(event) => set("query", event.target.value)} placeholder="Nº ticket, nombre, teléfono, título…" /></label>
      <label><span>Estado</span>
        <select value={filters.status} onChange={(event) => set("status", event.target.value as TicketStatus | "all")}>
          <option value="all">Todos</option>
          {ticketStatusOrder.map((value) => <option key={value} value={value}>{ticketStatusLabels[value]}</option>)}
        </select>
      </label>
      <label><span>Prioridad</span>
        <select value={filters.priority} onChange={(event) => set("priority", event.target.value as TicketPriority | "all")}>
          <option value="all">Todas</option>
          {ticketPriorityOrder.map((value) => <option key={value} value={value}>{ticketPriorityLabels[value]}</option>)}
        </select>
      </label>
      <label><span>Categoría</span>
        <select value={filters.category} onChange={(event) => set("category", event.target.value as TicketCategory | "all")}>
          <option value="all">Todas</option>
          {ticketCategoryOrder.map((value) => <option key={value} value={value}>{ticketCategoryLabels[value]}</option>)}
        </select>
      </label>
      <label><span>Departamento</span>
        <select value={filters.department} onChange={(event) => set("department", event.target.value)}>
          <option value="all">Todos</option>
          {departments.map((department) => <option key={department} value={department}>{department}</option>)}
        </select>
      </label>
      <label><span>Desde</span><input type="date" value={filters.dateFrom} onChange={(event) => set("dateFrom", event.target.value)} /></label>
      <label><span>Hasta</span><input type="date" value={filters.dateTo} onChange={(event) => set("dateTo", event.target.value)} /></label>
      <label className="ticket-filters-toggle"><span>Solo abiertos</span>
        <input type="checkbox" checked={filters.onlyOpen} onChange={(event) => set("onlyOpen", event.target.checked)} />
      </label>
      <div className="filter-summary"><span>Resultados</span><strong>{resultCount} tickets</strong></div>
    </section>
  );
}
