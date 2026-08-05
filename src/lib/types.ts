export type InquiryType = "web" | "phone";
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
};

export type Lead = {
  id: string;
  createdAt: string;
  businessUnitId: string;
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
  saleValue: number | null;
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
