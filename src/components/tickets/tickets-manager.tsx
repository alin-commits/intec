"use client";

import { useEffect, useMemo, useState } from "react";
import { hasAnyRole } from "@/lib/constants";
import { reportSafeError } from "@/lib/errors";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { computeTicketDashboardCounts, mapTicketRow, OPEN_TICKET_STATUSES } from "@/lib/tickets/map";
import { TICKET_MANAGER_ROLES, TICKET_VIEW_ROLES } from "@/lib/tickets/constants";
import type { Ticket, TicketStatus } from "@/lib/tickets/types";
import { blankTicketFilters, TicketFilters, type TicketFilterState } from "./ticket-filters";
import { TicketDashboardCards } from "./ticket-dashboard-cards";
import { TicketTable, type TicketSortColumn, type TicketSortState } from "./ticket-table";
import { EmptyState } from "./empty-state";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";

const priorityRank: Record<Ticket["priority"], number> = { high: 3, medium: 2, low: 1 };
const PAGE_SIZE = 5;

export function TicketsManager() {
  const configured = isSupabaseConfigured();
  const [access, setAccess] = useState<"checking" | "allowed" | "denied">(configured ? "checking" : "denied");
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [filters, setFilters] = useState<TicketFilterState>(blankTicketFilters());
  const [sort, setSort] = useState<TicketSortState>({ column: "createdAt", direction: "desc" });
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [quickEditingId, setQuickEditingId] = useState<string | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeExpanded, setActiveExpanded] = useState(false);
  const [completedExpanded, setCompletedExpanded] = useState(false);
  const [pendingBulkAction, setPendingBulkAction] = useState<"archive" | "delete" | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  useEffect(() => {
    if (!configured) return;
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data: authData }) => {
      if (!authData.user) {
        setAccess("denied");
        return;
      }
      setCurrentUserId(authData.user.id);
      const { data: ownProfile } = await supabase.from("profiles").select("roles").eq("id", authData.user.id).maybeSingle();
      if (!ownProfile || !hasAnyRole(ownProfile.roles, TICKET_VIEW_ROLES)) {
        setAccess("denied");
        return;
      }
      setCanManage(hasAnyRole(ownProfile.roles, TICKET_MANAGER_ROLES));
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
  const counts = useMemo(() => computeTicketDashboardCounts(tickets), [tickets]);

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

  const activeTickets = useMemo(() => visibleTickets.filter((ticket) => OPEN_TICKET_STATUSES.includes(ticket.status)), [visibleTickets]);
  const completedTickets = useMemo(() => visibleTickets.filter((ticket) => !OPEN_TICKET_STATUSES.includes(ticket.status)), [visibleTickets]);

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

  function toggleSelect(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll(ids: string[]) {
    setSelectedIds((current) => {
      const allSelected = ids.length > 0 && ids.every((id) => current.has(id));
      const next = new Set(current);
      for (const id of ids) {
        if (allSelected) next.delete(id); else next.add(id);
      }
      return next;
    });
  }

  async function confirmBulkAction() {
    if (!pendingBulkAction || selectedIds.size === 0) return;
    setBulkBusy(true);
    setMessage(null);
    try {
      const ids = Array.from(selectedIds);
      const supabase = createClient();
      if (pendingBulkAction === "archive") {
        const { error } = await supabase.from("tickets").update({ archived_at: new Date().toISOString() }).in("id", ids);
        if (error) throw error;
        if (currentUserId) {
          await supabase.from("ticket_events").insert(ids.map((id) => ({ ticket_id: id, actor_id: currentUserId, event_type: "archived", new_value: "archived" })));
        }
        setMessage(`${ids.length} ticket${ids.length === 1 ? "" : "s"} archivado${ids.length === 1 ? "" : "s"}.`);
      } else {
        const { data: attachments } = await supabase.from("ticket_attachments").select("path").in("ticket_id", ids);
        const paths = (attachments ?? []).map((row) => row.path as string);
        if (paths.length > 0) await supabase.storage.from("ticket-attachments").remove(paths);
        const { error } = await supabase.from("tickets").delete().in("id", ids);
        if (error) throw error;
        setMessage(`${ids.length} ticket${ids.length === 1 ? "" : "s"} eliminado${ids.length === 1 ? "" : "s"}.`);
      }
      setTickets((current) => current.filter((ticket) => !ids.includes(ticket.id)));
      setSelectedIds(new Set());
      setPendingBulkAction(null);
    } catch (cause) {
      setMessage(reportSafeError(cause, "No se pudo completar la acción sobre los tickets seleccionados."));
    } finally {
      setBulkBusy(false);
    }
  }

  if (access === "checking") return <div className="page-stack" />;

  if (access === "denied") {
    return (
      <div className="page-stack">
        <section className="panel">
          <h2>No tienes permiso para ver esta página</h2>
          <p>Tickets no está disponible para tu rol.</p>
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

      {canManage && selectedIds.size > 0 ? (
        <section className="panel ticket-bulk-bar">
          <span><strong>{selectedIds.size}</strong> ticket{selectedIds.size === 1 ? "" : "s"} seleccionado{selectedIds.size === 1 ? "" : "s"}</span>
          <div className="ticket-bulk-actions">
            <button type="button" className="button button-secondary" onClick={() => setPendingBulkAction("archive")}>Archivar</button>
            <button type="button" className="button button-danger" onClick={() => setPendingBulkAction("delete")}>Eliminar</button>
            <button type="button" className="button button-secondary" onClick={() => setSelectedIds(new Set())}>Cancelar selección</button>
          </div>
        </section>
      ) : null}

      <section className="panel table-panel">
        <div className="panel-heading">
          <div><span className="eyebrow">Activos</span><h2>Tickets abiertos</h2></div>
          <span className="muted">{activeTickets.length} ticket{activeTickets.length === 1 ? "" : "s"}</span>
        </div>
        {activeTickets.length === 0 ? (
          <EmptyState title="Sin tickets abiertos" description="No hay incidencias abiertas que coincidan con los filtros seleccionados." />
        ) : (
          <>
            <TicketTable
              tickets={activeTickets.slice(0, activeExpanded ? activeTickets.length : PAGE_SIZE)}
              sort={sort}
              onSort={handleSort}
              onQuickStatusChange={(ticket, status) => void handleQuickStatusChange(ticket, status)}
              quickEditingId={quickEditingId}
              canManage={canManage}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelect}
              onToggleSelectAll={() => toggleSelectAll(activeTickets.slice(0, activeExpanded ? activeTickets.length : PAGE_SIZE).map((t) => t.id))}
            />
            {activeTickets.length > PAGE_SIZE ? (
              <div className="table-panel-footer">
                <button type="button" className="button button-secondary button-compact" onClick={() => setActiveExpanded((current) => !current)}>
                  {activeExpanded ? "Mostrar menos" : `Mostrar más (${activeTickets.length - PAGE_SIZE} más)`}
                </button>
              </div>
            ) : null}
          </>
        )}
      </section>

      <section className="panel table-panel">
        <div className="panel-heading">
          <div><span className="eyebrow">Completados</span><h2>Tickets resueltos y cerrados</h2></div>
          <span className="muted">{completedTickets.length} ticket{completedTickets.length === 1 ? "" : "s"}</span>
        </div>
        {completedTickets.length === 0 ? (
          <EmptyState title="Sin tickets completados" description="Los tickets resueltos o cerrados aparecerán aquí." />
        ) : (
          <>
            <TicketTable
              tickets={completedTickets.slice(0, completedExpanded ? completedTickets.length : PAGE_SIZE)}
              sort={sort}
              onSort={handleSort}
              onQuickStatusChange={(ticket, status) => void handleQuickStatusChange(ticket, status)}
              quickEditingId={quickEditingId}
              canManage={canManage}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelect}
              onToggleSelectAll={() => toggleSelectAll(completedTickets.slice(0, completedExpanded ? completedTickets.length : PAGE_SIZE).map((t) => t.id))}
            />
            {completedTickets.length > PAGE_SIZE ? (
              <div className="table-panel-footer">
                <button type="button" className="button button-secondary button-compact" onClick={() => setCompletedExpanded((current) => !current)}>
                  {completedExpanded ? "Mostrar menos" : `Mostrar más (${completedTickets.length - PAGE_SIZE} más)`}
                </button>
              </div>
            ) : null}
          </>
        )}
      </section>

      <ConfirmationDialog
        open={Boolean(pendingBulkAction)}
        title={pendingBulkAction === "delete" ? "¿Eliminar los tickets seleccionados?" : "¿Archivar los tickets seleccionados?"}
        confirmLabel={pendingBulkAction === "delete" ? "Eliminar" : "Archivar"}
        destructive={pendingBulkAction === "delete"}
        busy={bulkBusy}
        onCancel={() => setPendingBulkAction(null)}
        onConfirm={() => void confirmBulkAction()}
      >
        <p>
          {pendingBulkAction === "delete"
            ? `Se eliminarán ${selectedIds.size} ticket${selectedIds.size === 1 ? "" : "s"} de forma permanente, incluidas sus notas y archivos adjuntos. Esta acción no se puede deshacer.`
            : `${selectedIds.size} ticket${selectedIds.size === 1 ? "" : "s"} se archivará${selectedIds.size === 1 ? "" : "n"} y dejará${selectedIds.size === 1 ? "" : "n"} de aparecer en esta lista, pero se conserva${selectedIds.size === 1 ? "" : "n"} en el historial.`}
        </p>
      </ConfirmationDialog>
    </div>
  );
}
