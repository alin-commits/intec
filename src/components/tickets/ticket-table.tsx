import Link from "next/link";
import { ticketCategoryLabels } from "@/lib/tickets/constants";
import type { Ticket } from "@/lib/tickets/types";
import { formatDate } from "@/lib/format";
import { TicketPriorityBadge } from "./ticket-priority-badge";
import { TicketStatusBadge } from "./ticket-status-badge";

export type TicketSortColumn = "createdAt" | "priority" | "updatedAt";
export type TicketSortState = { column: TicketSortColumn; direction: "asc" | "desc" };

type TicketTableProps = {
  tickets: Ticket[];
  sort: TicketSortState;
  onSort: (column: TicketSortColumn) => void;
};

const sortLabels: Record<TicketSortColumn, string> = {
  createdAt: "Fecha",
  priority: "Prioridad",
  updatedAt: "Última actualización",
};

export function TicketTable({ tickets, sort, onSort }: TicketTableProps) {
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
          </tr>
        </thead>
        <tbody>
          {tickets.map((ticket) => (
            <tr key={ticket.id}>
              <td><Link href={`/tickets/${ticket.id}`} className="sort-button"><strong>{ticket.ticketNumber}</strong></Link></td>
              <td>{formatDate(ticket.createdAt)}</td>
              <td>{ticket.reporterName}</td>
              <td>{ticket.department}</td>
              <td>{ticket.title}</td>
              <td>{ticketCategoryLabels[ticket.category]}</td>
              <td><TicketPriorityBadge priority={ticket.priority} /></td>
              <td><TicketStatusBadge status={ticket.status} /></td>
              <td>{formatDate(ticket.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
