export type TicketCategory = "erp_apps" | "equipment" | "accounts_access" | "network";
export type TicketBlockingLevel = "blocked" | "hindered" | "not_blocked";
export type TicketPriority = "low" | "medium" | "high";
export type TicketStatus = "new" | "in_progress" | "pending" | "resolved" | "closed";
export type TicketNoteType = "internal_note" | "whatsapp_contact" | "call" | "intervention" | "vendor" | "resolution";

export type Ticket = {
  id: string;
  ticketNumber: string;
  reporterName: string;
  reporterPhone: string;
  reporterEmail: string | null;
  department: string;
  title: string;
  category: TicketCategory;
  description: string;
  startedAt: string | null;
  blockingLevel: TicketBlockingLevel;
  restarted: boolean;
  hasErrorMessage: boolean;
  errorMessage: string | null;
  priority: TicketPriority;
  status: TicketStatus;
  attachmentPath: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  closedAt: string | null;
  archivedAt: string | null;
};

export type TicketNote = {
  id: string;
  ticketId: string;
  authorId: string;
  noteType: TicketNoteType;
  content: string;
  createdAt: string;
};

export type TicketEvent = {
  id: string;
  ticketId: string;
  actorId: string | null;
  eventType: string;
  previousValue: string | null;
  newValue: string | null;
  createdAt: string;
};
