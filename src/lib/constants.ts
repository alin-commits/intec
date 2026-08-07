import type {
  AdCampaignStatus,
  AppRole,
  CampaignStatus,
  InquiryType,
  LeadStatus,
  MailingCampaignType,
  SaleType,
  SocialNetwork,
} from "@/lib/types";

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
  marketing: "Marketing",
  direction: "Dirección",
};

export const CONSULTAS_ROLES: AppRole[] = ["admin", "commercial", "viewer", "direction"];
export const LEADS_ROLES: AppRole[] = ["admin", "commercial", "marketing", "viewer", "direction"];
export const CAMPAIGNS_ROLES: AppRole[] = ["admin", "marketing", "commercial", "viewer", "direction"];
export const RRSS_ROLES: AppRole[] = ["admin", "marketing", "viewer", "direction"];

export const ALL_APP_ROLES: AppRole[] = ["admin", "commercial", "viewer", "it", "marketing", "direction"];

/** True if the user holds at least one of the given roles. */
export function hasAnyRole(userRoles: AppRole[], allowed: AppRole[]): boolean {
  return userRoles.some((role) => allowed.includes(role));
}

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

export const saleTypeOrder: SaleType[] = ["oferta", "seguimiento", "pedido"];

export const saleTypeLabels: Record<SaleType, string> = {
  oferta: "Oferta",
  seguimiento: "Seguimiento",
  pedido: "Pedido",
};

export const socialNetworkOrder: SocialNetwork[] = ["facebook", "instagram", "linkedin"];

export const socialNetworkLabels: Record<SocialNetwork, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  linkedin: "LinkedIn",
};

export const adStatusLabels: Record<AdCampaignStatus, string> = {
  active: "Activa",
  paused: "Detenida",
  finished: "Completada",
};

export const mailingTypeOrder: MailingCampaignType[] = [
  "promocion",
  "captacion",
  "aviso",
  "fidelizacion",
  "remarketing",
  "newsletter",
];

export const mailingTypeLabels: Record<MailingCampaignType, string> = {
  promocion: "Promoción",
  captacion: "Captación",
  aviso: "Aviso",
  fidelizacion: "Fidelización",
  remarketing: "Remarketing",
  newsletter: "Newsletter",
};
