import { NextResponse } from "next/server";
import { appOrigin } from "@/lib/app-origin";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { isEmailConfigured, sendEmail } from "@/lib/email";
import { buildPendingTicketsEmail, type PendingTicketRow } from "@/lib/notification-emails";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPages } from "@/lib/supabase/fetch-all";
import { OPEN_TICKET_STATUSES } from "@/lib/tickets/map";
import { ticketPriorityLabels, ticketStatusLabels } from "@/lib/tickets/constants";
import type { TicketPriority, TicketStatus } from "@/lib/tickets/types";

/*
  El repaso de los tickets que siguen abiertos, por correo.

  Esto ya estaba en la campana del Hub, pero solo ahí: si quien lleva
  informática no entraba, un ticket urgente podía pasarse el día esperando sin
  que nadie lo supiera. Un aviso que depende de que alguien mire no es un aviso.

  Va a quien gestiona los tickets —informática y administración—, que son los
  mismos que los ven en la aplicación. Si no hay nada pendiente no se manda
  nada: un correo diario diciendo "todo bien" se deja de leer a la semana.
*/

const STALE_DAYS = 3;

const antiguedad = (desde: string): string => {
  const dias = Math.floor((Date.now() - new Date(desde).getTime()) / 86400000);
  if (dias <= 0) return "hoy";
  return dias === 1 ? "1 día" : `${dias} días`;
};

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  if (!isEmailConfigured()) return NextResponse.json({ skipped: "El envío de correos no está configurado." });
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "Falta SUPABASE_SERVICE_ROLE_KEY." }, { status: 503 });

  const { data: abiertos, error } = await fetchAllPages<{
    ticket_number: string; title: string; reporter_name: string; priority: TicketPriority; status: TicketStatus; created_at: string;
  }>((from, to) => admin
    .from("tickets")
    .select("ticket_number, title, reporter_name, priority, status, created_at")
    .in("status", OPEN_TICKET_STATUSES)
    .is("archived_at", null)
    .order("created_at")
    .order("ticket_number")
    .range(from, to));

  if (error) {
    console.error("Cron stale-tickets: no se pudieron leer los tickets", error);
    return NextResponse.json({ error: "No se pudieron leer los tickets." }, { status: 500 });
  }

  const fila = (t: (typeof abiertos)[number]): PendingTicketRow => ({
    number: t.ticket_number,
    title: t.title,
    reporter: t.reporter_name,
    priority: ticketPriorityLabels[t.priority] ?? t.priority,
    status: ticketStatusLabels[t.status] ?? t.status,
    age: antiguedad(t.created_at),
  });

  const limite = Date.now() - STALE_DAYS * 86400000;
  const urgent = abiertos.filter((t) => t.priority === "high").map(fila);
  // Un ticket urgente ya sale arriba; no hace falta repetirlo en la otra lista.
  const stale = abiertos.filter((t) => t.priority !== "high" && new Date(t.created_at).getTime() < limite).map(fila);

  if (urgent.length === 0 && stale.length === 0) return NextResponse.json({ sent: 0, reason: "No hay tickets pendientes." });

  const { data: destinatarios } = await admin
    .from("profiles")
    .select("full_name, email")
    .eq("is_active", true)
    .overlaps("roles", ["admin", "it"])
    .not("email", "is", null);

  const gente = (destinatarios ?? []) as { full_name: string | null; email: string }[];
  if (gente.length === 0) return NextResponse.json({ skipped: "Sin destinatarios." });

  const url = `${appOrigin(request)}/tickets`;
  let sent = 0;
  for (const persona of gente) {
    const ok = await sendEmail({
      to: persona.email,
      ...buildPendingTicketsEmail({ recipientName: persona.full_name, urgent, stale, staleDays: STALE_DAYS, url }),
    });
    if (ok) sent++;
  }

  return NextResponse.json({ sent, urgent: urgent.length, stale: stale.length });
}
