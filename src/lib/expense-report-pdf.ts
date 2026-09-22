import { formatEuroForPdf, generatePdfReport, type ReportBadge, type ReportColumn, type ReportStat } from "@/lib/pdf-report";
import { formatDate } from "@/lib/format";

export type ExpenseReportRow = {
  name: string;
  provider: string | null;
  category: string;
  unitName: string;
  kindLabel: string;
  amount: number;
  monthlyCost: number;
  spentInYear: number;
  nextDate: string | null;
  active: boolean;
};

const ACTIVE_BADGE: ReportBadge = { bg: [220, 252, 231], text: [22, 101, 52] };
const CANCELLED_BADGE: ReportBadge = { bg: [241, 245, 249], text: [71, 85, 105] };
const eur = formatEuroForPdf;

export async function exportExpenseReportPdf({ year, stats, rows }: { year: number; stats: ReportStat[]; rows: ExpenseReportRow[] }) {
  const columns: ReportColumn<ExpenseReportRow>[] = [
    { header: "Concepto", value: (r) => (r.provider ? `${r.name} (${r.provider})` : r.name) },
    { header: "Categoría", value: (r) => r.category, width: 34 },
    { header: "Unidad", value: (r) => r.unitName, width: 24 },
    { header: "Tipo", value: (r) => r.kindLabel, width: 20 },
    { header: "Importe", value: (r) => eur(r.amount), width: 22, align: "right" },
    { header: "Coste/mes", value: (r) => (r.monthlyCost ? eur(r.monthlyCost) : "—"), width: 22, align: "right" },
    { header: `Gastado ${year}`, value: (r) => eur(r.spentInYear), width: 24, align: "right" },
    { header: "Próx. cargo / fecha", value: (r) => (r.nextDate ? formatDate(r.nextDate) : "—"), width: 26, align: "center" },
    { header: "Estado", value: (r) => (r.active ? "Activo" : "De baja"), width: 18, align: "center", badge: (r) => (r.active ? ACTIVE_BADGE : CANCELLED_BADGE) },
  ];
  const generatedAt = new Intl.DateTimeFormat("es-ES", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Madrid" }).format(new Date());

  await generatePdfReport({
    title: "Gastos de marketing",
    subtitle: `Año ${year}  ·  Generado el ${generatedAt}  ·  ${rows.length} gasto${rows.length === 1 ? "" : "s"}`,
    stats,
    sectionTitle: "Detalle de gastos",
    columns,
    rows,
    filename: `gastos_marketing_${year}.pdf`,
  });
}
