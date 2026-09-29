import { NextResponse } from "next/server";
import { appOrigin } from "@/lib/app-origin";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { isEmailConfigured, sendEmail } from "@/lib/email";
import { formatDate } from "@/lib/format";
import { buildStaleLeadsEmail, type StaleLeadRow } from "@/lib/notification-emails";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPages } from "@/lib/supabase/fetch-all";

const STALE_DAYS = 3;

// Weekday reminder: each commercial gets the leads they own that are still
// "new" after STALE_DAYS; leads with no (active) owner go to the admins.
// A lead can have several owners, so the same lead may show up in more than one
// email — that is on purpose: both of them have to call.
export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  if (!isEmailConfigured()) return NextResponse.json({ skipped: "El envío de correos no está configurado." });
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "Falta SUPABASE_SERVICE_ROLE_KEY." }, { status: 503 });

  const before = new Date(Date.now() - STALE_DAYS * 86400000).toISOString();
  const [{ data: leads, error: leadsError }, { data: units }, { data: asignados, error: asignadosError }] = await Promise.all([
    fetchAllPages((from, to) => admin.from("leads").select("id, contact_name, client_company_name, business_unit_id, created_at").eq("status", "new").lt("created_at", before).order("created_at").order("id").range(from, to)),
    admin.from("business_units").select("id, name"),
    // Solo los responsables de leads que siguen sin contactar: el filtro lo
    // hace la base de datos con el join, no el servidor con una lista de ids.
    fetchAllPages<{ lead_id: string; profile_id: string }>((from, to) => admin.from("lead_assignees").select("lead_id, profile_id, leads!inner(status, created_at)").eq("leads.status", "new").lt("leads.created_at", before).order("lead_id").order("profile_id").range(from, to)),
  ]);
  if (leadsError) {
    console.error("Cron stale-leads: no se pudieron leer los leads", leadsError);
    return NextResponse.json({ error: "No se pudieron leer los leads." }, { status: 500 });
  }
  if (asignadosError) {
    console.error("Cron stale-leads: no se pudieron leer los responsables", asignadosError);
    return NextResponse.json({ error: "No se pudieron leer los responsables." }, { status: 500 });
  }
  if (leads.length === 0) return NextResponse.json({ sent: 0 });

  const unitName = new Map((units ?? []).map((unit) => [unit.id as string, unit.name as string]));
  const ownersOfLead = new Map<string, string[]>();
  for (const fila of asignados) {
    const lista = ownersOfLead.get(fila.lead_id) ?? [];
    lista.push(fila.profile_id);
    ownersOfLead.set(fila.lead_id, lista);
  }
  const ownerIds = Array.from(new Set(asignados.map((fila) => fila.profile_id)));
  const [{ data: owners }, { data: admins }] = await Promise.all([
    ownerIds.length ? admin.from("profiles").select("id, full_name, email, is_active").in("id", ownerIds) : Promise.resolve({ data: [] as { id: string; full_name: string | null; email: string | null; is_active: boolean }[] }),
    admin.from("profiles").select("email").eq("is_active", true).overlaps("roles", ["admin"]).not("email", "is", null),
  ]);
  const reachableOwners = new Map((owners ?? []).filter((owner) => owner.is_active && owner.email).map((owner) => [owner.id as string, owner]));

  const toRow = (lead: (typeof leads)[number]): StaleLeadRow => ({
    contact: lead.contact_name ?? "",
    company: lead.client_company_name ?? "",
    unit: unitName.get(lead.business_unit_id) ?? "—",
    createdAt: formatDate(lead.created_at),
  });

  const byOwner = new Map<string, StaleLeadRow[]>();
  const unassigned: StaleLeadRow[] = [];
  for (const lead of leads) {
    // Un responsable dado de baja no recibe nada, así que su lead cuenta como
    // huérfano y acaba en el correo de administración.
    const owners = (ownersOfLead.get(lead.id) ?? []).filter((id) => reachableOwners.has(id));
    if (owners.length === 0) {
      unassigned.push(toRow(lead));
      continue;
    }
    for (const ownerId of owners) {
      const list = byOwner.get(ownerId) ?? [];
      list.push(toRow(lead));
      byOwner.set(ownerId, list);
    }
  }

  const origin = appOrigin(request);
  let sent = 0;
  for (const [ownerId, rows] of byOwner) {
    const owner = reachableOwners.get(ownerId)!;
    const ok = await sendEmail({ to: owner.email as string, ...buildStaleLeadsEmail({ recipientName: owner.full_name, leads: rows, days: STALE_DAYS, unassigned: false, url: `${origin}/leads?owner=mine` }) });
    if (ok) sent++;
  }

  const adminEmails = new Set((admins ?? []).map((row) => row.email as string));
  if (process.env.ADMIN_EMAIL) adminEmails.add(process.env.ADMIN_EMAIL);
  if (unassigned.length && adminEmails.size) {
    const ok = await sendEmail({ to: Array.from(adminEmails), ...buildStaleLeadsEmail({ recipientName: null, leads: unassigned, days: STALE_DAYS, unassigned: true, url: `${origin}/leads` }) });
    if (ok) sent++;
  }

  return NextResponse.json({ sent, owners: byOwner.size, unassigned: unassigned.length });
}
