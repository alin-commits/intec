import type {
  BusinessUnit,
  Campaign,
  InquiryRecord,
  InquiryType,
  Lead,
  MailingCampaign,
  MetaAdsEntry,
  MonthlyStat,
  Profile,
  SalesEntry,
  SocialMediaStat,
  SocialNetwork,
} from "@/lib/types";

export const businessUnits: BusinessUnit[] = [
  { id: "intec", name: "Suministros Intec", slug: "suministros-intec", accent: "#2563eb", active: true, logo: "/logo-intec.webp", sortOrder: 0, visibleInConsultas: true, visibleInLeads: true },
  { id: "blizzcool", name: "BlizzCool", slug: "blizzcool", accent: "#0891b2", active: true, logo: "/logo-blizzcool.webp", sortOrder: 1, visibleInConsultas: true, visibleInLeads: true },
  { id: "sumifluid", name: "Sumifluid", slug: "sumifluid", accent: "#7c3aed", active: true, logo: "/logo-sumifluid.webp", sortOrder: 2, visibleInConsultas: true, visibleInLeads: true },
  { id: "jender", name: "Jender", slug: "jender", accent: "#ea580c", active: true, logo: "/logo-jender.webp", sortOrder: 3, visibleInConsultas: true, visibleInLeads: true },
  // Marcas sin actividad comercial por ahora: se conservan (histórico de leads/campañas)
  // pero no aparecen en registro de consultas ni en comparativas activas.
  { id: "cst", name: "CST Ibérica", slug: "cst-iberica", accent: "#16a34a", active: false, sortOrder: 4, visibleInConsultas: true, visibleInLeads: true },
  { id: "blizztherm", name: "Blizztherm", slug: "blizztherm", accent: "#dc2626", active: false, sortOrder: 5, visibleInConsultas: true, visibleInLeads: true },
];

const monthKeys = ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"];
const baseByUnit: Record<string, { web: number; phone: number; leads: number; won: number }> = {
  intec: { web: 102, phone: 76, leads: 16, won: 4 },
  blizzcool: { web: 74, phone: 28, leads: 34, won: 6 },
  sumifluid: { web: 42, phone: 38, leads: 12, won: 2 },
  jender: { web: 28, phone: 19, leads: 8, won: 1 },
  cst: { web: 18, phone: 24, leads: 5, won: 1 },
  blizztherm: { web: 22, phone: 16, leads: 7, won: 1 },
};

export const monthlyStats: MonthlyStat[] = businessUnits.filter((unit) => unit.active).flatMap((unit, unitIndex) =>
  monthKeys.map((month, monthIndex) => {
    const base = baseByUnit[unit.id];
    const progression = 0.72 + monthIndex * 0.06 + unitIndex * 0.012;
    const leads = Math.max(1, Math.round(base.leads * progression));
    const won = Math.min(leads, Math.max(0, Math.round(base.won * progression)));
    return {
      month,
      businessUnitId: unit.id,
      web: Math.round(base.web * progression),
      phone: Math.round(base.phone * (0.78 + monthIndex * 0.045)),
      leads,
      won,
      lost: Math.max(0, Math.round(leads * 0.18)),
      saleValue: won * (980 + unitIndex * 170),
    };
  }),
);

function distributeRecords(
  records: InquiryRecord[],
  unitId: string,
  type: InquiryType,
  month: string,
  total: number,
) {
  const [year, monthNumber] = month.split("-").map(Number);
  const calendarDays = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const availableDays = month === "2026-08" ? 5 : calendarDays;
  for (let index = 0; index < total; index += 1) {
    const day = (index % availableDays) + 1;
    const hour = 8 + ((index * 3 + unitId.length) % 10);
    const minute = (index * 7) % 60;
    records.push({
      id: `INQ-${month}-${unitId}-${type}-${index + 1}`,
      businessUnitId: unitId,
      inquiryType: type,
      entryMode: "single",
      weekStart: null,
      count: 1,
      createdAt: new Date(Date.UTC(year, monthNumber - 1, day, hour, minute)).toISOString(),
      createdBy: "demo-admin",
    });
  }
}

// Proportions of the legacy "web" total across the 5 real channels, roughly
// matching the historical spreadsheet (email/whatsapp dominate; chat and
// portals are kept residual so those columns aren't empty in demo mode).
const webChannelWeights: { type: InquiryType; weight: number }[] = [
  { type: "email_form", weight: 0.55 },
  { type: "whatsapp", weight: 0.35 },
  { type: "chat", weight: 0.06 },
  { type: "portal_rrss", weight: 0.04 },
];

