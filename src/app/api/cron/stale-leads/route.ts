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
export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  if (!isEmailConfigured()) return NextResponse.json({ skipped: "El envío de correos no está configurado." });
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "Falta SUPABASE_SERVICE_ROLE_KEY." }, { status: 503 });

  const before = new Date(Date.now() - STALE_DAYS * 86400000).toISOString();
  const [{ data: leads, error: leadsError }, { data: units }] = await Promise.all([
    fetchAllPages((from, to) => admin.from("leads").select("id, contact_name, client_company_name, business_unit_id, created_at, assigned_to").eq("status", "new").lt("created_at", before).order("created_at").order("id").range(from, to)),
    admin.from("business_units").select("id, name"),
  ]);
  if (leadsError) {
    console.error("Cron stale-leads: no se pudieron leer los leads", leadsError);
    return NextResponse.json({ error: "No se pudieron leer los leads." }, { status: 500 });
  }
  if (leads.length === 0) return NextResponse.json({ sent: 0 });

  const unitName = new Map((units ?? []).map((unit) => [unit.id as string, unit.name as string]));
  const ownerIds = Array.from(new Set(leads.map((lead) => lead.assigned_to).filter((id): id is string => Boolean(id))));
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
    if (lead.assigned_to && reachableOwners.has(lead.assigned_to)) {
      const list = byOwner.get(lead.assigned_to) ?? [];
      list.push(toRow(lead));
      byOwner.set(lead.assigned_to, list);
    } else {
      unassigned.push(toRow(lead));
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
