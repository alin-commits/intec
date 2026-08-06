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
