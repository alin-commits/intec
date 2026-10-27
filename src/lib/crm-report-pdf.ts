import { formatEuroForPdf, generatePdfReport, type ReportBadge, type ReportColumn, type ReportStat } from "@/lib/pdf-report";
import { formatDate } from "@/lib/format";

/*
  El color de cada estado. Van aquí y no en la pantalla porque allí son clases
  de CSS, y un PDF necesita los colores en números. Son los mismos tres grupos
  que usa el informe de leads: azul lo que está en marcha, ámbar lo que espera
  respuesta, verde lo ganado y rojo lo perdido.
*/
const COLOR_DEL_ESTADO: Record<string, ReportBadge> = {
  sin_contactar: { bg: [219, 234, 254], text: [30, 64, 175] },
  contactado: { bg: [219, 234, 254], text: [30, 64, 175] },
  oferta_enviada: { bg: [254, 243, 199], text: [146, 64, 14] },
  interesado: { bg: [254, 243, 199], text: [146, 64, 14] },
  ganado: { bg: [220, 252, 231], text: [22, 101, 52] },
  perdido: { bg: [254, 226, 226], text: [153, 27, 27] },
};

/*
  El informe de contactos del CRM en PDF.

  El CSV vale para seguir trabajando con los datos; esto vale para enseñarlos:
  se imprime, se manda por correo y se lee sin abrir nada. Sale vectorial —no
  es una captura— así que se puede ampliar y buscar texto dentro.

  Las columnas son las del CSV menos las notas, que son párrafos enteros y
  dejarían la tabla ilegible. Quien necesite las notas tiene el CSV.
*/

/** Un contacto, con lo justo que necesita el informe. */
export type CrmReportContact = {
  fullName: string;
  companyName: string | null;
  businessUnitId: string | null;
  phone: string | null;
  companyEmail: string | null;
  city: string | null;
  status: string;
  saleValue: number | null;
  statusChangedAt: string | null;
  origin: string | null;
  createdAt: string;
};

type CrmReportOptions = {
  /** De qué unidad son, para el subtítulo: «Todas las unidades», «Industria»… */
  scopeLabel: string;
  /** Cómo se llama cada unidad, para la columna. */
  unitName: (id: string | null) => string;
  /** La etiqueta y el color de cada estado, que los decide la pantalla. */
  statusLabel: (status: string) => string;
  /** Cuántos hay de cada estado, ya contados, para la cabecera. */
  porEstado: { label: string; count: number }[];
  filename: string;
};

export async function exportCrmReportPdf(contacts: CrmReportContact[], options: CrmReportOptions) {
  const conValor = contacts.filter((contact) => Number(contact.saleValue) > 0);
  const total = conValor.reduce((suma, contact) => suma + Number(contact.saleValue), 0);

  const stats: ReportStat[] = [
    { label: "Contactos", value: String(contacts.length) },
    ...options.porEstado.filter((estado) => estado.count > 0).map((estado) => ({
      label: estado.label,
      value: String(estado.count),
    })),
    ...(total > 0
      ? [
        { label: "Valor apuntado", value: formatEuroForPdf(total) },
        { label: "Media por contacto", value: formatEuroForPdf(total / conValor.length) },
      ]
      : []),
  ];

  const columns: ReportColumn<CrmReportContact>[] = [
    { header: "Nombre", value: (contact) => contact.fullName, width: "auto" },
    { header: "Empresa", value: (contact) => contact.companyName ?? "—", width: "auto" },
    { header: "Unidad", value: (contact) => options.unitName(contact.businessUnitId) },
    { header: "Teléfono", value: (contact) => contact.phone ?? "—" },
    { header: "Correo", value: (contact) => contact.companyEmail ?? "—", width: "auto" },
    { header: "Población", value: (contact) => contact.city ?? "—" },
    {
      header: "Estado",
      value: (contact) => options.statusLabel(contact.status),
      align: "center",
      badge: (contact) => COLOR_DEL_ESTADO[contact.status] ?? null,
    },
    {
      header: "Valor",
      value: (contact) => (Number(contact.saleValue) > 0 ? formatEuroForPdf(Number(contact.saleValue)) : "—"),
      align: "right",
    },
    { header: "Desde", value: (contact) => (contact.statusChangedAt ? formatDate(contact.statusChangedAt) : "—"), align: "center" },
  ];

  await generatePdfReport({
    title: "Contactos del CRM",
    subtitle: `${options.scopeLabel} · ${contacts.length} ${contacts.length === 1 ? "contacto" : "contactos"}`,
    stats,
    sectionTitle: "Contactos",
    columns,
    rows: contacts,
    notes: [
      "El valor apuntado es el que ha puesto quien lleva el contacto, no una venta cerrada en Sage.",
      "Las notas de cada contacto no salen aquí: son párrafos y dejarían la tabla ilegible. Están en el CSV.",
    ],
    filename: options.filename,
    // Nueve columnas no caben en vertical sin partir los correos por la mitad.
    orientation: "l",
  });
}
