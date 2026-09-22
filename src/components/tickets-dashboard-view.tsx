"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { fetchAllPages } from "@/lib/supabase/fetch-all";
import { reportSafeError } from "@/lib/errors";
import { computeTicketDashboardCounts, mapTicketRow } from "@/lib/tickets/map";
import { ticketCategoryLabels, ticketCategoryOrder } from "@/lib/tickets/constants";
import { DonutChart, type DonutItem } from "@/components/charts/donut-chart";
import { formatDate } from "@/lib/format";
import type { Ticket } from "@/lib/tickets/types";
import { TicketDashboardCards, TicketPriorityPanel } from "@/components/tickets/ticket-dashboard-cards";
import { TicketPriorityBadge } from "@/components/tickets/ticket-priority-badge";
import { Toast } from "@/components/ui/toast";
import { TicketStatusBadge } from "@/components/tickets/ticket-status-badge";
import { EmptyState } from "@/components/tickets/empty-state";

const CATEGORY_COLORS = ["#4f46e5", "#0ea5e9", "#10b981", "#f59e0b"];

export function TicketsDashboardView() {
  const configured = isSupabaseConfigured();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!configured) return;
    void (async () => {
      const supabase = createClient();
      const { data, error } = await fetchAllPages((from, to) => supabase.from("tickets").select("id, ticket_number, reporter_name, reporter_phone, reporter_email, department, title, category, description, started_at, blocking_level, restarted, has_error_message, error_message, priority, status, created_at, updated_at, resolved_at, closed_at, archived_at").is("archived_at", null).order("created_at", { ascending: false }).order("id").range(from, to));
      if (error) {
        setMessage(reportSafeError(error, "No se pudieron cargar los tickets."));
        return;
      }
      setTickets((data ?? []).map((row) => mapTicketRow(row as Record<string, unknown>)));
    })();
  }, [configured]);

  const counts = useMemo(() => computeTicketDashboardCounts(tickets, undefined, tickets), [tickets]);
  const categoryItems: DonutItem[] = useMemo(() => ticketCategoryOrder.map((category, index) => ({
    label: ticketCategoryLabels[category],
    value: tickets.filter((ticket) => ticket.category === category).length,
    color: CATEGORY_COLORS[index % CATEGORY_COLORS.length],
  })), [tickets]);
  const recentTickets = useMemo(() => tickets.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 8), [tickets]);

  return (
    <div className="page-stack">
      <section className="section-heading">
        <div><span className="eyebrow">Soporte interno</span><h2>Resumen de tickets</h2><p>Vista rápida de las incidencias informáticas. Para gestionarlas, entra en Tickets.</p></div>
        <Link href="/tickets" className="button button-primary">Ver todos los tickets</Link>
      </section>

      <Toast message={message} onDismiss={() => setMessage(null)} />

      <TicketDashboardCards counts={counts} periodLabel="todo el histórico" />

      <section className="dashboard-grid">
        <article className="panel chart-panel">
          <div className="panel-heading"><div><h2>Por categoría</h2><p className="panel-subtitle">Todo el histórico</p></div></div>
          <DonutChart items={categoryItems} centerLabel="tickets" ariaLabel="Tickets por categoría" emptyMessage="Todavía no hay tickets." />
        </article>
        <TicketPriorityPanel counts={counts} periodLabel="Todo el histórico" />
      </section>

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
