import { formatEuroForPdf, generatePdfReport, type ReportBadge, type ReportColumn, type ReportStat } from "@/lib/pdf-report";
import { leadStatusLabels } from "@/lib/constants";
import { formatDate } from "@/lib/format";
import type { BusinessUnit, Lead, LeadStatus } from "@/lib/types";

const STATUS_COLORS: Record<LeadStatus, ReportBadge> = {
  new: { bg: [219, 234, 254], text: [30, 64, 175] },
  contact_attempt: { bg: [219, 234, 254], text: [30, 64, 175] },
  contacted: { bg: [219, 234, 254], text: [30, 64, 175] },
  offer_sent: { bg: [254, 243, 199], text: [146, 64, 14] },
  interested: { bg: [254, 243, 199], text: [146, 64, 14] },
  won: { bg: [220, 252, 231], text: [22, 101, 52] },
  lost: { bg: [254, 226, 226], text: [153, 27, 27] },
  invalid: { bg: [254, 226, 226], text: [153, 27, 27] },
};

type LeadReportOptions = {
  activeUnitLabel: string;
  totalLeads: number;
  wonCount: number;
  conversionLabel: string;
  wonValue: number;
  leads: Lead[];
  units: BusinessUnit[];
};

export async function exportLeadReportPdf({ activeUnitLabel, totalLeads, wonCount, conversionLabel, wonValue, leads, units }: LeadReportOptions) {
  const unitName = (unitId: string) => units.find((unit) => unit.id === unitId)?.name ?? "—";

  const stats: ReportStat[] = [
    { label: "Leads totales", value: String(totalLeads) },
    { label: "Ganados", value: String(wonCount) },
    { label: "Conversión", value: conversionLabel },
    { label: "Valor ganado", value: formatEuroForPdf(wonValue) },
  ];

  const columns: ReportColumn<Lead>[] = [
    { header: "Fecha", value: (l) => formatDate(l.createdAt), width: 22 },
    { header: "Unidad", value: (l) => unitName(l.businessUnitId), width: 26 },
    { header: "Contacto", value: (l) => l.contactName, width: 28 },
    { header: "Empresa", value: (l) => l.clientCompanyName, width: 28 },
    { header: "Email", value: (l) => l.email, width: 34 },
    { header: "Teléfono", value: (l) => l.phone, width: 24 },
    { header: "Campaña", value: (l) => l.campaign || "General", width: 26 },
    { header: "Estado", value: (l) => leadStatusLabels[l.status], width: 24, align: "center", badge: (l) => STATUS_COLORS[l.status] },
    { header: "Interés", value: (l) => l.productInterest },
    { header: "Fuente", value: (l) => l.source, width: 22 },
    { header: "Valor", value: (l) => (l.saleValue != null ? formatEuroForPdf(l.saleValue) : "—"), width: 26, align: "right" },
  ];

  const generatedAt = new Intl.DateTimeFormat("es-ES", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Madrid" }).format(new Date());

  await generatePdfReport({
    title: "Informe de leads",
    subtitle: `Unidad: ${activeUnitLabel}  ·  Generado el ${generatedAt}  ·  ${leads.length} lead${leads.length === 1 ? "" : "s"}`,
    stats,
    sectionTitle: "Detalle de leads",
    columns,
    rows: leads,
    filename: `informe_leads_${new Date().toISOString().slice(0, 10)}.pdf`,
  });
}