export const demoInquiries: InquiryRecord[] = (() => {
  const records: InquiryRecord[] = [];
  for (const row of monthlyStats) {
    const key = row.month;
    const factor = key === "2026-08" ? 0.2 : 1;
    const webTotal = Math.max(1, Math.round(row.web * factor));
    let assigned = 0;
    webChannelWeights.forEach(({ type, weight }, index) => {
      const isLast = index === webChannelWeights.length - 1;
      const count = isLast ? webTotal - assigned : Math.round(webTotal * weight);
      assigned += count;
      if (count > 0) distributeRecords(records, row.businessUnitId, type, key, count);
    });
    distributeRecords(records, row.businessUnitId, "phone", key, Math.max(1, Math.round(row.phone * factor)));
  }
  return records;
})();

// Empty in demo mode: the demo dashboard's "Valor ganado" figure comes from
// the static monthlyStats above, not from recomputing sales entries.
export const demoSalesEntries: SalesEntry[] = [];

export const demoLeads: Lead[] = [
  {
    id: "LD-1042",
    createdAt: "2026-08-05T07:42:00Z",
    updatedAt: "2026-08-05T08:15:00Z",
    businessUnitId: "blizzcool",
    campaignId: "CP-001",
    campaign: "Distribuidores verano",
    contactName: "Laura Méndez",
    clientCompanyName: "Clima Norte",
    email: "laura@example.com",
    phone: "600 123 456",
    location: "Bilbao",
    productInterest: "Climatización industrial",
    status: "offer_sent",
    type: "Distribuidor",
    source: "Web",
    notes: "Solicita condiciones para distribución en la zona norte.",
    saleValue: null,
    statusHistory: [
      { id: "H-1", previousStatus: null, newStatus: "new", changedAt: "2026-08-05T07:42:00Z", changedByName: "Alín" },
      { id: "H-2", previousStatus: "new", newStatus: "contacted", changedAt: "2026-08-05T08:00:00Z", changedByName: "Alín" },
      { id: "H-3", previousStatus: "contacted", newStatus: "offer_sent", changedAt: "2026-08-05T08:15:00Z", changedByName: "Alín" },
    ],
  },
  {
    id: "LD-1041",
    createdAt: "2026-08-04T12:20:00Z",
    updatedAt: "2026-08-05T06:45:00Z",
    businessUnitId: "intec",
    campaignId: "CP-002",
    campaign: "Generadores profesionales",
    contactName: "Miguel Torres",
    clientCompanyName: "Obras del Mediterráneo",
    email: "miguel@example.com",
    phone: "611 987 321",
    location: "Alicante",
    productInterest: "Generador 7 kW",
    status: "won",
    type: "Venta",
    source: "Landing",
    notes: "Pedido confirmado tras revisión de disponibilidad.",
    saleValue: 2840,
    statusHistory: [
      { id: "H-4", previousStatus: null, newStatus: "new", changedAt: "2026-08-04T12:20:00Z", changedByName: "Alín" },
      { id: "H-5", previousStatus: "offer_sent", newStatus: "won", changedAt: "2026-08-05T06:45:00Z", changedByName: "Alín" },
    ],
  },
  {
    id: "LD-1040",
    createdAt: "2026-08-03T09:10:00Z",
    updatedAt: "2026-08-03T10:00:00Z",
    businessUnitId: "sumifluid",
    campaignId: "CP-003",
    campaign: "Soluciones de bombeo",
    contactName: "Ana Robles",
    clientCompanyName: "Mantenimientos A3",
    email: "ana@example.com",
    phone: "622 555 111",
    location: "Valencia",
    productInterest: "Bomba de trasvase",
    status: "contacted",
    type: "Solicitud de oferta",
    source: "Web",
    notes: "Pendiente de recibir datos técnicos de la instalación.",
    saleValue: null,
  },
  {
    id: "LD-1039",
    createdAt: "2026-08-02T15:36:00Z",
    updatedAt: "2026-08-04T11:12:00Z",
    businessUnitId: "cst",
    campaignId: "CP-004",
    campaign: "Mantenimiento industrial",
    contactName: "Pablo Sánchez",
    clientCompanyName: "Talleres Prisma",
    email: "pablo@example.com",
    phone: "633 222 444",
    location: "Murcia",
    productInterest: "Servicio técnico",
    status: "interested",
    type: "Servicio",
    source: "Teléfono",
    notes: "Interesado en contrato anual de mantenimiento.",
    saleValue: null,
  },
  {
    id: "LD-1038",
    createdAt: "2026-08-01T08:05:00Z",
    updatedAt: "2026-08-03T09:30:00Z",
    businessUnitId: "jender",
    campaignId: "CP-005",
    campaign: "Equipamiento verano",
    contactName: "Sara Vidal",
    clientCompanyName: "Centro Deportivo Delta",
    email: "sara@example.com",
    phone: "644 333 777",
    location: "Madrid",
    productInterest: "Ventilación",
    status: "lost",
    type: "Venta",
    source: "RRSS",
    notes: "Descartado por presupuesto insuficiente.",
    saleValue: null,
  },
];

