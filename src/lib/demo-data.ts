import type { BusinessUnit, Campaign, InquiryRecord, InquiryType, Lead, MonthlyStat, Profile } from "@/lib/types";

export const businessUnits: BusinessUnit[] = [
  { id: "intec", name: "Suministros Intec", slug: "suministros-intec", accent: "#2563eb", active: true, logo: "/logo-intec.webp" },
  { id: "blizzcool", name: "BlizzCool", slug: "blizzcool", accent: "#0891b2", active: true, logo: "/logo-blizzcool.webp" },
  { id: "sumifluid", name: "Sumifluid", slug: "sumifluid", accent: "#7c3aed", active: true, logo: "/logo-sumifluid.webp" },
  { id: "jender", name: "Jender", slug: "jender", accent: "#ea580c", active: true, logo: "/logo-jender.webp" },
  // Marcas sin actividad comercial por ahora: se conservan (histórico de leads/campañas)
  // pero no aparecen en registro de consultas ni en comparativas activas.
  { id: "cst", name: "CST Ibérica", slug: "cst-iberica", accent: "#16a34a", active: false },
  { id: "blizztherm", name: "Blizztherm", slug: "blizztherm", accent: "#dc2626", active: false },
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
      createdAt: new Date(Date.UTC(year, monthNumber - 1, day, hour, minute)).toISOString(),
      createdBy: "demo-admin",
      saleValue: null,
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

export const demoProfiles: Profile[] = [
  { id: "demo-admin", fullName: "Alín", email: "alin@suministrointec.com", role: "admin", isActive: true, createdAt: "2026-08-01T08:00:00Z" },
  { id: "demo-commercial", fullName: "Comercial Web", email: "comercial@suministrointec.com", role: "commercial", isActive: true, createdAt: "2026-08-02T08:00:00Z" },
  { id: "demo-viewer", fullName: "Dirección", email: "direccion@suministrointec.com", role: "viewer", isActive: true, createdAt: "2026-08-03T08:00:00Z" },
];
