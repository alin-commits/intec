import { formatEuroForPdf, generatePdfReport, type ReportBadge, type ReportColumn, type ReportStat } from "@/lib/pdf-report";
import { campaignStatusLabels } from "@/lib/constants";
import { formatDate } from "@/lib/format";
import type { CampaignStatus } from "@/lib/types";

const STATUS_COLORS: Record<CampaignStatus, ReportBadge | null> = {
  active: { bg: [220, 252, 231], text: [22, 101, 52] },
  archived: { bg: [254, 226, 226], text: [153, 27, 27] },
  draft: null,
  finished: null,
};
const DEFAULT_BADGE: ReportBadge = { bg: [241, 245, 249], text: [71, 85, 105] };

export type CampaignReportRow = {
  unitName: string;
  name: string;
  channel: string | null;
  status: CampaignStatus;
  startDate: string | null;
  endDate: string | null;
  budget: number | null;
  leadsTotal: number;
  leadsWon: number;
  conversion: number;
  value: number;
  adsSpend: number;
  adsRevenue: number;
};

const eur = formatEuroForPdf;

const COLUMNS: ReportColumn<CampaignReportRow>[] = [
  { header: "Unidad", value: (r) => r.unitName, width: 22 },
  { header: "Nombre", value: (r) => r.name },
  { header: "Canal", value: (r) => r.channel ?? "—", width: 20 },
  { header: "Estado", value: (r) => campaignStatusLabels[r.status], width: 18, align: "center", badge: (r) => STATUS_COLORS[r.status] ?? DEFAULT_BADGE },
  { header: "Inicio", value: (r) => (r.startDate ? formatDate(r.startDate) : "—"), width: 18 },
  { header: "Fin", value: (r) => (r.endDate ? formatDate(r.endDate) : "—"), width: 18 },
  { header: "Presupuesto", value: (r) => (r.budget != null ? eur(r.budget) : "—"), width: 22, align: "right" },
  { header: "Leads", value: (r) => String(r.leadsTotal), width: 14, align: "center" },
  { header: "Ganados", value: (r) => String(r.leadsWon), width: 16, align: "center" },
  { header: "Conv. (%)", value: (r) => r.conversion.toFixed(1).replace(".", ","), width: 16, align: "center" },
  { header: "Valor total", value: (r) => eur(r.value), width: 21, align: "right" },
  { header: "Gasto Ads", value: (r) => eur(r.adsSpend), width: 18, align: "right" },
  { header: "Ingresos Ads", value: (r) => eur(r.adsRevenue), width: 20, align: "right" },
];

type CampaignReportOptions = {
  totalLeads: number;
  totalWon: number;
  totalValue: number;
  totalAdsSpend: number;
  totalAdsRevenue: number;
  rows: CampaignReportRow[];
};

export async function exportCampaignReportPdf({ totalLeads, totalWon, totalValue, totalAdsSpend, totalAdsRevenue, rows }: CampaignReportOptions) {
  const stats: ReportStat[] = [
    { label: "Campañas", value: String(rows.length) },
    { label: "Leads totales", value: String(totalLeads) },
    { label: "Ganados", value: String(totalWon) },
    { label: "Valor total", value: eur(totalValue) },
    { label: "Gasto Meta Ads", value: eur(totalAdsSpend) },
    { label: "Ingresos Meta Ads", value: eur(totalAdsRevenue) },
  ];

  const generatedAt = new Intl.DateTimeFormat("es-ES", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Madrid" }).format(new Date());

  await generatePdfReport({
    title: "Informe de campañas",
    subtitle: `Generado el ${generatedAt}  ·  ${rows.length} campaña${rows.length === 1 ? "" : "s"}`,
    stats,
    sectionTitle: "Detalle de campañas",
    columns: COLUMNS,
    rows,
    filename: `informe_campanas_${new Date().toISOString().slice(0, 10)}.pdf`,
  });
}
