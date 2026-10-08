import type {
  CrmStatus,
  InquiryStatus,
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
  owner: "Propietario",
  admin: "Administrador",
  commercial: "Comercial",
  viewer: "Solo lectura",
  it: "Informática",
  marketing: "Marketing",
  direction: "Dirección",
  employee: "Empleado",
  vault_admin: "Admin. de contraseñas",
  accounting: "Administración",
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
/**
 * Quién decide qué comercial lleva cada lead. Los comerciales no: ven el
 * responsable, pero no lo tocan. Tiene que cuadrar con la política
 * lead_assignees_write de la base de datos.
 */
export const LEAD_ASSIGN_ROLES: AppRole[] = ["admin", "marketing"];
/** Marketing department expenses (apps, subscriptions, one-off spending). */
export const EXPENSES_ROLES: AppRole[] = ["admin", "marketing", "direction"];
/** Las ventas que llegan de Sage: cifras de negocio, solo dirección y administración. */
export const SALES_ROLES: AppRole[] = ["admin", "direction"];
/** El cuadrante de horarios: lo lleva administración, dirección solo lo mira. */
export const SCHEDULE_ROLES: AppRole[] = ["admin", "accounting"];
export const SCHEDULE_EDIT_ROLES: AppRole[] = ["admin", "accounting"];
/**
 * Pagos a proveedores (confirming, tesorería, contratos con los bancos): del
 * departamento de Administración y de quien administra la plataforma. Dirección
 * no entra. Tiene que cuadrar con las políticas de 202609290012.
 */
export const PAYMENTS_ROLES: AppRole[] = ["admin", "owner", "accounting"];
/** Quién puede pedir una lectura de Sage con el botón: los que ven Ventas o Pagos. */
export const SAGE_REFRESH_ROLES: AppRole[] = ["admin", "direction", "accounting"];
export const EXPENSES_EDIT_ROLES: AppRole[] = ["admin", "marketing"];
/** Manages the password vault: permissions and audit log (not access to personal entries). */
export const VAULT_ADMIN_ROLES: AppRole[] = ["vault_admin"];
/** Everyone except the employee role, whose only page is Contraseñas. */
export const DASHBOARD_ROLES: AppRole[] = ["admin", "commercial", "viewer", "it", "marketing", "direction", "vault_admin"];

export const ALL_APP_ROLES: AppRole[] = ["owner", "admin", "commercial", "viewer", "it", "marketing", "direction", "accounting", "employee", "vault_admin"];

/**
 * Los roles del gestor de contraseñas no se reparten desde la pantalla de
 * usuarios: se conceden en Contraseñas → Accesos, que exige ser administrador
 * del gestor. Si no, un administrador de la plataforma podría dárselos a una
 * cuenta suya y llegar al llavero, que es justo lo que se quiere evitar.
 */
export const VAULT_ONLY_ROLES: AppRole[] = ["vault_admin", "employee"];
/**
 * El propietario no se reparte desde la pantalla de Usuarios: no es un permiso
 * que se conceda, es quién manda en la casa. Se pone desde la base y solo otro
 * propietario puede moverlo, así que ni se ofrece como opción.
 */
export const UNASSIGNABLE_ROLES: AppRole[] = ["owner"];
export const USER_MANAGER_ROLES: AppRole[] = ALL_APP_ROLES.filter(
  (role) => !VAULT_ONLY_ROLES.includes(role) && !UNASSIGNABLE_ROLES.includes(role),
);

/** True if the user holds at least one of the given roles. */
/**
 * El propietario pasa por todas partes. Va aquí y no en cada lista de roles
 * para que una pantalla nueva no se le quede cerrada por olvido; la base de
 * datos hace lo mismo en current_user_has_any_role(), así que las dos mitades
 * dicen lo mismo.
 */
export function hasAnyRole(userRoles: AppRole[], allowed: AppRole[]): boolean {
  if (userRoles.includes("owner")) return true;
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

/*
  En qué punto está un contacto, una consulta o un lead. Es el mismo embudo
  visto desde tres puertas distintas —una campaña, una llamada, una feria—, así
  que el vocabulario se escribe una sola vez y lo usan las tres pantallas. Los
  colores son los de los estados equivalentes de un lead, para que una "oferta
  enviada" se vea igual en todas partes.
*/
export const contactStatusLabels: Record<InquiryStatus, string> = {
  sin_contactar: "Sin contactar",
  contactado: "Contactado",
  oferta_enviada: "Oferta enviada",
  seguimiento: "Seguimiento",
  interesado: "Interesado",
  ganado: "Ganado",
  perdido: "Perdido",
};

export const contactStatusBadges: Record<InquiryStatus, string> = {
  sin_contactar: "new",
  contactado: "contacted",
  oferta_enviada: "offer_sent",
  seguimiento: "interested",
  interesado: "interested",
  ganado: "won",
  perdido: "lost",
};

/** El orden en que se avanza, para el CRM. */
export const crmStatusOrder: CrmStatus[] = ["sin_contactar", "contactado", "oferta_enviada", "interesado", "ganado", "perdido"];

/**
 * El de las consultas no empieza en "sin contactar": la consulta la apunta el
 * comercial que ya la está atendiendo, no entra sola a una bandeja esperando.
 */
export const inquiryStatusOrder: InquiryStatus[] = ["contactado", "oferta_enviada", "seguimiento", "interesado", "ganado", "perdido"];

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
