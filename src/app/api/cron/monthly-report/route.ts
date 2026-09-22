import { NextResponse } from "next/server";
import { appOrigin } from "@/lib/app-origin";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { monthKey, monthLabel, monthRange, previousMonthKey } from "@/lib/dates";
import { isEmailConfigured, sendEmail } from "@/lib/email";
import { buildMonthlyReportEmail } from "@/lib/notification-emails";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPages } from "@/lib/supabase/fetch-all";
import { computeTicketDashboardCounts, mapTicketRow } from "@/lib/tickets/map";
import { renderTicketReportPdf } from "@/lib/tickets/ticket-report-pdf";

const TICKET_COLUMNS = "id, ticket_number, reporter_name, reporter_phone, reporter_email, department, title, category, description, started_at, blocking_level, restarted, has_error_message, error_message, priority, status, created_at, updated_at, resolved_at, closed_at, archived_at";

function recipients(): string[] {
  const configured = (process.env.MONTHLY_REPORT_EMAILS ?? "").split(",").map((email) => email.trim()).filter(Boolean);
  if (configured.length) return configured;
  return process.env.ADMIN_EMAIL ? [process.env.ADMIN_EMAIL] : [];
}

// Runs on the 1st of each month and emails last month's summary plus the
// tickets PDF to MONTHLY_REPORT_EMAILS (comma separated; falls back to ADMIN_EMAIL).
export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  if (!isEmailConfigured()) return NextResponse.json({ skipped: "El envío de correos no está configurado." });
  const to = recipients();
  if (to.length === 0) return NextResponse.json({ skipped: "Sin destinatarios: configura MONTHLY_REPORT_EMAILS o ADMIN_EMAIL." });
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "Falta SUPABASE_SERVICE_ROLE_KEY." }, { status: 503 });

  const month = previousMonthKey(monthKey());
  const range = monthRange(month);
  const [tickets, inquiries, leads, wins] = await Promise.all([
    fetchAllPages((from, to_) => admin.from("tickets").select(TICKET_COLUMNS).is("archived_at", null).order("created_at").order("id").range(from, to_)),
    fetchAllPages((from, to_) => admin.from("inquiries").select("count").gte("created_at", range.start).lt("created_at", range.end).order("id").range(from, to_)),
    admin.from("leads").select("id", { count: "exact", head: true }).gte("created_at", range.start).lt("created_at", range.end),
    admin.from("lead_status_history").select("id", { count: "exact", head: true }).eq("new_status", "won").gte("changed_at", range.start).lt("changed_at", range.end),
  ]);
  const failure = tickets.error ?? inquiries.error ?? leads.error ?? wins.error;
  if (failure) {
    console.error("Cron monthly-report: error al leer datos", failure);
    return NextResponse.json({ error: "No se pudieron leer los datos del mes." }, { status: 500 });
  }

  const allTickets = tickets.data.map((row) => mapTicketRow(row as Record<string, unknown>));
  const counts = computeTicketDashboardCounts(allTickets, range, allTickets);
  const monthTickets = allTickets.filter((ticket) => ticket.createdAt >= range.start && ticket.createdAt < range.end);
  const label = monthLabel(month);
  const pdf = await renderTicketReportPdf({ periodLabel: label, counts, tickets: monthTickets });
  const inquiryTotal = inquiries.data.reduce((sum, row) => sum + Number(row.count ?? 1), 0);

  const ok = await sendEmail({
    to,
    ...buildMonthlyReportEmail({
      monthLabel: label,
      stats: [
        { label: "Consultas", value: String(inquiryTotal) },
        { label: "Leads nuevos", value: String(leads.count ?? 0) },
        { label: "Leads ganados", value: String(wins.count ?? 0) },
        { label: "Tickets creados", value: String(monthTickets.length) },
        { label: "Tickets resueltos", value: String(counts.resolvedPeriodCount) },
      ],
      url: `${appOrigin(request)}/dashboard`,
    }),
    attachments: [{ filename: `informe_tickets_${month}.pdf`, content: Buffer.from(pdf) }],
  });

  return ok ? NextResponse.json({ sent: to.length, month }) : NextResponse.json({ error: "No se pudo enviar el correo." }, { status: 502 });
}
