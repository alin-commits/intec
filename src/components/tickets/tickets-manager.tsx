"use client";

import { useEffect, useMemo, useState } from "react";
import { reportSafeError } from "@/lib/errors";
import { monthKey, monthRange } from "@/lib/dates";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { mapTicketRow, OPEN_TICKET_STATUSES } from "@/lib/tickets/map";
import { TICKET_MANAGER_ROLES } from "@/lib/tickets/constants";
import type { Ticket, TicketStatus } from "@/lib/tickets/types";
import { blankTicketFilters, TicketFilters, type TicketFilterState } from "./ticket-filters";
import { TicketDashboardCards, type TicketDashboardCounts } from "./ticket-dashboard-cards";
import { TicketTable, type TicketSortColumn, type TicketSortState } from "./ticket-table";
import { EmptyState } from "./empty-state";

const priorityRank: Record<Ticket["priority"], number> = { high: 3, medium: 2, low: 1 };
const STALE_DAYS = 3;

function computeCounts(tickets: Ticket[]): TicketDashboardCounts {
  const now = Date.now();
  const staleThreshold = now - STALE_DAYS * 24 * 60 * 60 * 1000;
  const { start: monthStart, end: monthEnd } = monthRange(monthKey());
  return {
    newCount: tickets.filter((t) => t.status === "new").length,
    openCount: tickets.filter((t) => OPEN_TICKET_STATUSES.includes(t.status)).length,
    inProgressCount: tickets.filter((t) => t.status === "in_progress").length,
    pendingCount: tickets.filter((t) => t.status === "pending").length,
    resolvedThisMonthCount: tickets.filter((t) => t.status === "resolved" && t.resolvedAt && t.resolvedAt >= monthStart && t.resolvedAt < monthEnd).length,
    staleOpenCount: tickets.filter((t) => OPEN_TICKET_STATUSES.includes(t.status) && new Date(t.createdAt).getTime() < staleThreshold).length,
  };
}

export function TicketsManager() {
  const configured = isSupabaseConfigured();
  const [access, setAccess] = useState<"checking" | "allowed" | "denied">(configured ? "checking" : "denied");
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [filters, setFilters] = useState<TicketFilterState>(blankTicketFilters());
  const [sort, setSort] = useState<TicketSortState>({ column: "createdAt", direction: "desc" });
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [quickEditingId, setQuickEditingId] = useState<string | null>(null);

  useEffect(() => {
    if (!configured) return;
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data: authData }) => {
      if (!authData.user) {
        setAccess("denied");
        return;
      }
      setCurrentUserId(authData.user.id);
      const { data: ownProfile } = await supabase.from("profiles").select("role").eq("id", authData.user.id).maybeSingle();
      if (!ownProfile || !TICKET_MANAGER_ROLES.includes(ownProfile.role)) {
        setAccess("denied");
        return;
      }
      setAccess("allowed");
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
    });
  }, [configured]);

  const departments = useMemo(() => Array.from(new Set(tickets.map((t) => t.department))).sort((a, b) => a.localeCompare(b)), [tickets]);
  const counts = useMemo(() => computeCounts(tickets), [tickets]);

  const visibleTickets = useMemo(() => {
    const query = filters.query.trim().toLowerCase();
    const filtered = tickets.filter((ticket) => {
      const matchesQuery = !query || `${ticket.ticketNumber} ${ticket.reporterName} ${ticket.reporterPhone} ${ticket.title} ${ticket.description}`.toLowerCase().includes(query);
      const matchesStatus = filters.status === "all" || ticket.status === filters.status;
      const matchesPriority = filters.priority === "all" || ticket.priority === filters.priority;
      const matchesCategory = filters.category === "all" || ticket.category === filters.category;
      const matchesDepartment = filters.department === "all" || ticket.department === filters.department;
      const matchesFrom = !filters.dateFrom || ticket.createdAt >= filters.dateFrom;
      const matchesTo = !filters.dateTo || ticket.createdAt <= `${filters.dateTo}T23:59:59`;
      const matchesOpen = !filters.onlyOpen || OPEN_TICKET_STATUSES.includes(ticket.status);
      return matchesQuery && matchesStatus && matchesPriority && matchesCategory && matchesDepartment && matchesFrom && matchesTo && matchesOpen;
    });
    const direction = sort.direction === "asc" ? 1 : -1;
    return filtered.sort((a, b) => {
      if (sort.column === "priority") return (priorityRank[a.priority] - priorityRank[b.priority]) * direction;
      return a[sort.column].localeCompare(b[sort.column]) * direction;
    });
  }, [tickets, filters, sort]);

  function handleSort(column: TicketSortColumn) {
    setSort((current) => current.column === column ? { column, direction: current.direction === "asc" ? "desc" : "asc" } : { column, direction: "desc" });
  }

  async function handleQuickStatusChange(ticket: Ticket, status: TicketStatus) {
    if (status === ticket.status) return;
    setQuickEditingId(ticket.id);
    try {
      const patch: Record<string, unknown> = { status };
      if (status === "resolved") patch.resolved_at = new Date().toISOString();
      if (status === "closed") patch.closed_at = new Date().toISOString();
      const supabase = createClient();
      const { error } = await supabase.from("tickets").update(patch).eq("id", ticket.id);
      if (error) throw error;
      if (currentUserId) {
        await supabase.from("ticket_events").insert({ ticket_id: ticket.id, actor_id: currentUserId, event_type: "status_change", previous_value: ticket.status, new_value: status });
      }
      setTickets((current) => current.map((item) => item.id === ticket.id ? { ...item, status, updatedAt: new Date().toISOString() } : item));
    } catch (cause) {
      setMessage(reportSafeError(cause, "No se pudo actualizar el estado."));
    } finally {
      setQuickEditingId(null);
    }
  }

  if (access === "checking") return <div className="page-stack" />;

  if (access === "denied") {
    return (
      <div className="page-stack">
        <section className="panel">
          <h2>No tienes permiso para ver esta página</h2>
          <p>La gestión de tickets está reservada a administradores.</p>
        </section>
      </div>
    );
  }

  return (
    <div className="page-stack">
      <section className="section-heading">
        <div><span className="eyebrow">Soporte interno</span><h2>Tickets informáticos</h2><p>Incidencias enviadas desde /soporte por cualquier trabajador de la empresa.</p></div>
      </section>

      {message ? <div className="form-message" role="status">{message}</div> : null}

      <TicketDashboardCards counts={counts} />
      <TicketFilters filters={filters} departments={departments} resultCount={visibleTickets.length} onChange={setFilters} />

      <section className="panel table-panel">
        {visibleTickets.length === 0 ? (
          <EmptyState title="Sin tickets" description="No hay incidencias que coincidan con los filtros seleccionados." />
        ) : (
          <TicketTable tickets={visibleTickets} sort={sort} onSort={handleSort} onQuickStatusChange={(ticket, status) => void handleQuickStatusChange(ticket, status)} quickEditingId={quickEditingId} />
        )}
      </section>
    </div>
  );
}
