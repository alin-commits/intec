import { formatEuroForPdf, generatePdfReport, type ReportBadge, type ReportColumn, type ReportStat } from "@/lib/pdf-report";
import { adStatusLabels, mailingTypeLabels, socialNetworkLabels } from "@/lib/constants";
import { monthLabel } from "@/lib/dates";
import { formatDate } from "@/lib/format";
import type { AdCampaignStatus, BusinessUnit, MailingCampaign, MetaAdsEntry, SocialMediaStat } from "@/lib/types";

const unitName = (units: BusinessUnit[], unitId: string) => units.find((unit) => unit.id === unitId)?.name ?? "—";
const generatedLabel = () => new Intl.DateTimeFormat("es-ES", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Madrid" }).format(new Date());

// --- Social ---

type SocialReportOptions = {
  periodLabel: string;
  totals: { followers: number; newFollowers: number; interactions: number; reach: number };
  rows: SocialMediaStat[];
  units: BusinessUnit[];
};

export async function exportSocialReportPdf({ periodLabel, totals, rows, units }: SocialReportOptions) {
  const stats: ReportStat[] = [
    { label: "Seguidores totales", value: String(totals.followers) },
    { label: "Nuevos seguidores", value: String(totals.newFollowers) },
    { label: "Interacciones", value: String(totals.interactions) },
    { label: "Alcance", value: String(totals.reach) },
  ];
  const columns: ReportColumn<SocialMediaStat>[] = [
    { header: "Mes", value: (r) => monthLabel(r.periodMonth), width: 28 },
    { header: "Marca", value: (r) => unitName(units, r.businessUnitId) },
    { header: "Red", value: (r) => socialNetworkLabels[r.network], width: 24 },
    { header: "Seguidores", value: (r) => String(r.followersEnd), width: 24, align: "center" },
    { header: "Nuevos", value: (r) => String(r.newFollowers), width: 20, align: "center" },
    { header: "Publicaciones", value: (r) => String(r.posts), width: 24, align: "center" },
    { header: "Interacciones", value: (r) => String(r.interactions), width: 24, align: "center" },
    { header: "Alcance", value: (r) => String(r.reach), width: 22, align: "center" },
    { header: "Leads", value: (r) => String(r.leads), width: 18, align: "center" },
  ];
  await generatePdfReport({
    title: "Informe de redes sociales",
    subtitle: `Periodo: ${periodLabel}  ·  Generado el ${generatedLabel()}  ·  ${rows.length} registro${rows.length === 1 ? "" : "s"}`,
    stats,
    sectionTitle: "Detalle por marca y red",
    columns,
    rows,
    filename: `informe_rrss_${new Date().toISOString().slice(0, 10)}.pdf`,
  });
}

// --- Meta Ads ---

const AD_STATUS_COLORS: Record<AdCampaignStatus, ReportBadge | null> = {
  active: { bg: [220, 252, 231], text: [22, 101, 52] },
  paused: { bg: [254, 226, 226], text: [153, 27, 27] },
  finished: null,
};
const DEFAULT_BADGE: ReportBadge = { bg: [241, 245, 249], text: [71, 85, 105] };

type AdsReportOptions = {
  totals: { spend: number; revenue: number; leads: number; followersGained: number };
  cplLabel: string;
  roasLabel: string;
  rows: MetaAdsEntry[];
  units: BusinessUnit[];
};

export async function exportAdsReportPdf({ totals, cplLabel, roasLabel, rows, units }: AdsReportOptions) {
  const stats: ReportStat[] = [
    { label: "Gasto total", value: formatEuroForPdf(totals.spend) },
    { label: "Ingresos", value: formatEuroForPdf(totals.revenue) },
    { label: "Leads", value: String(totals.leads) },
    { label: "Seguidores ganados", value: String(totals.followersGained) },
    { label: "CPL medio", value: cplLabel },
    { label: "ROAS medio", value: roasLabel },
  ];
  const columns: ReportColumn<MetaAdsEntry>[] = [
    { header: "Marca", value: (r) => unitName(units, r.businessUnitId), width: 26 },
    { header: "Campaña", value: (r) => r.campaignName },
    { header: "Estado", value: (r) => adStatusLabels[r.status], width: 20, align: "center", badge: (r) => AD_STATUS_COLORS[r.status] ?? DEFAULT_BADGE },
    { header: "Gasto", value: (r) => formatEuroForPdf(r.amountSpent), width: 24, align: "right" },
    { header: "Impresiones", value: (r) => String(r.impressions), width: 22, align: "center" },
    { header: "Clics", value: (r) => String(r.linkClicks), width: 16, align: "center" },
    { header: "Leads", value: (r) => String(r.leads), width: 16, align: "center" },
    { header: "Cualificados", value: (r) => String(r.qualifiedLeads), width: 20, align: "center" },
    { header: "Compras", value: (r) => String(r.purchases), width: 18, align: "center" },
    { header: "Seguidores", value: (r) => String(r.followersGained), width: 20, align: "center" },
    { header: "Ingresos", value: (r) => formatEuroForPdf(r.revenue), width: 26, align: "right" },
  ];
  await generatePdfReport({
    title: "Informe de Meta Ads",
    subtitle: `Generado el ${generatedLabel()}  ·  ${rows.length} campaña${rows.length === 1 ? "" : "s"}`,
    stats,
    sectionTitle: "Detalle de campañas",
    columns,
    rows,
    filename: `informe_meta_ads_${new Date().toISOString().slice(0, 10)}.pdf`,
  });
}

// --- Mailing ---

type MailingReportOptions = {
  totals: { sent: number; delivered: number; opens: number; revenue: number };
  openRateLabel: string;
  rows: MailingCampaign[];
  units: BusinessUnit[];
};

export async function exportMailingReportPdf({ totals, openRateLabel, rows, units }: MailingReportOptions) {
  const stats: ReportStat[] = [
    { label: "Enviados", value: String(totals.sent) },
    { label: "Entregados", value: String(totals.delivered) },
    { label: "Open rate medio", value: openRateLabel },
    { label: "Ingresos", value: formatEuroForPdf(totals.revenue) },
  ];
  const columns: ReportColumn<MailingCampaign>[] = [
    { header: "Marca", value: (r) => unitName(units, r.businessUnitId), width: 26 },
    { header: "Campaña", value: (r) => r.campaignName },
    { header: "Tipo", value: (r) => mailingTypeLabels[r.campaignType], width: 24 },
    { header: "Fecha", value: (r) => formatDate(r.sentDate), width: 20 },
    { header: "Enviados", value: (r) => String(r.sentCount), width: 20, align: "center" },
    { header: "Entregados", value: (r) => String(r.deliveredCount), width: 20, align: "center" },
    { header: "Aperturas", value: (r) => String(r.opens), width: 20, align: "center" },
    { header: "Clics", value: (r) => String(r.clicks), width: 16, align: "center" },
    { header: "Leads", value: (r) => String(r.leads), width: 16, align: "center" },
    { header: "Ventas", value: (r) => String(r.salesCount), width: 16, align: "center" },
    { header: "Ingresos", value: (r) => formatEuroForPdf(r.revenue), width: 24, align: "right" },
    { header: "Bajas", value: (r) => String(r.unsubscribes), width: 16, align: "center" },
  ];
  await generatePdfReport({
    title: "Informe de email marketing",
    subtitle: `Generado el ${generatedLabel()}  ·  ${rows.length} campaña${rows.length === 1 ? "" : "s"}`,
    stats,
    sectionTitle: "Detalle de campañas",
    columns,
    rows,
    filename: `informe_mailing_${new Date().toISOString().slice(0, 10)}.pdf`,
  });
}
