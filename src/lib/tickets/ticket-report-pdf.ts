import { formatDate } from "@/lib/format";
import { generatePdfReport, type ReportBadge, type ReportColumn, type ReportStat } from "@/lib/pdf-report";
import { ticketCategoryLabels, ticketPriorityLabels, ticketStatusLabels } from "./constants";
import type { TicketDashboardCounts } from "./map";
import type { Ticket } from "./types";

const PRIORITY_COLORS: Record<Ticket["priority"], ReportBadge> = {
  high: { bg: [254, 226, 226], text: [153, 27, 27] },
  medium: { bg: [254, 243, 199], text: [146, 64, 14] },
  low: { bg: [241, 245, 249], text: [71, 85, 105] },
};

const STATUS_COLORS: Record<Ticket["status"], ReportBadge> = {
  new: { bg: [219, 234, 254], text: [30, 64, 175] },
  in_progress: { bg: [254, 243, 199], text: [146, 64, 14] },
  pending: { bg: [237, 233, 254], text: [109, 40, 217] },
  resolved: { bg: [220, 252, 231], text: [22, 101, 52] },
  closed: { bg: [241, 245, 249], text: [71, 85, 105] },
};

const COLUMNS: ReportColumn<Ticket>[] = [
  { header: "Nº", value: (t) => t.ticketNumber, width: 16 },
  { header: "Fecha", value: (t) => formatDate(t.createdAt), width: 20 },
  { header: "Solicitante", value: (t) => t.reporterName, width: 24 },
  { header: "Departamento", value: (t) => t.department, width: 20 },
  { header: "Título", value: (t) => t.title, width: 32 },
  { header: "Descripción", value: (t) => t.description || "—" },
  { header: "Categoría", value: (t) => ticketCategoryLabels[t.category], width: 26 },
  { header: "Prioridad", value: (t) => ticketPriorityLabels[t.priority], width: 18, align: "center", badge: (t) => PRIORITY_COLORS[t.priority] },
  { header: "Estado", value: (t) => ticketStatusLabels[t.status], width: 18, align: "center", badge: (t) => STATUS_COLORS[t.status] },
  { header: "Resuelto", value: (t) => (t.resolvedAt ? formatDate(t.resolvedAt) : "—"), width: 20 },
];

type TicketReportOptions = {
  periodLabel: string;
  counts: TicketDashboardCounts;
  tickets: Ticket[];
};

export async function exportTicketReportPdf({ periodLabel, counts, tickets }: TicketReportOptions) {
  const stats: ReportStat[] = [
    { label: "Nuevos", value: String(counts.newCount) },
    { label: "Abiertos", value: String(counts.openCount) },
    { label: "En curso", value: String(counts.inProgressCount) },
    { label: "Pendientes", value: String(counts.pendingCount) },
    { label: "Resueltos", value: String(counts.resolvedPeriodCount) },
    { label: "Resueltos (total)", value: String(counts.resolvedTotalCount) },
    { label: "Tardaron +3 días", value: String(counts.staleCount) },
    { label: "Prioridad alta", value: String(counts.highPriorityCount) },
    { label: "Prioridad media", value: String(counts.mediumPriorityCount) },
    { label: "Prioridad baja", value: String(counts.lowPriorityCount) },
  ];
  const generatedAt = new Intl.DateTimeFormat("es-ES", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Madrid" }).format(new Date());

  await generatePdfReport({
    title: "Informe de tickets informáticos",
    subtitle: `Periodo: ${periodLabel}  ·  Generado el ${generatedAt}  ·  ${tickets.length} ticket${tickets.length === 1 ? "" : "s"}`,
    stats,
    sectionTitle: "Detalle de tickets",
    columns: COLUMNS,
    rows: tickets,
    filename: `informe_tickets_${new Date().toISOString().slice(0, 10)}.pdf`,
  });
}
