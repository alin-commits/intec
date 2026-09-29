import { NextResponse } from "next/server";
import { appOrigin } from "@/lib/app-origin";
import { hasAnyRole, leadTypeLabels, type LeadTypeValue } from "@/lib/constants";
import { isEmailConfigured, sendEmail } from "@/lib/email";
import { buildNewLeadEmail, type NewLeadRow } from "@/lib/notification-emails";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { AppRole } from "@/lib/types";

const LEAD_EDIT_ROLES: AppRole[] = ["admin", "commercial", "marketing"];

type Destinatario = { id: string; full_name: string | null; email: string | null; is_active: boolean };

/**
 * Aviso de lead nuevo, llamado por la página de Leads justo después de crearlo
 * o de añadirle responsables.
 *
 * Sin `avisarA` va a los responsables que tenga el lead, y si no tiene ninguno
 * a administración, que es quien los reparte. Con `avisarA` va solo a esos,
 * que es el caso de "acabo de asignarle este lead a alguien": los que ya lo
 * llevaban no necesitan enterarse otra vez.
 *
 * Que falle un correo no puede tumbar el guardado, así que la página lo llama
 * sin esperar la respuesta y aquí nunca se devuelve un error que asuste.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase no está configurado." }, { status: 503 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("full_name, roles, is_active").eq("id", user.id).maybeSingle();
  if (!profile?.is_active || !hasAnyRole(profile.roles as AppRole[], LEAD_EDIT_ROLES)) {
    return NextResponse.json({ error: "No tienes permiso." }, { status: 403 });
  }

  let leadId: string | undefined;
  let avisarA: string[] = [];
  try {
    const body = (await request.json()) as { leadId?: string; avisarA?: unknown };
    leadId = body.leadId;
    if (Array.isArray(body.avisarA)) avisarA = body.avisarA.filter((id): id is string => typeof id === "string");
  } catch {
    return NextResponse.json({ error: "No se pudo leer la solicitud." }, { status: 400 });
  }
  if (!leadId) return NextResponse.json({ error: "Falta el lead." }, { status: 400 });
  if (!isEmailConfigured()) return NextResponse.json({ skipped: "El envío de correos no está configurado." });

  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "El sistema no está disponible." }, { status: 503 });

  const { data: lead } = await admin
    .from("leads")
    .select("id, contact_name, client_company_name, phone, email, location, product_interest, lead_type, source, business_units(name), campaigns(name)")
    .eq("id", leadId)
    .maybeSingle();
  if (!lead) return NextResponse.json({ error: "Lead no encontrado." }, { status: 404 });

  // Si se pide avisar a alguien concreto, se avisa a ese. Si no, a quien lo
  // lleve; un fallo al leer la tabla se trata como "no lo lleva nadie" para
  // que el aviso acabe en administración en vez de perderse.
  let destinatarios: Destinatario[] = [];
  let sinResponsable = false;
  let ids = avisarA;
  if (ids.length === 0) {
    const { data: asignados } = await admin.from("lead_assignees").select("profile_id").eq("lead_id", leadId);
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
  if (correos.size === 0) return NextResponse.json({ skipped: "Sin destinatarios." });

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
    createdByName: (profile.full_name as string | null) ?? null,
    url: `${appOrigin(request)}/leads?q=${encodeURIComponent(lead.contact_name || lead.client_company_name || "")}`,
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
  return NextResponse.json({ sent, unassigned: sinResponsable });
}
