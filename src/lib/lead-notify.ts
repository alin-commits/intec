import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { leadTypeLabels, type LeadTypeValue } from "@/lib/constants";
import { isEmailConfigured, sendEmail } from "@/lib/email";
import { buildNewLeadEmail, type NewLeadRow } from "@/lib/notification-emails";

type Destinatario = { id: string; full_name: string | null; email: string | null; is_active: boolean };

export type NotifyResult = { sent: number; unassigned: boolean } | { skipped: string } | { error: string };

/**
 * Aviso por correo de un lead nuevo. Lo usan la página de Leads (al crear o
 * asignar) y la entrada de los formularios de Meta.
 *
 * Sin `avisarA` va a los responsables que tenga el lead, y si no tiene ninguno
 * a administración, que es quien los reparte. Con `avisarA` va solo a esos,
 * que es el caso de "acabo de asignarle este lead a alguien": los que ya lo
 * llevaban no necesitan enterarse otra vez.
 */
export async function notifyNewLead(admin: SupabaseClient, input: {
  leadId: string;
  avisarA?: string[];
  /** Quién lo ha creado, para el correo ("Meta Ads" si entra solo). */
  createdByName: string | null;
  /** La dirección de la aplicación, para el enlace del correo. */
  origin: string;
}): Promise<NotifyResult> {
  if (!isEmailConfigured()) return { skipped: "El envío de correos no está configurado." };

  const { data: lead } = await admin
    .from("leads")
    .select("id, contact_name, client_company_name, phone, email, location, product_interest, lead_type, source, business_units(name), campaigns(name)")
    .eq("id", input.leadId)
    .maybeSingle();
  if (!lead) return { error: "Lead no encontrado." };

  // Si se pide avisar a alguien concreto, se avisa a ese. Si no, a quien lo
  // lleve; un fallo al leer la tabla se trata como "no lo lleva nadie" para
  // que el aviso acabe en administración en vez de perderse.
  let destinatarios: Destinatario[] = [];
  let sinResponsable = false;
  let ids = input.avisarA ?? [];
  if (ids.length === 0) {
    const { data: asignados } = await admin.from("lead_assignees").select("profile_id").eq("lead_id", input.leadId);
    ids = (asignados ?? []).map((row) => row.profile_id as string);
  }
  if (ids.length > 0) {
    const { data } = await admin.from("profiles").select("id, full_name, email, is_active").in("id", ids);
    destinatarios = ((data ?? []) as Destinatario[]).filter((row) => row.is_active && row.email);
  }
  if (destinatarios.length === 0) {
    sinResponsable = true;
    const { data } = await admin.from("profiles").select("id, full_name, email, is_active").eq("is_active", true).overlaps("roles", ["admin"]).not("email", "is", null);
    destinatarios = (data ?? []) as Destinatario[];
  }

  const correos = new Set(destinatarios.map((row) => row.email as string));
  if (sinResponsable && process.env.ADMIN_EMAIL) correos.add(process.env.ADMIN_EMAIL);
  if (correos.size === 0) return { skipped: "Sin destinatarios." };

  const nombreDe = (valor: unknown): string => {
    const fila = Array.isArray(valor) ? valor[0] : valor;
    return (fila as { name?: string } | null)?.name ?? "";
  };
  const tipo = lead.lead_type ? leadTypeLabels[lead.lead_type as LeadTypeValue] : "";
  const fields: NewLeadRow[] = [
    { label: "Empresa", value: lead.client_company_name ?? "" },
    { label: "Marca", value: nombreDe(lead.business_units) || "—" },
    { label: "Campaña", value: nombreDe(lead.campaigns) || "General" },
    { label: "Teléfono", value: lead.phone ?? "" },
    { label: "Email", value: lead.email ?? "" },
    { label: "Población", value: lead.location ?? "" },
    { label: "Interés", value: lead.product_interest ?? "" },
    { label: "Tipo", value: tipo },
    { label: "Fuente", value: lead.source ?? "" },
  ];
  const comun = {
    contact: lead.contact_name ?? "",
    company: lead.client_company_name ?? "",
    unit: nombreDe(lead.business_units) || "—",
    fields,
    unassigned: sinResponsable,
    createdByName: input.createdByName,
    url: `${input.origin}/leads?q=${encodeURIComponent(lead.contact_name || lead.client_company_name || "")}`,
  };

  // A los responsables, uno a uno para poder saludarles por su nombre. A
  // administración, un solo correo para no repetirlo tantas veces como admins.
  let sent = 0;
  if (sinResponsable) {
    const ok = await sendEmail({ to: Array.from(correos), ...buildNewLeadEmail({ recipientName: null, ...comun }) });
    if (ok) sent++;
  } else {
    for (const destinatario of destinatarios) {
      const ok = await sendEmail({ to: destinatario.email as string, ...buildNewLeadEmail({ recipientName: destinatario.full_name, ...comun }) });
      if (ok) sent++;
    }
  }
  return { sent, unassigned: sinResponsable };
}
