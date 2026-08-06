import type { AppRole, CampaignStatus, InquiryType, LeadStatus } from "@/lib/types";

export const leadStatusLabels: Record<LeadStatus, string> = {
  new: "Nuevo",
  contact_attempt: "Intento de contacto",
  contacted: "Contactado",
  offer_sent: "Oferta enviada",
  interested: "Interesado",
  won: "Ganado",
  lost: "Perdido",
  invalid: "No válido",
};

export const roleLabels: Record<AppRole, string> = {
  admin: "Administrador",
  commercial: "Comercial",
  viewer: "Solo lectura",
  it: "Informática",
};

export const leadTypeLabels = {
  sale: "Venta",
  distributor: "Distribuidor",
  quote_request: "Solicitud de oferta",
  service: "Servicio",
  other: "Otro",
} as const;

export type LeadTypeValue = keyof typeof leadTypeLabels;

export const inquiryChannelOrder: InquiryType[] = ["phone", "chat", "email_form", "whatsapp", "portal_rrss"];

export const inquiryChannelLabels: Record<InquiryType, string> = {
  phone: "Teléfono",
  chat: "Chat",
  email_form: "Email/Formulario",
  whatsapp: "Whatsapp",
  portal_rrss: "Portales/RRSS",
};

export const campaignStatusLabels: Record<CampaignStatus, string> = {
  draft: "Borrador",
  active: "Activa",
  finished: "Finalizada",
  archived: "Archivada",
};
