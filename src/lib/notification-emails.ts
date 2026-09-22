import { emailButton, emailShell, escapeHtml } from "@/lib/email-templates";

type EmailContent = { subject: string; html: string };

const CELL = "padding:7px 10px;border-bottom:1px solid #eef0f6;font-size:13px;vertical-align:top;";
const HEAD = "padding:7px 10px;border-bottom:1px solid #e2e8f0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#64748b;text-align:left;";

// ---------- Campaign status ----------

const CAMPAIGN_STATUS_COPY = {
  active: { verb: "se ha activado", title: "Campaña activada", intro: "Ya está en marcha: los leads que lleguen por esta campaña se asociarán a ella." },
  finished: { verb: "ha finalizado", title: "Campaña finalizada", intro: "La campaña ha terminado. Ya no debería entrar ningún lead nuevo por ella." },
  archived: { verb: "se ha desactivado", title: "Campaña desactivada", intro: "La campaña se ha archivado y deja de mostrarse en los listados activos." },
} as const;

export type NotifiableCampaignStatus = keyof typeof CAMPAIGN_STATUS_COPY;

export function isNotifiableCampaignStatus(status: string): status is NotifiableCampaignStatus {
  return status in CAMPAIGN_STATUS_COPY;
}

export function buildCampaignStatusEmail(input: { campaignName: string; unitName: string; status: NotifiableCampaignStatus; dates: string; channel: string | null; url: string }): EmailContent {
  const copy = CAMPAIGN_STATUS_COPY[input.status];
  const body = `
    <p>La campaña <strong>${escapeHtml(input.campaignName)}</strong> de <strong>${escapeHtml(input.unitName)}</strong> ${copy.verb}.</p>
    <p>${copy.intro}</p>
    <table role="presentation" style="width:100%;border-collapse:collapse;margin-top:8px;">
      <tr><td style="${CELL}color:#64748b;width:110px;">Fechas</td><td style="${CELL}">${escapeHtml(input.dates)}</td></tr>
      ${input.channel ? `<tr><td style="${CELL}color:#64748b;">Canal</td><td style="${CELL}">${escapeHtml(input.channel)}</td></tr>` : ""}
    </table>
    ${emailButton(input.url, "Ver campañas")}
  `;
  return { subject: `${copy.title}: ${input.campaignName}`, html: emailShell(copy.title, body) };
}

// ---------- Leads without contact ----------

export type StaleLeadRow = { contact: string; company: string; unit: string; createdAt: string };

export function buildStaleLeadsEmail(input: { recipientName: string | null; leads: StaleLeadRow[]; days: number; unassigned: boolean; url: string }): EmailContent {
  const rows = input.leads
    .map((lead) => `<tr><td style="${CELL}">${escapeHtml(lead.contact || "Sin contacto")}</td><td style="${CELL}">${escapeHtml(lead.company || "—")}</td><td style="${CELL}">${escapeHtml(lead.unit)}</td><td style="${CELL}white-space:nowrap;">${escapeHtml(lead.createdAt)}</td></tr>`)
    .join("");
  const intro = input.unassigned
    ? `Hay <strong>${input.leads.length}</strong> lead${input.leads.length === 1 ? "" : "s"} <strong>sin responsable</strong> que llevan más de ${input.days} días sin contactar. Conviene asignarlos a un comercial.`
    : `Tienes <strong>${input.leads.length}</strong> lead${input.leads.length === 1 ? "" : "s"} asignado${input.leads.length === 1 ? "" : "s"} que llevan más de ${input.days} días en estado "Nuevo".`;
  const body = `
    <p>Hola${input.recipientName ? ` ${escapeHtml(input.recipientName)}` : ""},</p>
    <p>${intro}</p>
    <table role="presentation" style="width:100%;border-collapse:collapse;margin-top:8px;">
      <tr><th style="${HEAD}">Contacto</th><th style="${HEAD}">Empresa</th><th style="${HEAD}">Marca</th><th style="${HEAD}">Alta</th></tr>
      ${rows}
    </table>
    ${emailButton(input.url, input.unassigned ? "Asignar leads" : "Ver mis leads")}
  `;
  const subject = input.unassigned
    ? `${input.leads.length} lead${input.leads.length === 1 ? "" : "s"} sin responsable y sin contactar`
    : `Tienes ${input.leads.length} lead${input.leads.length === 1 ? "" : "s"} sin contactar`;
  return { subject, html: emailShell("Leads pendientes de contactar", body, "Intec Commercial Hub", 620) };
}

// ---------- Monthly report ----------

export function buildMonthlyReportEmail(input: { monthLabel: string; stats: { label: string; value: string }[]; url: string }): EmailContent {
  const statCells = input.stats
    .map((stat) => `<td style="padding:12px;text-align:center;border:1px solid #eef0f6;"><div style="font-size:11px;color:#64748b;">${escapeHtml(stat.label)}</div><div style="font-size:20px;font-weight:800;margin-top:4px;">${escapeHtml(stat.value)}</div></td>`)
    .join("");
  const body = `
    <p>Este es el resumen automático de <strong>${escapeHtml(input.monthLabel)}</strong>. El informe completo de tickets va adjunto en PDF.</p>
    <table role="presentation" style="width:100%;border-collapse:collapse;margin-top:10px;"><tr>${statCells}</tr></table>
    ${emailButton(input.url, "Abrir el panel")}
  `;
  return { subject: `Informe mensual — ${input.monthLabel}`, html: emailShell(`Informe de ${input.monthLabel}`, body, "Intec Commercial Hub", 620) };
}

// ---------- Internal notice ----------

export function buildAnnouncementEmail(input: { senderName: string; title: string; body: string; url: string }): EmailContent {
  const paragraphs = escapeHtml(input.body).split(/\n{2,}/).map((block) => `<p>${block.replace(/\n/g, "<br>")}</p>`).join("");
  const html = emailShell(escapeHtml(input.title), `
    <p style="color:#64748b;font-size:13px;">Aviso de <strong>${escapeHtml(input.senderName)}</strong></p>
    ${paragraphs}
    ${emailButton(input.url, "Abrir el panel")}
  `);
  return { subject: `Aviso: ${input.title}`, html };
}
