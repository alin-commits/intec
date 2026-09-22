export type RGB = [number, number, number];
export type ReportStat = { label: string; value: string };
export type ReportBadge = { bg: RGB; text: RGB };
export type ReportColumn<T> = {
  header: string;
  value: (row: T) => string;
  width?: number | "auto";
  align?: "left" | "center" | "right";
  badge?: (row: T) => ReportBadge | null;
};
export type ReportOptions<T> = {
  title: string;
  subtitle: string;
  stats: ReportStat[];
  sectionTitle: string;
  columns: ReportColumn<T>[];
  rows: T[];
  filename: string;
  orientation?: "p" | "l";
};

/**
 * `Intl`'s currency formatting inserts a non-breaking space before "€",
 * which autoTable can't wrap — a single wide value then refuses to shrink
 * and the whole table can overflow the page width. Use this instead of
 * `toLocaleString(..., { style: "currency" })` for any PDF table cell.
 */
export function formatEuroForPdf(value: number): string {
  return `${value.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

export const REPORT_TEXT_COLOR: RGB = [15, 23, 42];
export const REPORT_MUTED_COLOR: RGB = [100, 116, 139];
export const REPORT_BORDER_COLOR: RGB = [226, 232, 240];
export const REPORT_BRAND_COLOR: RGB = [51, 44, 128];
export const REPORT_ALT_ROW_BG: RGB = [248, 250, 252];

const STAT_CHUNK_SIZE = 5;

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

/** Builds a report PDF from data as vector text/tables (no DOM screenshot). Shared by every exportable report in the app. */
async function buildPdfReport<T>({ title, subtitle, stats, sectionTitle, columns, rows, orientation = "l" }: ReportOptions<T>) {
  const [{ default: jsPDF }, { autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);

  const pdf = new jsPDF({ orientation, unit: "mm", format: "a4" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 14;

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(18);
  pdf.setTextColor(...REPORT_TEXT_COLOR);
  pdf.text(title, margin, 17);

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  pdf.setTextColor(...REPORT_MUTED_COLOR);
  pdf.text(subtitle, margin, 24);

  pdf.setDrawColor(...REPORT_BORDER_COLOR);
  pdf.setLineWidth(0.3);
  pdf.line(margin, 28, pageWidth - margin, 28);

  let cursorY = 33;
  for (const row of chunk(stats, STAT_CHUNK_SIZE)) {
    autoTable(pdf, {
      startY: cursorY,
      margin: { left: margin, right: margin },
      tableWidth: pageWidth - margin * 2,
      theme: "plain",
      body: [row.map((item) => item.label), row.map((item) => item.value)],
      styles: { font: "helvetica", halign: "center", cellPadding: 1 },
      didParseCell: (data) => {
        if (data.row.index === 0) {
          data.cell.styles.fontSize = 8.5;
          data.cell.styles.textColor = REPORT_MUTED_COLOR;
        } else {
          data.cell.styles.fontSize = 14;
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.textColor = REPORT_TEXT_COLOR;
        }
      },
    });
    cursorY = (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 2;
  }

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(12);
  pdf.setTextColor(...REPORT_TEXT_COLOR);
  pdf.text(sectionTitle, margin, cursorY + 6);

  const columnStyles: Record<number, { cellWidth?: number | "auto"; halign?: "left" | "center" | "right" }> = {};
  columns.forEach((column, index) => {
    columnStyles[index] = { cellWidth: column.width ?? "auto", halign: column.align };
  });

  autoTable(pdf, {
    startY: cursorY + 9,
    margin: { left: margin, right: margin, bottom: 16 },
    head: [columns.map((column) => column.header)],
    body: rows.map((row) => columns.map((column) => column.value(row))),
    styles: { font: "helvetica", fontSize: 8.5, cellPadding: 2.2, textColor: REPORT_TEXT_COLOR, lineColor: REPORT_BORDER_COLOR, lineWidth: 0.1, overflow: "linebreak" },
    headStyles: { fillColor: REPORT_BRAND_COLOR, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 8.5 },
    alternateRowStyles: { fillColor: REPORT_ALT_ROW_BG },
    columnStyles,
    didParseCell: (data) => {
      if (data.section !== "body") return;
      const column = columns[data.column.index];
      const row = rows[data.row.index];
      if (!column?.badge || !row) return;
      const badge = column.badge(row);
      if (!badge) return;
      data.cell.styles.fillColor = badge.bg;
      data.cell.styles.textColor = badge.text;
      data.cell.styles.fontStyle = "bold";
    },
  });

  const totalPages = pdf.getNumberOfPages();
  for (let page = 1; page <= totalPages; page++) {
    pdf.setPage(page);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(...REPORT_MUTED_COLOR);
    pdf.text("Homi · Panel interno", margin, pageHeight - 8);
    pdf.text(`Página ${page} de ${totalPages}`, pageWidth - margin, pageHeight - 8, { align: "right" });
  }

  return pdf;
}

/** Downloads the report in the browser. */
export async function generatePdfReport<T>(options: ReportOptions<T>) {
  const pdf = await buildPdfReport(options);
  pdf.save(options.filename);
}

/** Returns the report bytes (for email attachments on the server). */
export async function renderPdfReport<T>(options: ReportOptions<T>): Promise<ArrayBuffer> {
  const pdf = await buildPdfReport(options);
  return pdf.output("arraybuffer");
}
