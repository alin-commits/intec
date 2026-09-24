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
  employee: "Empleado",
  vault_admin: "Admin. de contraseñas",
};

export const CONSULTAS_ROLES: AppRole[] = ["admin", "commercial", "viewer", "direction"];
export const LEADS_ROLES: AppRole[] = ["admin", "commercial", "marketing", "viewer", "direction"];
export const CAMPAIGNS_ROLES: AppRole[] = ["admin", "marketing", "commercial", "viewer", "direction"];
export const RRSS_ROLES: AppRole[] = ["admin", "marketing", "viewer", "direction"];
export const UNITS_ROLES: AppRole[] = ["admin", "viewer"];
export const CARDS_ROLES: AppRole[] = ["admin", "marketing", "it"];
export const CRM_ROLES: AppRole[] = ["admin", "marketing", "commercial", "direction"];
/** Who can send internal notices (avisos) to other users. */
export const ANNOUNCEMENT_SENDER_ROLES: AppRole[] = ["admin", "direction", "marketing", "it"];
export const CRM_EDIT_ROLES: AppRole[] = ["admin", "marketing", "commercial"];
/** Marketing department expenses (apps, subscriptions, one-off spending). */
export const EXPENSES_ROLES: AppRole[] = ["admin", "marketing", "direction"];
export const EXPENSES_EDIT_ROLES: AppRole[] = ["admin", "marketing"];
/** Manages the password vault: permissions and audit log (not access to personal entries). */
export const VAULT_ADMIN_ROLES: AppRole[] = ["vault_admin"];
/** Everyone except the employee role, whose only page is Contraseñas. */
export const DASHBOARD_ROLES: AppRole[] = ["admin", "commercial", "viewer", "it", "marketing", "direction", "vault_admin"];

export const ALL_APP_ROLES: AppRole[] = ["admin", "commercial", "viewer", "it", "marketing", "direction", "employee", "vault_admin"];

/**
 * Los roles del gestor de contraseñas no se reparten desde la pantalla de
 * usuarios: se conceden en Contraseñas → Accesos, que exige ser administrador
 * del gestor. Si no, un administrador de la plataforma podría dárselos a una
 * cuenta suya y llegar al llavero, que es justo lo que se quiere evitar.
 */
export const VAULT_ONLY_ROLES: AppRole[] = ["vault_admin", "employee"];
export const USER_MANAGER_ROLES: AppRole[] = ALL_APP_ROLES.filter((role) => !VAULT_ONLY_ROLES.includes(role));

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

export const inquiryChannelColors: Record<InquiryType, string> = {
  phone: "#0e7490",
  chat: "#6d28d9",
  email_form: "#1d4ed8",
  whatsapp: "#15803d",
  portal_rrss: "#c2410c",
};

export const campaignStatusLabels: Record<CampaignStatus, string> = {
  draft: "Borrador",
  active: "Activa",
  finished: "Finalizada",
  archived: "Archivada",
};

export const saleTypeOrder: SaleType[] = ["oferta", "seguimiento", "pedido", "perdido"];

export const saleTypeLabels: Record<SaleType, string> = {
  oferta: "Oferta",
  seguimiento: "Seguimiento",
  pedido: "Pedido",
  perdido: "Perdido",
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
