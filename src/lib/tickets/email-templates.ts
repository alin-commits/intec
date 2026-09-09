import { emailButton, emailShell } from "@/lib/email-templates";
import { ticketBlockingLevelLabels, ticketCategoryLabels, ticketPriorityLabels } from "./constants";
import type { TicketBlockingLevel, TicketCategory, TicketPriority } from "./types";

type TicketCreatedEmailInput = {
  ticketNumber: string;
  ticketUrl: string;
  title: string;
  reporterName: string;
  reporterPhone: string;
  reporterEmail: string | null;
  department: string;
  category: TicketCategory;
  priority: TicketPriority;
  blockingLevel: TicketBlockingLevel;
  description: string;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function row(label: string, value: string): string {
  return `<tr><td style="padding:4px 0;color:#64748b;font-size:12px;font-weight:700;width:150px;vertical-align:top;">${label}</td><td style="padding:4px 0;font-size:13px;">${escapeHtml(value)}</td></tr>`;
}

type TicketResolvedEmailInput = {
  ticketNumber: string;
  title: string;
  reporterName: string;
  resolvedAt: string;
  resolutionNote: string | null;
  origin: string;
};

export function buildTicketResolvedEmail(input: TicketResolvedEmailInput): { subject: string; html: string } {
  const resolvedAtLabel = new Date(input.resolvedAt).toLocaleString("es-ES", { dateStyle: "medium", timeStyle: "short" });
  const firstName = input.reporterName.trim().split(/\s+/)[0] || input.reporterName;
  const body = `
    <div style="display:inline-block;padding:6px 12px;border-radius:999px;background:#ecfdf5;color:#166534;font-size:12px;font-weight:700;margin-bottom:4px;">✓ Resuelto</div>
    <p style="margin-top:16px;">Hola ${escapeHtml(firstName)},</p>
    <p>Buenas noticias: tu incidencia ya está resuelta. Aquí tienes el resumen:</p>
    <table role="presentation" width="100%" style="border-collapse:collapse;margin:16px 0;background:#f8fafc;border-radius:10px;">
      <tr><td style="padding:14px 16px;">
        <p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#64748b;">${escapeHtml(input.ticketNumber)}</p>
        <p style="margin:0;font-size:15px;font-weight:700;color:#0f172a;">${escapeHtml(input.title)}</p>
        <p style="margin:8px 0 0;font-size:12px;color:#64748b;">Resuelto el ${resolvedAtLabel}</p>
      </td></tr>
    </table>
    ${input.resolutionNote ? `<p style="margin:0 0 6px;font-weight:700;">Cómo se ha resuelto</p><p style="margin:0 0 16px;">${escapeHtml(input.resolutionNote).replace(/\n/g, "<br />")}</p>` : ""}
    <p>Si el problema vuelve a aparecer o sigues teniendo dificultades, escríbenos de nuevo sin problema.</p>
    ${emailButton(`${input.origin}/soporte`, "Abrir otra incidencia")}
    <p style="margin-top:24px;font-size:12px;color:#94a3b8;">— Equipo de Informática</p>
  `;
  return {
    subject: `Tu incidencia ${input.ticketNumber} ya está resuelta`,
    html: emailShell("Incidencia resuelta", body, "Soporte informático"),
  };
}

export function buildTicketCreatedEmail(input: TicketCreatedEmailInput): { subject: string; html: string } {
  const createdAtLabel = new Date().toLocaleString("es-ES", { dateStyle: "medium", timeStyle: "short" });
  const body = `
    <table role="presentation" width="100%" style="border-collapse:collapse;margin-top:8px;">
      ${row("Título", input.title)}
      ${row("Trabajador", input.reporterName)}
      ${row("Departamento", input.department)}
      ${row("Teléfono", input.reporterPhone)}
      ${input.reporterEmail ? row("Correo", input.reporterEmail) : ""}
      ${row("Categoría", ticketCategoryLabels[input.category])}
      ${row("Prioridad", ticketPriorityLabels[input.priority])}
      ${row("Bloqueo", ticketBlockingLevelLabels[input.blockingLevel])}
      ${row("Fecha", createdAtLabel)}
    </table>
    <p style="margin-top:16px;"><strong>Descripción</strong><br />${escapeHtml(input.description).replace(/\n/g, "<br />")}</p>
    ${emailButton(input.ticketUrl, "Abrir ticket en el panel")}
  `;
  return {
    subject: `Nuevo ticket ${input.ticketNumber} — ${input.title}`,
    html: emailShell(`Nuevo ticket ${input.ticketNumber}`, body, "Ticket informático", 560),
  };
}
