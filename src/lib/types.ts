export type InquiryType = "phone" | "chat" | "email_form" | "whatsapp" | "portal_rrss";
export type AppRole = "admin" | "commercial" | "viewer" | "it" | "marketing" | "direction";
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
};

export type LeadStatusEvent = {
  id: string;
  previousStatus: LeadStatus | null;
  newStatus: LeadStatus;
  changedAt: string;
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
  statusHistory?: LeadStatusEvent[];
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
  createdAt: string;
  updatedAt?: string;
};

export type InquiryRecord = {
  id: string;
  businessUnitId: string;
  inquiryType: InquiryType;
  createdAt: string;
  createdBy?: string | null;
};

export type SaleType = "oferta" | "seguimiento" | "pedido";
export type SaleEntryMode = "inquiry" | "weekly";

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

export type AdCampaignStatus = "active" | "paused" | "finished";

export type MetaAdsEntry = {
  id: string;
  businessUnitId: string;
  campaignName: string;
  adSet: string | null;
  adName: string | null;
  objective: string | null;
  status: AdCampaignStatus;
  startDate: string | null;
  endDate: string | null;
  amountSpent: number;
  impressions: number;
  linkClicks: number;
  leads: number;
  qualifiedLeads: number;
  purchases: number;
  revenue: number;
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
