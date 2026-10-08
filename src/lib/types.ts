export type InquiryType = "phone" | "chat" | "email_form" | "whatsapp" | "portal_rrss";
export type AppRole = "owner" | "admin" | "commercial" | "viewer" | "it" | "marketing" | "direction" | "employee" | "vault_admin" | "accounting";
export type CampaignStatus = "draft" | "active" | "finished" | "archived";
export type LeadStatus =
  | "new"
  | "contact_attempt"
  | "contacted"
  | "offer_sent"
  | "interested"
  | "won"
  | "lost"
  | "invalid";

export type BusinessUnit = {
  id: string;
  name: string;
  slug: string;
  accent: string;
  active: boolean;
  logo?: string | null;
  sortOrder: number;
  visibleInConsultas: boolean;
  visibleInLeads: boolean;
};

export type BusinessCard = {
  id: string;
  businessUnitId: string;
  slug: string;
  fullName: string;
  position: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  companyAddress: string | null;
  instagramUrl: string | null;
  facebookUrl: string | null;
  linkedinUrl: string | null;
  primaryColor: string;
  active: boolean;
  assignedUserId: string | null;
  createdBy: string;
  createdAt: string;
};

export type CrmStatus = "sin_contactar" | "contactado" | "oferta_enviada" | "interesado" | "ganado" | "perdido";

/**
 * El de una consulta: el embudo del CRM con dos escalones propios. "Solo
 * información" para quien pregunta un precio o pide el catálogo sin más, que es
 * la mayoría de las llamadas y no es una oportunidad; y "seguimiento", que aquí
 * sí se usa —se manda la oferta y después se persigue— y en el CRM no. No
 * empieza en "sin contactar": la apunta el comercial que ya la está atendiendo.
 */
export type InquiryStatus = CrmStatus | "seguimiento" | "informacion";

export type CrmContact = {
  id: string;
  businessUnitId: string;
  fullName: string;
  companyName: string | null;
  phone: string | null;
  city: string | null;
  companyEmail: string | null;
  notes: string | null;
  /** De dónde viene: un evento, una feria, la web, una recomendación… */
  origin?: string | null;
  /** En qué punto está: sin contactar, contactado, oferta enviada… */
  status?: CrmStatus;
  /** Cuándo cambió de estado por última vez (lo apunta la base). */
  statusChangedAt?: string | null;
  /** Lo que se le vendió. Se pide al pasarlo a oferta o a ganado, como en un lead. */
  saleValue?: number | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type LeadStatusEvent = {
  id: string;
  previousStatus: LeadStatus | null;
  newStatus: LeadStatus;
  changedAt: string;
  changedBy?: string | null;
  changedByName?: string | null;
};

export type Lead = {
  id: string;
  createdAt: string;
  updatedAt?: string;
  businessUnitId: string;
  campaignId?: string | null;
  campaign: string;
  contactName: string;
  clientCompanyName: string;
  email: string;
  phone: string;
  location: string;
  productInterest: string;
  status: LeadStatus;
  type: string;
  source: string;
  notes?: string;
  saleValue: number | null;
  /** Comerciales que llevan el lead. Vive en lead_assignees, lo pone administración. */
  assignees?: string[];
  statusHistory?: LeadStatusEvent[];
  /** Su registro (lead_log): lo que llegó de Meta, cambios de estado y asignaciones. Nadie lo puede tocar. */
  log?: { id: string; createdAt: string; kind: string; text: string }[];
};

export type Campaign = {
  id: string;
  businessUnitId: string;
  name: string;
  channel: string | null;
  startDate: string | null;
  endDate: string | null;
  status: CampaignStatus;
  budget: number | null;
  notes: string | null;
  directSalesCount: number;
  directSaleValue: number;
  /** Cómo se reparten sus leads entre sus comerciales: a todos o por turnos. */
  leadsAssignMode?: "todos" | "turnos";
  createdAt: string;
  updatedAt?: string;
};

export type InquiryEntryMode = "single" | "weekly";

export type InquiryRecord = {
  id: string;
  businessUnitId: string;
  inquiryType: InquiryType;
  entryMode: InquiryEntryMode;
  weekStart: string | null;
  count: number;
  createdAt: string;
  createdBy?: string | null;
  /* La ficha de quien pregunta. Vacía en las altas semanales, que solo cuentan. */
  contactName?: string | null;
  companyName?: string | null;
  phone?: string | null;
  email?: string | null;
  productInterest?: string | null;
  notes?: string | null;
  /** En qué quedó. El vocabulario del CRM más "seguimiento". */
  status?: InquiryStatus;
  /** Lo que vale la oferta o la venta. El estado decide si se pide. */
  saleValue?: number | null;
};

export type SaleType = "oferta" | "seguimiento" | "pedido" | "perdido";
/** "lead": el apunte de un lead en oferta o ganado; lo lleva el propio lead y aquí no se edita. */
export type SaleEntryMode = "inquiry" | "weekly" | "lead" | "crm";

export type SalesEntry = {
  id: string;
  businessUnitId: string;
  saleType: SaleType;
  entryMode: SaleEntryMode;
  inquiryId: string | null;
  weekStart: string | null;
  occurredOn: string;
  count: number;
  value: number;
  createdBy: string | null;
  createdAt: string;
  /** El lead del que sale, si sale de uno. */
  leadId?: string | null;
  notes?: string | null;
};

export type Profile = {
  id: string;
  fullName: string;
  email?: string | null;
  roles: AppRole[];
  isActive: boolean;
  createdAt?: string;
};

export type MonthlyStat = {
  month: string;
  businessUnitId: string;
  web: number;
  phone: number;
  leads: number;
  won: number;
  lost: number;
  saleValue: number;
};

export type SocialNetwork = "facebook" | "instagram" | "linkedin";

export type SocialMediaStat = {
  id: string;
  businessUnitId: string;
  network: SocialNetwork;
  periodMonth: string;
  followersEnd: number;
  newFollowers: number;
  posts: number;
  interactions: number;
  reach: number;
  activeCampaigns: number;
  linkClicks: number;
  leads: number;
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
};

export type MailingCampaignType =
  | "promocion"
  | "captacion"
  | "aviso"
  | "fidelizacion"
  | "remarketing"
  | "newsletter";

export type MailingCampaign = {
  id: string;
  businessUnitId: string;
  campaignName: string;
  campaignType: MailingCampaignType;
  sentDate: string;
  sentCount: number;
  deliveredCount: number;
  opens: number;
  clicks: number;
  leads: number;
  salesCount: number;
  revenue: number;
  unsubscribes: number;
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
};
