import { ticketStatusLabels } from "@/lib/tickets/constants";
import type { TicketStatus } from "@/lib/tickets/types";

export function TicketStatusBadge({ status }: { status: TicketStatus }) {
  return <span className={`badge badge-ticket-status-${status}`}>{ticketStatusLabels[status]}</span>;
}
