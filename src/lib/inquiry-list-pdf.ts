import { formatEuroForPdf, generatePdfReport, type ReportBadge, type ReportColumn, type ReportStat } from "@/lib/pdf-report";
import { formatDate } from "@/lib/format";

/*
  Las dos listas de la pantalla de consultas en PDF: las consultas y las
  ventas apuntadas.

  No es el informe —ese ya existe y va por unidades, con sus porcentajes—:
  esto es la lista tal cual se está viendo, con los filtros puestos, para
  imprimirla o mandarla. Sale vectorial, así que se amplía sin pixelarse y se
  puede buscar texto dentro.
*/

const COLOR_DEL_ESTADO: Record<string, ReportBadge> = {
  sin_contactar: { bg: [219, 234, 254], text: [30, 64, 175] },
  contactado: { bg: [219, 234, 254], text: [30, 64, 175] },
  oferta_enviada: { bg: [254, 243, 199], text: [146, 64, 14] },
  interesado: { bg: [254, 243, 199], text: [146, 64, 14] },
  ganado: { bg: [220, 252, 231], text: [22, 101, 52] },
  perdido: { bg: [254, 226, 226], text: [153, 27, 27] },
};

export type InquiryListRow = {
  createdAt: string;
  unitName: string;
  channelLabel: string;
  contactName: string | null;
  companyName: string | null;
  phone: string | null;
  email: string | null;
  productInterest: string | null;
  statusKey: string | null;
  statusLabel: string;
  /** Quién la añadió en el Hub. */
  addedBy: string;
  count: number;
  value: number;
  saleTypes: string;
};

export type SaleListRow = {
  occurredOn: string;
  unitName: string;
  typeLabel: string;
  origin: string;
  count: number;
  value: number;
};

/** La lista de consultas, con los filtros que estén puestos en la pantalla. */
export async function exportInquiryListPdf(rows: InquiryListRow[], options: { periodLabel: string; scopeLabel: string; filename: string }) {
  const total = rows.reduce((suma, fila) => suma + fila.value, 0);
  const consultas = rows.reduce((suma, fila) => suma + fila.count, 0);
  const conVenta = rows.filter((fila) => fila.value > 0).length;

  const stats: ReportStat[] = [
    { label: "Apuntes", value: String(rows.length) },
    { label: "Consultas", value: String(consultas) },
    { label: "Con venta", value: String(conVenta) },
    ...(total > 0 ? [{ label: "Valor", value: formatEuroForPdf(total) }] : []),
  ];

  const columns: ReportColumn<InquiryListRow>[] = [
    { header: "Fecha", value: (fila) => formatDate(fila.createdAt), align: "center" },
    { header: "Unidad", value: (fila) => fila.unitName },
    { header: "Canal", value: (fila) => fila.channelLabel },
    { header: "Contacto", value: (fila) => fila.contactName ?? "—", width: "auto" },
    { header: "Empresa", value: (fila) => fila.companyName ?? "—", width: "auto" },
    { header: "Teléfono", value: (fila) => fila.phone ?? "—" },
    { header: "Qué pide", value: (fila) => fila.productInterest ?? "—", width: "auto" },
    {
      header: "Estado",
      value: (fila) => fila.statusLabel,
      align: "center",
      badge: (fila) => (fila.statusKey ? COLOR_DEL_ESTADO[fila.statusKey] ?? null : null),
    },
    { header: "Añadida por", value: (fila) => fila.addedBy },
    { header: "Cant.", value: (fila) => String(fila.count), align: "right" },
    { header: "Valor", value: (fila) => (fila.value > 0 ? formatEuroForPdf(fila.value) : "—"), align: "right" },
  ];

  await generatePdfReport({
    title: "Consultas",
    subtitle: `${options.scopeLabel} · ${options.periodLabel}`,
    stats,
    sectionTitle: "Lo apuntado",
    columns,
    rows,
    notes: [
      "Es la lista tal como se está viendo en pantalla, con los filtros puestos.",
      "Los apuntes semanales no llevan estado: son un recuento, no una consulta con nombre.",
      "El correo no sale aquí para que quepan las demás columnas; está en el CSV.",
    ],
    filename: options.filename,
    orientation: "l",
  });
}

/** Las ventas apuntadas a mano, que no son las de Sage. */
export async function exportSaleListPdf(rows: SaleListRow[], options: { periodLabel: string; scopeLabel: string; filename: string }) {
  const total = rows.reduce((suma, fila) => suma + fila.value, 0);
  const unidades = rows.reduce((suma, fila) => suma + fila.count, 0);

  const columns: ReportColumn<SaleListRow>[] = [
    { header: "Fecha", value: (fila) => formatDate(fila.occurredOn), align: "center" },
    { header: "Unidad", value: (fila) => fila.unitName },
    { header: "Tipo", value: (fila) => fila.typeLabel },
    { header: "Origen", value: (fila) => fila.origin, width: "auto" },
    { header: "Cantidad", value: (fila) => String(fila.count), align: "right" },
    { header: "Valor", value: (fila) => formatEuroForPdf(fila.value), align: "right" },
  ];

  await generatePdfReport({
    title: "Ventas apuntadas",
    subtitle: `${options.scopeLabel} · ${options.periodLabel}`,
    stats: [
      { label: "Apuntes", value: String(rows.length) },
      { label: "Unidades", value: String(unidades) },
      { label: "Valor", value: formatEuroForPdf(total) },
    ],
    sectionTitle: "Ventas",
    columns,
    rows,
    notes: [
      "Son las ventas que se apuntan en esta pantalla, no las de Sage: aquí entra lo que no pasa por albarán.",
    ],
    filename: options.filename,
  });
}
