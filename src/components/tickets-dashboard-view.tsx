"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { reportSafeError } from "@/lib/errors";
import { computeTicketDashboardCounts, mapTicketRow } from "@/lib/tickets/map";
import { ticketCategoryLabels } from "@/lib/tickets/constants";
import { formatDate } from "@/lib/format";
import type { Ticket } from "@/lib/tickets/types";
import { TicketDashboardCards } from "@/components/tickets/ticket-dashboard-cards";
import { TicketPriorityBadge } from "@/components/tickets/ticket-priority-badge";
import { TicketStatusBadge } from "@/components/tickets/ticket-status-badge";
import { EmptyState } from "@/components/tickets/empty-state";

export function TicketsDashboardView() {
  const configured = isSupabaseConfigured();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!configured) return;
    void (async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("tickets")
        .select("id, ticket_number, reporter_name, reporter_phone, reporter_email, department, title, category, description, started_at, blocking_level, restarted, has_error_message, error_message, priority, status, created_at, updated_at, resolved_at, closed_at, archived_at")
        .is("archived_at", null)
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) {
        setMessage(reportSafeError(error, "No se pudieron cargar los tickets."));
        return;
      }
      setTickets((data ?? []).map((row) => mapTicketRow(row as Record<string, unknown>)));
    })();
  }, [configured]);

  const counts = useMemo(() => computeTicketDashboardCounts(tickets), [tickets]);
  const recentTickets = useMemo(() => tickets.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 8), [tickets]);

  return (
    <div className="page-stack">
      <section className="section-heading">
        <div><span className="eyebrow">Soporte interno</span><h2>Resumen de tickets</h2><p>Vista rápida de las incidencias informáticas. Para gestionarlas, entra en Tickets.</p></div>
        <Link href="/tickets" className="button button-primary">Ver todos los tickets</Link>
      </section>

      {message ? <div className="form-message" role="status">{message}</div> : null}

      <TicketDashboardCards counts={counts} />

      <section className="panel table-panel">
        <div className="panel-heading"><div><span className="eyebrow">Actividad reciente</span><h2>Últimos tickets actualizados</h2></div></div>
        {recentTickets.length === 0 ? (
          <EmptyState title="Sin tickets" description="Todavía no hay incidencias registradas." />
        ) : (
          <div className="table-scroll">
            <table>
              <thead><tr><th>Nº ticket</th><th>Departamento</th><th>Título</th><th>Categoría</th><th>Prioridad</th><th>Estado</th><th>Última actualización</th></tr></thead>
              <tbody>
                {recentTickets.map((ticket) => (
                  <tr key={ticket.id}>
                    <td><Link href={`/tickets/${ticket.id}`} className="sort-button"><strong>{ticket.ticketNumber}</strong></Link></td>
                    <td>{ticket.department}</td>
                    <td>{ticket.title}</td>
                    <td>{ticketCategoryLabels[ticket.category]}</td>
                    <td><TicketPriorityBadge priority={ticket.priority} /></td>
                    <td><TicketStatusBadge status={ticket.status} /></td>
                    <td>{formatDate(ticket.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
