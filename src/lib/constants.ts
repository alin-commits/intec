import type {
  CrmStatus,
  InquiryStatus,
  AppRole,
  CampaignStatus,
  InquiryType,
  LeadStatus,
  LossReason,
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
  purchasing: "Compras",
  agency: "Agencia",
};

export const CONSULTAS_ROLES: AppRole[] = ["admin", "commercial", "viewer", "direction", "agency"];

/*
  Quién puede tocar las consultas, y no solo verlas.

  La agencia de fuera entra a mirar lo que llega a los comerciales y no tiene
  por qué poder cambiarlo. La base ya lo impide —sus políticas de escritura
  exigen admin o commercial—, pero la pantalla tiene que saberlo también:
  enseñar botones que van a fallar es peor que no enseñarlos.
*/
export const CONSULTAS_EDIT_ROLES: AppRole[] = ["admin", "commercial"];

/**
 * Catálogos: los mismos que ya ven los artículos y los precios en Sage.
 *
 * Las tarifas de proveedor son precios de compra, pero dirección confirmó que
 * los comerciales ya los ven en Sage, así que el chat no abre ninguna puerta
 * que no estuviera abierta.
 */
export const CATALOGOS_ROLES: AppRole[] = ["admin", "direction", "commercial", "purchasing"];
export const LEADS_ROLES: AppRole[] = ["admin", "commercial", "marketing", "viewer", "direction"];
/** Compras: de momento quien ya ve lo de Sage. Si acaba siendo su propio rol, se añade aquí. */
export const COMPRAS_ROLES: AppRole[] = ["admin", "direction", "purchasing"];
/**
 * A quién NO le sale el aviso de compras aunque tenga el rol.
 *
 * Quien administra la plataforma o lleva dirección suele tener también el rol
 * de compras para poder entrar a la pantalla. Si con tenerlo bastara, el aviso
 * les saldría cada vez que abren cualquier página, por un trabajo que no es
 * suyo, y en dos días nadie lo lee. Así que estos roles mandan sobre el otro.
 */
export const AVISO_COMPRAS_NO_ROLES: AppRole[] = ["owner", "admin", "direction"];

/** Si a alguien le toca el aviso de entrada de compras. */
export function leTocaElAvisoDeCompras(roles: AppRole[]): boolean {
  return hasAnyRole(roles, ["purchasing"]) && !hasAnyRole(roles, AVISO_COMPRAS_NO_ROLES);
}
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
/**
 * Quién puede pedir una lectura de Sage con el botón.
 *
 * Los que ven Ventas o Pagos, y compras: su pantalla vive de lo que trae el
 * agente y son los que notan que falta un pedido recién metido en Sage. El
 * tope de una lectura por hora lo pone el servidor para toda la casa, así que
 * añadir gente aquí no añade lecturas.
 */
export const SAGE_REFRESH_ROLES: AppRole[] = ["admin", "direction", "accounting", "purchasing"];
export const EXPENSES_EDIT_ROLES: AppRole[] = ["admin", "marketing"];
/**
 * Agencia: lo que se invierte en ella frente a lo que venden las consultas.
 * Tiene que cuadrar con las políticas de agency_budget_lines y con
 * agency_inquiry_summary en la base de datos.
 */
export const AGENCIA_ROLES: AppRole[] = ["admin", "marketing", "direction"];
export const AGENCIA_EDIT_ROLES: AppRole[] = ["admin", "marketing"];
/** Manages the password vault: permissions and audit log (not access to personal entries). */
export const VAULT_ADMIN_ROLES: AppRole[] = ["vault_admin"];
/** Everyone except the employee role, whose only page is Contraseñas. */
export const DASHBOARD_ROLES: AppRole[] = ["admin", "commercial", "viewer", "it", "marketing", "direction", "vault_admin"];

export const ALL_APP_ROLES: AppRole[] = ["owner", "admin", "commercial", "viewer", "it", "marketing", "direction", "accounting", "purchasing", "employee", "vault_admin", "agency"];
/*
  Quién alcanza el gestor de contraseñas.

  Era «cualquiera con cuenta», porque lo que se ve dentro se decide credencial
  a credencial. Con la agencia eso deja de valer: es gente de fuera de la casa
  y no tiene por qué ver ni la puerta. Se construye quitando, para que un rol
  que se cree mañana siga entrando como hasta ahora y solo haya que pensarlo
  cuando se quiera dejar a alguien fuera.
*/
export const CONTRASENAS_ROLES: AppRole[] = ALL_APP_ROLES.filter((rol) => rol !== "agency");

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
  informacion: "Solo información",
  sin_contactar: "Sin contactar",
  contactado: "Contactado",
  oferta_enviada: "Oferta enviada",
  seguimiento: "Seguimiento",
  interesado: "Interesado",
  ganado: "Ganado",
  perdido: "Perdido",
};

export const contactStatusBadges: Record<InquiryStatus, string> = {
  informacion: "contact_attempt",
  sin_contactar: "new",
  contactado: "contacted",
  oferta_enviada: "offer_sent",
  seguimiento: "interested",
  interesado: "interested",
  ganado: "won",
  perdido: "lost",
};

/*
  Los motivos de pérdida, una lista para leads y otra para consultas, y en el
  orden en que se ofrecen: primero los que dependen de nosotros —precio,
  plazo, stock, condiciones—, que son los que se pueden arreglar, y después
  los del cliente. «Otro» al final, y pide escribir cuál, porque un «otro» sin
  explicar no le dice nada a nadie.

  Separadas porque se pierden por cosas distintas. Un lead llega de un
  anuncio: muchas veces solo quería saber un precio, o deja de contestar, y
  ahí no hay stock ni condiciones de pago de los que hablar. Una consulta es
  alguien que ya pidió algo concreto, y se pierde por precio, por plazo o
  porque no lo tenemos. La base admite en cada tabla solo los suyos.
*/
export const leadLossReasonOrder: LossReason[] = ["precio", "plazo", "competencia", "no_encaja", "sin_presupuesto", "solo_informacion", "no_contesta", "otro"];
export const inquiryLossReasonOrder: LossReason[] = ["precio", "plazo", "competencia", "sin_stock", "condiciones", "sin_presupuesto", "no_encaja", "no_contesta", "otro"];

export const lossReasonLabels: Record<LossReason, string> = {
  precio: "Precio",
  plazo: "Plazo de entrega",
  competencia: "Se fue con la competencia",
  sin_stock: "No lo tenemos o sin stock",
  condiciones: "Condiciones de pago",
  sin_presupuesto: "Sin presupuesto o lo aplaza",
  no_encaja: "No es lo que necesitaba",
  solo_informacion: "Solo quería información",
  no_contesta: "Dejó de contestar",
  otro: "Otro motivo",
};

/** El orden en que se avanza, para el CRM. */
export const crmStatusOrder: CrmStatus[] = ["sin_contactar", "contactado", "oferta_enviada", "interesado", "ganado", "perdido"];

/**
 * El de las consultas no empieza en "sin contactar": la consulta la apunta el
 * comercial que ya la está atendiendo, no entra sola a una bandeja esperando.
 */
export const inquiryStatusOrder: InquiryStatus[] = ["informacion", "contactado", "oferta_enviada", "seguimiento", "interesado", "ganado", "perdido"];

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
