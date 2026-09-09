import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isEmailConfigured, sendEmail } from "@/lib/email";
import { buildTicketResolvedEmail } from "@/lib/tickets/email-templates";
import { TICKET_MANAGER_ROLES } from "@/lib/tickets/constants";
import { hasAnyRole } from "@/lib/constants";
import type { AppRole } from "@/lib/types";

export async function POST(request: Request) {
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase no está configurado." }, { status: 503 });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("roles, is_active").eq("id", user.id).maybeSingle();
  if (!profile || !profile.is_active || !hasAnyRole(profile.roles as AppRole[], TICKET_MANAGER_ROLES)) {
    return NextResponse.json({ error: "No tienes permiso." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "No se pudo leer la solicitud." }, { status: 400 });
  }
  const ticketId = (body as { ticketId?: string })?.ticketId;
  if (!ticketId) return NextResponse.json({ error: "Falta el ticket." }, { status: 400 });

  if (!isEmailConfigured()) return NextResponse.json({ ok: true, sent: false });

  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ ok: true, sent: false });

  const { data: ticket } = await admin
    .from("tickets")
    .select("ticket_number, title, reporter_name, reporter_email, status, resolved_at")
    .eq("id", ticketId)
    .maybeSingle();

  if (!ticket || ticket.status !== "resolved" || !ticket.reporter_email) {
    return NextResponse.json({ ok: true, sent: false });
  }

  const { data: resolutionNoteRow } = await admin
    .from("ticket_notes")
    .select("content")
    .eq("ticket_id", ticketId)
    .eq("note_type", "resolution")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const origin = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
  const sent = await sendEmail({
    to: ticket.reporter_email,
    ...buildTicketResolvedEmail({
      ticketNumber: ticket.ticket_number,
      title: ticket.title,
      reporterName: ticket.reporter_name,
      resolvedAt: ticket.resolved_at ?? new Date().toISOString(),
      resolutionNote: resolutionNoteRow?.content ?? null,
      origin,
    }),
  });
  if (!sent) console.error("No se pudo enviar el email de ticket resuelto vía Resend.");

  return NextResponse.json({ ok: true, sent });
}
