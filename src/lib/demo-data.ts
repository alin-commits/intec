import type { BusinessUnit, Lead, MonthlyStat } from "@/lib/types";

export const businessUnits: BusinessUnit[] = [
  { id: "intec", name: "Suministros Intec", slug: "suministros-intec", accent: "#2563eb", active: true },
  { id: "blizzcool", name: "BlizzCool", slug: "blizzcool", accent: "#0891b2", active: true },
  { id: "sumifluid", name: "Sumifluid", slug: "sumifluid", accent: "#7c3aed", active: true },
  { id: "jender", name: "Jender", slug: "jender", accent: "#ea580c", active: true },
  { id: "cst", name: "CST Ibérica", slug: "cst-iberica", accent: "#16a34a", active: true },
  { id: "blizztherm", name: "Blizztherm", slug: "blizztherm", accent: "#dc2626", active: true },
];

const months = ["Mar", "Abr", "May", "Jun", "Jul", "Ago"];
const baseByUnit: Record<string, { web: number; phone: number; leads: number; won: number }> = {
  intec: { web: 102, phone: 76, leads: 16, won: 4 },
  blizzcool: { web: 74, phone: 28, leads: 34, won: 6 },
  sumifluid: { web: 42, phone: 38, leads: 12, won: 2 },
  jender: { web: 28, phone: 19, leads: 8, won: 1 },
  cst: { web: 18, phone: 24, leads: 5, won: 1 },
  blizztherm: { web: 22, phone: 16, leads: 7, won: 1 },
};

export const monthlyStats: MonthlyStat[] = businessUnits.flatMap((unit, unitIndex) =>
  months.map((month, monthIndex) => {
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

export const demoLeads: Lead[] = [
  {
    id: "LD-1042",
    createdAt: "2026-08-05T07:42:00Z",
    businessUnitId: "blizzcool",
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
    saleValue: null,
  },
  {
    id: "LD-1041",
    createdAt: "2026-08-04T12:20:00Z",
    businessUnitId: "intec",
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
    saleValue: 2840,
  },
  {
    id: "LD-1040",
    createdAt: "2026-08-03T09:10:00Z",
    businessUnitId: "sumifluid",
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
    saleValue: null,
  },
  {
    id: "LD-1039",
    createdAt: "2026-08-02T15:36:00Z",
    businessUnitId: "cst",
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
    saleValue: null,
  },
  {
    id: "LD-1038",
    createdAt: "2026-08-01T08:05:00Z",
    businessUnitId: "jender",
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
    saleValue: null,
  },
];

export const campaigns = [
  { id: "CP-001", name: "Distribuidores verano", businessUnitId: "blizzcool", status: "Activa", leads: 34, won: 6, value: 9140 },
  { id: "CP-002", name: "Generadores profesionales", businessUnitId: "intec", status: "Activa", leads: 16, won: 4, value: 11360 },
  { id: "CP-003", name: "Soluciones de bombeo", businessUnitId: "sumifluid", status: "Activa", leads: 12, won: 2, value: 3260 },
  { id: "CP-004", name: "Mantenimiento industrial", businessUnitId: "cst", status: "Finalizada", leads: 5, won: 1, value: 1460 },
  { id: "CP-005", name: "Equipamiento verano", businessUnitId: "jender", status: "Finalizada", leads: 8, won: 1, value: 980 },
];
