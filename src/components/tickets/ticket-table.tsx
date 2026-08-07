import Link from "next/link";
import { ticketCategoryLabels, ticketStatusLabels, ticketStatusOrder } from "@/lib/tickets/constants";
import type { Ticket, TicketStatus } from "@/lib/tickets/types";
import { formatDate } from "@/lib/format";
import { TicketPriorityBadge } from "./ticket-priority-badge";
import { TicketStatusBadge } from "./ticket-status-badge";

export type TicketSortColumn = "createdAt" | "priority" | "updatedAt";
export type TicketSortState = { column: TicketSortColumn; direction: "asc" | "desc" };

type TicketTableProps = {
  tickets: Ticket[];
  sort: TicketSortState;
  onSort: (column: TicketSortColumn) => void;
  onQuickStatusChange: (ticket: Ticket, status: TicketStatus) => void;
  quickEditingId: string | null;
  canManage: boolean;
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
  onToggleSelectAll?: () => void;
};

const sortLabels: Record<TicketSortColumn, string> = {
  createdAt: "Fecha",
  priority: "Prioridad",
  updatedAt: "Última actualización",
};

export function TicketTable({ tickets, sort, onSort, onQuickStatusChange, quickEditingId, canManage, selectedIds, onToggleSelect, onToggleSelectAll }: TicketTableProps) {
  const selectable = canManage && Boolean(selectedIds && onToggleSelect && onToggleSelectAll);
  const allSelected = selectable && tickets.length > 0 && tickets.every((ticket) => selectedIds!.has(ticket.id));

  function headerCell(column: TicketSortColumn) {
    const arrow = sort.column === column ? (sort.direction === "asc" ? " ↑" : " ↓") : "";
    return <th><button type="button" className="sort-button" onClick={() => onSort(column)}>{sortLabels[column]}{arrow}</button></th>;
  }

  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {selectable ? <th><input type="checkbox" checked={allSelected} onChange={onToggleSelectAll} aria-label="Seleccionar todos" /></th> : null}
            <th>Nº ticket</th>
            {headerCell("createdAt")}
            <th>Trabajador</th>
            <th>Departamento</th>
            <th>Título</th>
            <th>Categoría</th>
            {headerCell("priority")}
            <th>Estado</th>
            {headerCell("updatedAt")}
            <th></th>
          </tr>
        </thead>
        <tbody>
          {tickets.map((ticket) => (
            <tr key={ticket.id}>
              {selectable ? <td><input type="checkbox" checked={selectedIds!.has(ticket.id)} onChange={() => onToggleSelect!(ticket.id)} aria-label={`Seleccionar ${ticket.ticketNumber}`} /></td> : null}
              <td><strong>{ticket.ticketNumber}</strong></td>
              <td>{formatDate(ticket.createdAt)}</td>
              <td>{ticket.reporterName}</td>
              <td>{ticket.department}</td>
              <td>{ticket.title}</td>
              <td>{ticketCategoryLabels[ticket.category]}</td>
              <td><TicketPriorityBadge priority={ticket.priority} /></td>
              <td>
                {canManage ? (
                  <select
                    className={`table-select badge-select badge-ticket-status-${ticket.status}`}
                    value={ticket.status}
                    disabled={quickEditingId === ticket.id}
                    onChange={(event) => onQuickStatusChange(ticket, event.target.value as TicketStatus)}
                  >
                    {ticketStatusOrder.map((value) => <option key={value} value={value}>{ticketStatusLabels[value]}</option>)}
                  </select>
                ) : <TicketStatusBadge status={ticket.status} />}
              </td>
              <td>{formatDate(ticket.updatedAt)}</td>
              <td><Link href={`/tickets/${ticket.id}`} className="button button-compact button-secondary">Ver</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
