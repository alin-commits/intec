import { ticketPriorityLabels } from "@/lib/tickets/constants";
import type { TicketPriority } from "@/lib/tickets/types";

export function TicketPriorityBadge({ priority }: { priority: TicketPriority }) {
  return <span className={`badge badge-ticket-priority-${priority}`}>{ticketPriorityLabels[priority]}</span>;
}
