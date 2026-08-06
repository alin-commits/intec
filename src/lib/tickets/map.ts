import { monthKey, monthRange } from "@/lib/dates";
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
  resolvedThisMonthCount: number;
  staleOpenCount: number;
};

export function computeTicketDashboardCounts(tickets: Ticket[]): TicketDashboardCounts {
  const now = Date.now();
  const staleThreshold = now - STALE_DAYS * 24 * 60 * 60 * 1000;
  const { start: monthStart, end: monthEnd } = monthRange(monthKey());
  return {
    newCount: tickets.filter((t) => t.status === "new").length,
    openCount: tickets.filter((t) => OPEN_TICKET_STATUSES.includes(t.status)).length,
    inProgressCount: tickets.filter((t) => t.status === "in_progress").length,
    pendingCount: tickets.filter((t) => t.status === "pending").length,
    resolvedThisMonthCount: tickets.filter((t) => t.status === "resolved" && t.resolvedAt && t.resolvedAt >= monthStart && t.resolvedAt < monthEnd).length,
    staleOpenCount: tickets.filter((t) => OPEN_TICKET_STATUSES.includes(t.status) && new Date(t.createdAt).getTime() < staleThreshold).length,
  };
}
