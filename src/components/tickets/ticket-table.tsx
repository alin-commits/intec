import Link from "next/link";
import { ticketCategoryLabels, ticketStatusLabels, ticketStatusOrder } from "@/lib/tickets/constants";
import type { Ticket, TicketStatus } from "@/lib/tickets/types";
import { formatDate } from "@/lib/format";
import { TicketPriorityBadge } from "./ticket-priority-badge";

export type TicketSortColumn = "createdAt" | "priority" | "updatedAt";
export type TicketSortState = { column: TicketSortColumn; direction: "asc" | "desc" };

type TicketTableProps = {
  tickets: Ticket[];
  sort: TicketSortState;
  onSort: (column: TicketSortColumn) => void;
  onQuickStatusChange: (ticket: Ticket, status: TicketStatus) => void;
  quickEditingId: string | null;
};

const sortLabels: Record<TicketSortColumn, string> = {
  createdAt: "Fecha",
  priority: "Prioridad",
  updatedAt: "Última actualización",
};

export function TicketTable({ tickets, sort, onSort, onQuickStatusChange, quickEditingId }: TicketTableProps) {
  function headerCell(column: TicketSortColumn) {
    const arrow = sort.column === column ? (sort.direction === "asc" ? " ↑" : " ↓") : "";
    return <th><button type="button" className="sort-button" onClick={() => onSort(column)}>{sortLabels[column]}{arrow}</button></th>;
  }

  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
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
              <td><strong>{ticket.ticketNumber}</strong></td>
              <td>{formatDate(ticket.createdAt)}</td>
              <td>{ticket.reporterName}</td>
              <td>{ticket.department}</td>
              <td>{ticket.title}</td>
              <td>{ticketCategoryLabels[ticket.category]}</td>
              <td><TicketPriorityBadge priority={ticket.priority} /></td>
              <td>
                <select
                  className={`table-select badge-select badge-ticket-status-${ticket.status}`}
                  value={ticket.status}
                  disabled={quickEditingId === ticket.id}
                  onChange={(event) => onQuickStatusChange(ticket, event.target.value as TicketStatus)}
                >
                  {ticketStatusOrder.map((value) => <option key={value} value={value}>{ticketStatusLabels[value]}</option>)}
                </select>
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
