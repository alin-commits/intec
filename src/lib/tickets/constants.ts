import type { AppRole } from "@/lib/types";
import type { TicketBlockingLevel, TicketCategory, TicketNoteType, TicketPriority, TicketStatus } from "./types";

export const TICKET_MANAGER_ROLES: AppRole[] = ["admin", "it"];
export const TICKET_VIEW_ROLES: AppRole[] = ["admin", "it", "direction"];

export const ticketCategoryLabels: Record<TicketCategory, string> = {
  erp_apps: "ERP y aplicaciones",
  equipment: "Equipos y periféricos",
  accounts_access: "Usuarios, correo y accesos",
  network: "Internet y comunicaciones",
};

export const ticketCategoryOrder: TicketCategory[] = ["erp_apps", "equipment", "accounts_access", "network"];

export const ticketBlockingLevelLabels: Record<TicketBlockingLevel, string> = {
  blocked: "Me impide trabajar completamente",
  hindered: "Me dificulta trabajar, pero puedo continuar",
  not_blocked: "No me impide trabajar",
};

export const ticketBlockingLevelOrder: TicketBlockingLevel[] = ["blocked", "hindered", "not_blocked"];

export const ticketPriorityLabels: Record<TicketPriority, string> = {
  high: "Alta",
  medium: "Media",
  low: "Baja",
};

export const ticketPriorityOrder: TicketPriority[] = ["high", "medium", "low"];

export const ticketStatusLabels: Record<TicketStatus, string> = {
  new: "Nuevo",
  in_progress: "En curso",
  pending: "Pendiente",
  resolved: "Resuelto",
  closed: "Cerrado",
};

export const ticketStatusOrder: TicketStatus[] = ["new", "in_progress", "pending", "resolved", "closed"];

export const ticketNoteTypeLabels: Record<TicketNoteType, string> = {
  internal_note: "Nota interna",
  whatsapp_contact: "Contacto por WhatsApp",
  call: "Llamada",
  intervention: "Intervención",
  vendor: "Proveedor",
  resolution: "Resolución",
};

export const ticketNoteTypeOrder: TicketNoteType[] = ["internal_note", "whatsapp_contact", "call", "intervention", "vendor", "resolution"];

export function priorityFromBlockingLevel(level: TicketBlockingLevel): TicketPriority {
  if (level === "blocked") return "high";
  if (level === "hindered") return "medium";
  return "low";
}
