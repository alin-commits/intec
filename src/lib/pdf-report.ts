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
/**
 * Una tabla ya pasada a texto, para los informes de varias partes.
 *
 * Nace para el informe de ventas, que no es una lista sino seis: mes a mes, por
 * comercial, por sociedad... Cada una tiene columnas distintas, así que aquí
 * llegan ya formateadas en vez de con una función por columna.
 */
export type ReportTable = {
  title: string;
  head: string[];
  body: string[][];
  align?: ("left" | "center" | "right")[];
  widths?: (number | "auto")[];
  /** Una frase en gris debajo de la tabla. */
  note?: string;
};

export type ReportOptions<T> = {
  title: string;
  subtitle: string;
  stats: ReportStat[];
  sectionTitle?: string;
  columns?: ReportColumn<T>[];
  rows?: T[];
  /** Frases en gris antes de las tablas: avisos, cómo hay que leer el informe. */
  notes?: string[];
  /** Tablas, una detrás de otra, después de la principal. */
  tables?: ReportTable[];
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
async function buildPdfReport<T>({ title, subtitle, stats, sectionTitle = "", columns = [], rows = [], notes = [], tables = [], orientation = "l" }: ReportOptions<T>) {
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
  // Siete cifras en filas de cinco dejan una segunda fila de dos sueltas en
  // mitad del ancho. Se reparten a partes iguales: cuatro y tres.
  const perRow = stats.length > STAT_CHUNK_SIZE
    ? Math.ceil(stats.length / Math.ceil(stats.length / STAT_CHUNK_SIZE))
    : STAT_CHUNK_SIZE;
  for (const row of chunk(stats, perRow)) {
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

  // Lo que hay que saber antes de leer las cifras, cuando hay algo que decir.
  if (notes.length > 0) {
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8.5);
    pdf.setTextColor(...REPORT_MUTED_COLOR);
    cursorY += 4;
    for (const note of notes) {
      const lines = pdf.splitTextToSize(note, pageWidth - margin * 2) as string[];
      pdf.text(lines, margin, cursorY);
      cursorY += lines.length * 3.7 + 1.2;
    }
    cursorY += 1;
  }

  /** Si no cabe el título con sus primeras filas, se pasa de página. */
  const roomFor = (needed: number) => {
    if (cursorY + needed <= pageHeight - 18) return;
    pdf.addPage();
    cursorY = 14;
  };
  const finalY = () => (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

  if (columns.length > 0) {
    roomFor(28);
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
    cursorY = finalY() + 6;
  }

  // Las demás tablas, una detrás de otra.
  for (const table of tables) {
    if (table.body.length === 0) continue;
    roomFor(28);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(12);
    pdf.setTextColor(...REPORT_TEXT_COLOR);
    pdf.text(table.title, margin, cursorY + 6);

    const styles: Record<number, { cellWidth?: number | "auto"; halign?: "left" | "center" | "right" }> = {};
    table.head.forEach((_, index) => {
      styles[index] = { cellWidth: table.widths?.[index] ?? "auto", halign: table.align?.[index] ?? (index === 0 ? "left" : "right") };
    });

    autoTable(pdf, {
      startY: cursorY + 9,
      margin: { left: margin, right: margin, bottom: 16 },
      head: [table.head],
      body: table.body,
      styles: { font: "helvetica", fontSize: 8.5, cellPadding: 2.2, textColor: REPORT_TEXT_COLOR, lineColor: REPORT_BORDER_COLOR, lineWidth: 0.1, overflow: "linebreak" },
      headStyles: { fillColor: REPORT_BRAND_COLOR, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 8.5 },
      alternateRowStyles: { fillColor: REPORT_ALT_ROW_BG },
      columnStyles: styles,
    });
    cursorY = finalY() + 6;

    if (table.note) {
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(8);
      pdf.setTextColor(...REPORT_MUTED_COLOR);
      const lines = pdf.splitTextToSize(table.note, pageWidth - margin * 2) as string[];
      pdf.text(lines, margin, cursorY - 2);
      cursorY += lines.length * 3.5;
    }
  }

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
