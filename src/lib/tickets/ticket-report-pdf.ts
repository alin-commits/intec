import { formatDate } from "@/lib/format";
import { ticketCategoryLabels, ticketPriorityLabels, ticketStatusLabels } from "./constants";
import type { TicketDashboardCounts } from "./map";
import type { Ticket } from "./types";

type RGB = [number, number, number];

const TEXT_COLOR: RGB = [15, 23, 42];
const MUTED_COLOR: RGB = [100, 116, 139];
const BORDER_COLOR: RGB = [226, 232, 240];
const BRAND_COLOR: RGB = [37, 99, 235];
const HEADER_ROW_BG: RGB = [248, 250, 252];

const PRIORITY_COLORS: Record<Ticket["priority"], { bg: RGB; text: RGB }> = {
  high: { bg: [254, 226, 226], text: [153, 27, 27] },
  medium: { bg: [254, 243, 199], text: [146, 64, 14] },
  low: { bg: [241, 245, 249], text: [71, 85, 105] },
};

const STATUS_COLORS: Record<Ticket["status"], { bg: RGB; text: RGB }> = {
  new: { bg: [219, 234, 254], text: [30, 64, 175] },
  in_progress: { bg: [254, 243, 199], text: [146, 64, 14] },
  pending: { bg: [237, 233, 254], text: [109, 40, 217] },
  resolved: { bg: [220, 252, 231], text: [22, 101, 52] },
  closed: { bg: [241, 245, 249], text: [71, 85, 105] },
};

const STAT_ROWS: Array<Array<{ label: string; key: keyof TicketDashboardCounts }>> = [
  [
    { label: "Nuevos", key: "newCount" },
    { label: "Abiertos", key: "openCount" },
    { label: "En curso", key: "inProgressCount" },
    { label: "Pendientes", key: "pendingCount" },
    { label: "Resueltos", key: "resolvedPeriodCount" },
  ],
  [
    { label: "Resueltos (total)", key: "resolvedTotalCount" },
    { label: "Tardaron +3 días", key: "staleCount" },
    { label: "Prioridad alta", key: "highPriorityCount" },
    { label: "Prioridad media", key: "mediumPriorityCount" },
    { label: "Prioridad baja", key: "lowPriorityCount" },
  ],
];

type TicketReportOptions = {
  periodLabel: string;
  counts: TicketDashboardCounts;
  tickets: Ticket[];
};

/** Builds the tickets PDF report from data, as vector text/tables (no DOM screenshot). */
export async function exportTicketReportPdf({ periodLabel, counts, tickets }: TicketReportOptions) {
  const [{ default: jsPDF }, { autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);

  const pdf = new jsPDF({ orientation: "l", unit: "mm", format: "a4" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 14;

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(18);
  pdf.setTextColor(...TEXT_COLOR);
  pdf.text("Informe de tickets informáticos", margin, 17);

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  pdf.setTextColor(...MUTED_COLOR);
  const generatedAt = new Intl.DateTimeFormat("es-ES", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Madrid" }).format(new Date());
  pdf.text(`Periodo: ${periodLabel}  ·  Generado el ${generatedAt}  ·  ${tickets.length} ticket${tickets.length === 1 ? "" : "s"}`, margin, 24);

  pdf.setDrawColor(...BORDER_COLOR);
  pdf.setLineWidth(0.3);
  pdf.line(margin, 28, pageWidth - margin, 28);

  let cursorY = 33;
  for (const row of STAT_ROWS) {
    autoTable(pdf, {
      startY: cursorY,
      margin: { left: margin, right: margin },
      tableWidth: pageWidth - margin * 2,
      theme: "plain",
      body: [row.map((item) => item.label), row.map((item) => String(counts[item.key]))],
      styles: { font: "helvetica", halign: "center", cellPadding: 1 },
      didParseCell: (data) => {
        if (data.row.index === 0) {
          data.cell.styles.fontSize = 8.5;
          data.cell.styles.textColor = MUTED_COLOR;
        } else {
          data.cell.styles.fontSize = 15;
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.textColor = TEXT_COLOR;
        }
      },
    });
    cursorY = (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 2;
  }

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(12);
  pdf.setTextColor(...TEXT_COLOR);
  pdf.text("Detalle de tickets", margin, cursorY + 6);

  const priorityColIndex = 6;
  const statusColIndex = 7;

  autoTable(pdf, {
    startY: cursorY + 9,
    margin: { left: margin, right: margin, bottom: 16 },
    head: [["Nº", "Fecha", "Solicitante", "Departamento", "Título", "Categoría", "Prioridad", "Estado", "Resuelto"]],
    body: tickets.map((ticket) => [
      ticket.ticketNumber,
      formatDate(ticket.createdAt),
      ticket.reporterName,
      ticket.department,
      ticket.title,
      ticketCategoryLabels[ticket.category],
      ticketPriorityLabels[ticket.priority],
      ticketStatusLabels[ticket.status],
      ticket.resolvedAt ? formatDate(ticket.resolvedAt) : "—",
    ]),
    styles: { font: "helvetica", fontSize: 8.5, cellPadding: 2.2, textColor: TEXT_COLOR, lineColor: BORDER_COLOR, lineWidth: 0.1, overflow: "linebreak" },
    headStyles: { fillColor: BRAND_COLOR, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 8.5 },
    alternateRowStyles: { fillColor: HEADER_ROW_BG },
    columnStyles: {
      0: { cellWidth: 18 },
      1: { cellWidth: 22 },
      2: { cellWidth: 30 },
      3: { cellWidth: 26 },
      4: { cellWidth: "auto" },
      5: { cellWidth: 32 },
      6: { cellWidth: 20, halign: "center" },
      7: { cellWidth: 20, halign: "center" },
      8: { cellWidth: 22 },
    },
    didParseCell: (data) => {
      if (data.section !== "body") return;
      const ticket = tickets[data.row.index];
      if (!ticket) return;
      if (data.column.index === priorityColIndex) {
        const colors = PRIORITY_COLORS[ticket.priority];
        data.cell.styles.fillColor = colors.bg;
        data.cell.styles.textColor = colors.text;
        data.cell.styles.fontStyle = "bold";
      }
      if (data.column.index === statusColIndex) {
        const colors = STATUS_COLORS[ticket.status];
        data.cell.styles.fillColor = colors.bg;
        data.cell.styles.textColor = colors.text;
        data.cell.styles.fontStyle = "bold";
      }
    },
  });

  const totalPages = pdf.getNumberOfPages();
  for (let page = 1; page <= totalPages; page++) {
    pdf.setPage(page);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(...MUTED_COLOR);
    pdf.text("Homi · Panel interno", margin, pageHeight - 8);
    pdf.text(`Página ${page} de ${totalPages}`, pageWidth - margin, pageHeight - 8, { align: "right" });
  }

  pdf.save(`informe_tickets_${new Date().toISOString().slice(0, 10)}.pdf`);
}
