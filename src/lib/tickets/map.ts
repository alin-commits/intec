import type { Ticket, TicketBlockingLevel, TicketCategory, TicketPriority, TicketStatus } from "./types";

export function mapTicketRow(row: Record<string, unknown>): Ticket {
  return {
    id: String(row.id),
    ticketNumber: String(row.ticket_number),
    reporterName: String(row.reporter_name),
    reporterPhone: String(row.reporter_phone),
    reporterEmail: row.reporter_email ? String(row.reporter_email) : null,
    department: String(row.department),
    title: String(row.title),
    category: row.category as TicketCategory,
    description: String(row.description),
    startedAt: row.started_at ? String(row.started_at) : null,
    blockingLevel: row.blocking_level as TicketBlockingLevel,
    restarted: Boolean(row.restarted),
    hasErrorMessage: Boolean(row.has_error_message),
    errorMessage: row.error_message ? String(row.error_message) : null,
    priority: row.priority as TicketPriority,
    status: row.status as TicketStatus,
    resolutionTime: row.resolution_time ? String(row.resolution_time) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    resolvedAt: row.resolved_at ? String(row.resolved_at) : null,
    closedAt: row.closed_at ? String(row.closed_at) : null,
    archivedAt: row.archived_at ? String(row.archived_at) : null,
  };
}

export const OPEN_TICKET_STATUSES: TicketStatus[] = ["new", "in_progress", "pending"];

const STALE_DAYS = 3;

export type TicketDashboardCounts = {
  newCount: number;
  openCount: number;
  inProgressCount: number;
  pendingCount: number;
  resolvedPeriodCount: number;
  resolvedTotalCount: number;
  staleCount: number;
  highPriorityCount: number;
  mediumPriorityCount: number;
  lowPriorityCount: number;
};

function tookTooLong(ticket: Ticket): boolean {
  const staleMs = STALE_DAYS * 24 * 60 * 60 * 1000;
  const createdMs = new Date(ticket.createdAt).getTime();
  if (ticket.resolvedAt) return new Date(ticket.resolvedAt).getTime() - createdMs > staleMs;
  if (OPEN_TICKET_STATUSES.includes(ticket.status)) return Date.now() - createdMs > staleMs;
  return false;
}

/**
 * `scopedTickets` (already narrowed by the page's own filters) is further
 * narrowed by `period` (by `createdAt`) when given. `resolvedTotalCount` is
 * the one fixed lifetime figure, always computed from `lifetimeTickets`
 * (the fully unfiltered set), on purpose ignoring both the period and any
 * other filter.
 */
export function computeTicketDashboardCounts(scopedTickets: Ticket[], period: { start: string; end: string } | undefined, lifetimeTickets: Ticket[]): TicketDashboardCounts {
  const periodTickets = period ? scopedTickets.filter((t) => t.createdAt >= period.start && t.createdAt < period.end) : scopedTickets;
  return {
    newCount: periodTickets.filter((t) => t.status === "new").length,
    openCount: periodTickets.filter((t) => OPEN_TICKET_STATUSES.includes(t.status)).length,
    inProgressCount: periodTickets.filter((t) => t.status === "in_progress").length,
    pendingCount: periodTickets.filter((t) => t.status === "pending").length,
    resolvedPeriodCount: periodTickets.filter((t) => t.status === "resolved").length,
    resolvedTotalCount: lifetimeTickets.filter((t) => t.status === "resolved").length,
    staleCount: periodTickets.filter(tookTooLong).length,
    highPriorityCount: periodTickets.filter((t) => t.priority === "high").length,
    mediumPriorityCount: periodTickets.filter((t) => t.priority === "medium").length,
    lowPriorityCount: periodTickets.filter((t) => t.priority === "low").length,
  };
}