export const campaigns: Campaign[] = [
  { id: "CP-001", businessUnitId: "blizzcool", name: "Distribuidores verano", channel: "Email", startDate: "2026-06-01", endDate: "2026-08-31", status: "active", budget: 4500, notes: "Campaña dirigida a distribuidores del norte peninsular.", directSalesCount: 0, directSaleValue: 0, createdAt: "2026-06-01T08:00:00Z" },
  { id: "CP-002", businessUnitId: "intec", name: "Generadores profesionales", channel: "Landing", startDate: "2026-05-15", endDate: "2026-08-15", status: "active", budget: 6000, notes: "Promoción de generadores para obra e industria.", directSalesCount: 0, directSaleValue: 0, createdAt: "2026-05-15T08:00:00Z" },
  { id: "CP-003", businessUnitId: "sumifluid", name: "Soluciones de bombeo", channel: "Web", startDate: "2026-06-10", endDate: null, status: "active", budget: 2200, notes: null, directSalesCount: 0, directSaleValue: 0, createdAt: "2026-06-10T08:00:00Z" },
  { id: "CP-004", businessUnitId: "cst", name: "Mantenimiento industrial", channel: "Teléfono", startDate: "2026-03-01", endDate: "2026-05-31", status: "finished", budget: 1800, notes: "Contratos anuales de mantenimiento.", directSalesCount: 0, directSaleValue: 0, createdAt: "2026-03-01T08:00:00Z" },
  { id: "CP-005", businessUnitId: "jender", name: "Equipamiento verano", channel: "RRSS", startDate: "2026-05-01", endDate: "2026-07-31", status: "finished", budget: 1200, notes: null, directSalesCount: 0, directSaleValue: 0, createdAt: "2026-05-01T08:00:00Z" },
];

const socialMonthKeys = ["2026-06", "2026-07", "2026-08"];
const socialNetworks: SocialNetwork[] = ["facebook", "instagram", "linkedin"];
const socialBaseByUnit: Record<string, Record<SocialNetwork, number>> = {
  intec: { facebook: 2400, instagram: 3100, linkedin: 1800 },
  blizzcool: { facebook: 1500, instagram: 2600, linkedin: 900 },
  sumifluid: { facebook: 1100, instagram: 1400, linkedin: 1200 },
  jender: { facebook: 800, instagram: 1250, linkedin: 600 },
};

export const demoSocialMediaStats: SocialMediaStat[] = businessUnits.filter((unit) => unit.active).flatMap((unit) =>
  socialNetworks.flatMap((network) =>
    socialMonthKeys.map((month, monthIndex) => {
      const base = socialBaseByUnit[unit.id][network];
      const newFollowers = Math.round(base * 0.015 * (1 + monthIndex * 0.15));
      const followersEnd = base + newFollowers * (monthIndex + 1);
      const interactions = Math.round(followersEnd * 0.018 * (1 + monthIndex * 0.1));
      return {
        id: `SMS-${unit.id}-${network}-${month}`,
        businessUnitId: unit.id,
        network,
        periodMonth: `${month}-01`,
        followersEnd,
        newFollowers,
        posts: 4 + monthIndex + (network === "instagram" ? 3 : 0),
        interactions,
        reach: Math.round(followersEnd * 2.4),
        activeCampaigns: monthIndex === socialMonthKeys.length - 1 ? 1 : 0,
        linkClicks: Math.round(interactions * 0.12),
        leads: Math.round(interactions * 0.02),
        notes: null,
        createdBy: "demo-admin",
        createdAt: `${month}-20T09:00:00Z`,
      };
    }),
  ),
);

