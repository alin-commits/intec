/** Escapes user-typed text (names, companies, titles) before it goes into an email. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function emailShell(title: string, bodyHtml: string, eyebrow = "Intec Commercial Hub", maxWidth = 480): string {
  return `<!doctype html>
<html lang="es">
  <body style="margin:0;padding:32px 16px;background:#f5f7fb;font-family:Segoe UI,Arial,sans-serif;color:#0f172a;">
    <table role="presentation" width="100%" style="max-width:${maxWidth}px;margin:0 auto;background:#ffffff;border-radius:14px;border:1px solid #e8ebf2;overflow:hidden;">
      <tr><td style="padding:28px 32px 8px;">
        <p style="margin:0;font-size:13px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#332c80;">${eyebrow}</p>
        <h1 style="margin:10px 0 4px;font-size:20px;">${title}</h1>
      </td></tr>
      <tr><td style="padding:8px 32px 32px;font-size:14px;line-height:1.6;color:#334155;">
        ${bodyHtml}
      </td></tr>
    </table>
  </body>
</html>`;
}

export function emailButton(href: string, label: string): string {
  return `<a href="${href}" style="display:inline-block;margin-top:18px;padding:12px 22px;background:#332c80;color:#ffffff;text-decoration:none;border-radius:9px;font-weight:600;font-size:14px;">${label}</a>`;
}

export function buildInviteEmail(fullName: string, actionLink: string): { subject: string; html: string } {
  const body = `
    <p>Hola ${escapeHtml(fullName)},</p>
    <p>Te han dado acceso al panel interno de consultas, leads y campañas de Suministros Intec.</p>
    ${emailButton(actionLink, "Activar mi cuenta")}
    <p style="margin-top:20px;font-size:12px;color:#64748b;">Si no esperabas esta invitación, puedes ignorar este correo.</p>
  `;
  return { subject: "Te han invitado a Intec Commercial Hub", html: emailShell("Activa tu cuenta", body) };
}

export function buildResetPasswordEmail(actionLink: string): { subject: string; html: string } {
  const body = `
    <p>Hemos recibido una solicitud para restablecer tu contraseña.</p>
    ${emailButton(actionLink, "Restablecer contraseña")}
    <p style="margin-top:20px;font-size:12px;color:#64748b;">Si no has solicitado este cambio, puedes ignorar este correo: tu contraseña actual seguirá funcionando.</p>
  `;
  return { subject: "Restablece tu contraseña — Intec Commercial Hub", html: emailShell("Restablecer contraseña", body) };
}

/** Una fila de la tabla de datos de la factura. */
function invoiceRow(label: string, value: string): string {
  return `<tr>
    <td style="padding:7px 0;color:#64748b;font-size:13px;white-space:nowrap;vertical-align:top;">${escapeHtml(label)}</td>
    <td style="padding:7px 0 7px 18px;font-weight:600;font-size:13px;">${escapeHtml(value)}</td>
  </tr>`;
}

export type InvoiceEmailData = {
  supplier: string;
  invoiceNumber: string | null;
  concept: string | null;
  invoiceDate: string;
  baseAmount: string;
  vatAmount: string;
  totalAmount: string;
  category: string;
  businessUnit: string | null;
  notes: string | null;
  uploadedBy: string;
  fileName: string;
};

/**
 * El correo que acompaña a una factura de proveedor. El PDF va adjunto: aquí
 * solo se resumen los datos para que se pueda archivar sin abrirlo.
 */
export function buildInvoiceEmail(invoice: InvoiceEmailData): { subject: string; html: string } {
  const reference = invoice.invoiceNumber ? `nº ${invoice.invoiceNumber}` : "sin número";
  const rows = [
    invoiceRow("Proveedor", invoice.supplier),
    invoiceRow("Nº de factura", invoice.invoiceNumber ?? "No aparece en la factura"),
    invoiceRow("Fecha", invoice.invoiceDate),
    invoice.concept ? invoiceRow("Concepto", invoice.concept) : "",
    invoiceRow("Base imponible", invoice.baseAmount),
    invoiceRow("IVA", invoice.vatAmount),
    invoiceRow("Total", invoice.totalAmount),
    invoiceRow("Categoría", invoice.category),
    invoice.businessUnit ? invoiceRow("Unidad", invoice.businessUnit) : "",
    invoice.notes ? invoiceRow("Notas", invoice.notes) : "",
  ].join("");

  const body = `
    <p style="margin:0 0 18px;">Factura de <strong>${escapeHtml(invoice.supplier)}</strong> (${escapeHtml(reference)}) por un total de <strong>${escapeHtml(invoice.totalAmount)}</strong>. El PDF va adjunto a este correo.</p>
    <table role="presentation" width="100%" style="border-collapse:collapse;border-top:1px solid #e8ebf2;">${rows}</table>
    <p style="margin:20px 0 0;font-size:12px;color:#64748b;">Adjunto: ${escapeHtml(invoice.fileName)} · Subida por ${escapeHtml(invoice.uploadedBy)} desde Gastos de marketing.</p>
  `;
  return {
    subject: `Factura ${invoice.supplier} ${reference} — ${invoice.totalAmount}`,
    html: emailShell("Factura de proveedor", body, "Intec Commercial Hub", 560),
  };
}
