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