export const demoMetaAdsEntries: MetaAdsEntry[] = [
  { id: "ADS-001", businessUnitId: "blizzcool", campaignId: "CP-001", campaignName: "Distribuidores verano", adSet: "Norte peninsular", adName: "Carrusel distribuidores", objective: "Leads", status: "active", startDate: "2026-06-01", endDate: null, amountSpent: 342.5, impressions: 48200, linkClicks: 980, leads: 64, qualifiedLeads: 41, purchases: 9, followersGained: 186, revenue: 5220, notes: null, createdBy: "demo-admin", createdAt: "2026-06-01T09:00:00Z" },
  { id: "ADS-002", businessUnitId: "intec", campaignId: "CP-002", campaignName: "Generadores profesionales", adSet: "Obra e industria", adName: "Vídeo generador 7kW", objective: "Conversiones", status: "active", startDate: "2026-05-15", endDate: null, amountSpent: 410.2, impressions: 61500, linkClicks: 1240, leads: 88, qualifiedLeads: 52, purchases: 14, followersGained: 240, revenue: 8460, notes: null, createdBy: "demo-admin", createdAt: "2026-05-15T09:00:00Z" },
  { id: "ADS-003", businessUnitId: "sumifluid", campaignId: "CP-003", campaignName: "Soluciones de bombeo", adSet: "Mantenimiento industrial", adName: "Imagen bomba trasvase", objective: "Tráfico", status: "paused", startDate: "2026-06-10", endDate: "2026-07-20", amountSpent: 128.9, impressions: 21300, linkClicks: 410, leads: 22, qualifiedLeads: 12, purchases: 2, followersGained: 58, revenue: 980, notes: "Pausada para revisar creatividades.", createdBy: "demo-admin", createdAt: "2026-06-10T09:00:00Z" },
  { id: "ADS-004", businessUnitId: "jender", campaignId: "CP-005", campaignName: "Equipamiento verano", adSet: "Centros deportivos", adName: "Carrusel ventilación", objective: "Leads", status: "finished", startDate: "2026-05-01", endDate: "2026-07-31", amountSpent: 74.87, impressions: 15600, linkClicks: 260, leads: 14, qualifiedLeads: 6, purchases: 1, followersGained: 21, revenue: 320, notes: null, createdBy: "demo-admin", createdAt: "2026-05-01T09:00:00Z" },
];

export const demoMailingCampaigns: MailingCampaign[] = [
  { id: "MAIL-001", businessUnitId: "intec", campaignName: "Newsletter agosto", campaignType: "newsletter", sentDate: "2026-08-01", sentCount: 4200, deliveredCount: 4110, opens: 1150, clicks: 240, leads: 18, salesCount: 3, revenue: 2100, unsubscribes: 12, notes: null, createdBy: "demo-admin", createdAt: "2026-08-01T09:00:00Z" },
  { id: "MAIL-002", businessUnitId: "blizzcool", campaignName: "Promoción verano climatización", campaignType: "promocion", sentDate: "2026-07-15", sentCount: 2800, deliveredCount: 2745, opens: 890, clicks: 210, leads: 26, salesCount: 5, revenue: 3400, unsubscribes: 9, notes: null, createdBy: "demo-admin", createdAt: "2026-07-15T09:00:00Z" },
  { id: "MAIL-003", businessUnitId: "sumifluid", campaignName: "Aviso mantenimiento programado", campaignType: "aviso", sentDate: "2026-07-05", sentCount: 1600, deliveredCount: 1570, opens: 610, clicks: 95, leads: 4, salesCount: 0, revenue: 0, unsubscribes: 3, notes: null, createdBy: "demo-admin", createdAt: "2026-07-05T09:00:00Z" },
  { id: "MAIL-004", businessUnitId: "jender", campaignName: "Captación distribuidores", campaignType: "captacion", sentDate: "2026-06-20", sentCount: 950, deliveredCount: 928, opens: 305, clicks: 58, leads: 9, salesCount: 1, revenue: 640, unsubscribes: 4, notes: null, createdBy: "demo-admin", createdAt: "2026-06-20T09:00:00Z" },
];

export const demoProfiles: Profile[] = [
  { id: "demo-admin", fullName: "Alín", email: "alin@suministrointec.com", roles: ["admin"], isActive: true, createdAt: "2026-08-01T08:00:00Z" },
  { id: "demo-commercial", fullName: "Comercial Web", email: "comercial@suministrointec.com", roles: ["commercial"], isActive: true, createdAt: "2026-08-02T08:00:00Z" },
  { id: "demo-viewer", fullName: "Dirección", email: "direccion@suministrointec.com", roles: ["viewer"], isActive: true, createdAt: "2026-08-03T08:00:00Z" },
];
