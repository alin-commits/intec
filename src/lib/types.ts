export type InquiryType = "phone" | "chat" | "email_form" | "whatsapp" | "portal_rrss";
export type AppRole = "admin" | "commercial" | "viewer" | "it";
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
  createdAt: string;
  updatedAt?: string;
};

export type InquiryRecord = {
  id: string;
  businessUnitId: string;
  inquiryType: InquiryType;
  createdAt: string;
  createdBy?: string | null;
  saleValue: number | null;
};

export type Profile = {
  id: string;
  fullName: string;
  email?: string | null;
  role: AppRole;
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
