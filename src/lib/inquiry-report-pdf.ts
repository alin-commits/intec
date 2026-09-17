import { formatEuroForPdf, generatePdfReport, type ReportColumn, type ReportStat } from "@/lib/pdf-report";
import { inquiryChannelLabels, inquiryChannelOrder } from "@/lib/constants";
import type { InquiryType } from "@/lib/types";

export type UnitReportRow = {
  name: string;
  total: number;
  variation: number | null;
  counts: Partial<Record<InquiryType, number>>;
};

type InquiryReportOptions = {
  periodLabel: string;
  totalInquiries: number;
  averageLabel: string;
  averageValue: string;
  topChannelLabel: string;
  topUnitLabel: string;
  salesSummary: Record<"oferta" | "seguimiento" | "pedido", { value: number }>;
  unitRows: UnitReportRow[];
};

export async function exportInquiryReportPdf({
  periodLabel,
  totalInquiries,
  averageLabel,
  averageValue,
  topChannelLabel,
  topUnitLabel,
  salesSummary,
  unitRows,
}: InquiryReportOptions) {
  const stats: ReportStat[] = [
    { label: "Consultas totales", value: String(totalInquiries) },
    { label: averageLabel, value: averageValue },
    { label: "Canal principal", value: topChannelLabel },
    { label: "Unidad líder", value: topUnitLabel },
    { label: "Ofertas (valor)", value: formatEuroForPdf(salesSummary.oferta.value) },
    { label: "Seguimientos (valor)", value: formatEuroForPdf(salesSummary.seguimiento.value) },
    { label: "Pedidos (valor)", value: formatEuroForPdf(salesSummary.pedido.value) },
  ];

  const columns: ReportColumn<UnitReportRow>[] = [
    { header: "Unidad", value: (row) => row.name, width: 38 },
    { header: "Total", value: (row) => String(row.total), width: 20, align: "center" },
    { header: "Variación (%)", value: (row) => (row.variation === null ? "—" : row.variation.toFixed(1).replace(".", ",")), width: 24, align: "center" },
    ...inquiryChannelOrder.map((channel): ReportColumn<UnitReportRow> => ({
      header: inquiryChannelLabels[channel],
      value: (row) => String(row.counts[channel] ?? 0),
      align: "center",
    })),
  ];

  const generatedAt = new Intl.DateTimeFormat("es-ES", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Madrid" }).format(new Date());

  await generatePdfReport({
    title: "Informe de consultas",
    subtitle: `Periodo: ${periodLabel}  ·  Generado el ${generatedAt}  ·  ${unitRows.length} unidad${unitRows.length === 1 ? "" : "es"}`,
    stats,
    sectionTitle: "Comparativa por unidad",
    columns,
    rows: unitRows,
    filename: `informe_consultas_${new Date().toISOString().slice(0, 10)}.pdf`,
  });
}
