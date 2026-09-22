"use client";

import { useEffect, useMemo, useState } from "react";
import { TrendChart } from "@/components/charts/trend-chart";
import { Toast } from "@/components/ui/toast";
import { hasAnyRole } from "@/lib/constants";
import { downloadCsvReport, type CsvSummaryItem } from "@/lib/csv-export";
import { inDateKeyRange, monthKey, monthKeyInMadrid, monthLabel, monthRange, monthShortLabel, monthWeekBuckets, yearOfMonth, yearRange } from "@/lib/dates";
import { reportSafeError } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { fetchAllPages } from "@/lib/supabase/fetch-all";
import { computeTicketDashboardCounts, mapTicketRow, OPEN_TICKET_STATUSES } from "@/lib/tickets/map";
import { TICKET_MANAGER_ROLES, TICKET_VIEW_ROLES, ticketBlockingLevelLabels, ticketCategoryLabels, ticketPriorityLabels, ticketStatusLabels } from "@/lib/tickets/constants";
import { exportTicketReportPdf } from "@/lib/tickets/ticket-report-pdf";
import type { Ticket, TicketStatus } from "@/lib/tickets/types";
import { blankTicketFilters, TicketFilters, type TicketFilterState } from "./ticket-filters";
import { QuickCreateTicketButton } from "./quick-create-ticket-button";
import { TicketDashboardCards, TicketPriorityPanel } from "./ticket-dashboard-cards";
import { TicketTable, type TicketSortColumn, type TicketSortState } from "./ticket-table";
import { EmptyState } from "./empty-state";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { ReportExportButtons } from "@/components/ui/report-export-buttons";

const priorityRank: Record<Ticket["priority"], number> = { high: 3, medium: 2, low: 1 };
const PAGE_SIZE = 5;
const COMPLETED_PAGE_SIZE = 10;

function monthsOfYear(year: number): string[] {
  return Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, "0")}`);
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
  const [canManage, setCanManage] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeExpanded, setActiveExpanded] = useState(false);
  const [completedPage, setCompletedPage] = useState(1);
  const [pendingBulkAction, setPendingBulkAction] = useState<"archive" | "delete" | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [chartMode, setChartMode] = useState<"month" | "year" | "total">("year");
  const [chartMonth, setChartMonth] = useState(() => monthKey());
  const [chartYear, setChartYear] = useState(() => yearOfMonth(monthKey()));

  async function loadTickets() {
    const supabase = createClient();
    const { data, error } = await fetchAllPages((from, to) => supabase.from("tickets").select("id, ticket_number, reporter_name, reporter_phone, reporter_email, department, title, category, description, started_at, blocking_level, restarted, has_error_message, error_message, priority, status, created_at, updated_at, resolved_at, closed_at, archived_at").is("archived_at", null).order("created_at", { ascending: false }).order("id").range(from, to));
    if (error) {
      setMessage(reportSafeError(error, "No se pudieron cargar los tickets."));
      return;
    }
    setTickets((data ?? []).map((row) => mapTicketRow(row as Record<string, unknown>)));
  }

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
      await loadTickets();
    });
  }, [configured]);

  const departments = useMemo(() => Array.from(new Set(tickets.map((t) => t.department))).sort((a, b) => a.localeCompare(b)), [tickets]);

  const visibleTickets = useMemo(() => {
    const query = filters.query.trim().toLowerCase();
    const filtered = tickets.filter((ticket) => {
      const matchesQuery = !query || `${ticket.ticketNumber} ${ticket.reporterName} ${ticket.reporterPhone} ${ticket.title} ${ticket.description}`.toLowerCase().includes(query);
      const matchesStatus = filters.status === "all" || ticket.status === filters.status;
      const matchesPriority = filters.priority === "all" || ticket.priority === filters.priority;
      const matchesCategory = filters.category === "all" || ticket.category === filters.category;
      const matchesDepartment = filters.department === "all" || ticket.department === filters.department;
      const matchesDates = inDateKeyRange(ticket.createdAt, filters.dateFrom, filters.dateTo);
      const matchesOpen = !filters.onlyOpen || OPEN_TICKET_STATUSES.includes(ticket.status);
      return matchesQuery && matchesStatus && matchesPriority && matchesCategory && matchesDepartment && matchesDates && matchesOpen;
    });
    const direction = sort.direction === "asc" ? 1 : -1;
    return filtered.sort((a, b) => {
      if (sort.column === "priority") return (priorityRank[a.priority] - priorityRank[b.priority]) * direction;
      return a[sort.column].localeCompare(b[sort.column]) * direction;
    });
  }, [tickets, filters, sort]);

  // Un único selector de "Periodo" gobierna tarjetas, gráficos y exportación.
  const period = useMemo(() => {
    if (chartMode === "month") return monthRange(chartMonth);
    if (chartMode === "year") return yearRange(chartYear);
    return undefined;
  }, [chartMode, chartMonth, chartYear]);
  const periodLabel = chartMode === "month" ? monthLabel(chartMonth) : chartMode === "year" ? String(chartYear) : "todo el histórico";
  const counts = useMemo(() => computeTicketDashboardCounts(visibleTickets, period, tickets), [visibleTickets, period, tickets]);
  // Lo que se exporta (CSV/PDF) sigue el mismo periodo elegido arriba: "Todo
  // el histórico" exporta todo, un mes/año concreto exporta solo ese tramo.
  const exportTickets = useMemo(
    () => (period ? visibleTickets.filter((t) => t.createdAt >= period.start && t.createdAt < period.end) : visibleTickets),
    [visibleTickets, period],
  );


  const activeTickets = useMemo(() => visibleTickets.filter((ticket) => OPEN_TICKET_STATUSES.includes(ticket.status)), [visibleTickets]);
  const completedTickets = useMemo(() => visibleTickets.filter((ticket) => !OPEN_TICKET_STATUSES.includes(ticket.status)), [visibleTickets]);

  const completedTotalPages = Math.max(1, Math.ceil(completedTickets.length / COMPLETED_PAGE_SIZE));
  const effectiveCompletedPage = Math.min(completedPage, completedTotalPages);
  const completedPageTickets = useMemo(() => {
    const start = (effectiveCompletedPage - 1) * COMPLETED_PAGE_SIZE;
    return completedTickets.slice(start, start + COMPLETED_PAGE_SIZE);
  }, [completedTickets, effectiveCompletedPage]);

  const availableChartYears = useMemo(() => {
    const years = new Set(visibleTickets.map((ticket) => yearOfMonth(monthKeyInMadrid(ticket.createdAt))));
    years.add(yearOfMonth(monthKey()));
    return Array.from(years).sort();
  }, [visibleTickets]);

  const monthlyCounts = useMemo(() => {
    if (chartMode === "month") {
      return monthWeekBuckets(chartMonth).map((bucket) => ({
        key: bucket.key,
        label: `Semana ${bucket.label}`,
        count: visibleTickets.filter((ticket) => ticket.createdAt >= bucket.start && ticket.createdAt < bucket.end).length,
      }));
    }
    const byMonth = new Map<string, number>();
    for (const ticket of visibleTickets) {
      const month = monthKeyInMadrid(ticket.createdAt);
      byMonth.set(month, (byMonth.get(month) ?? 0) + 1);
    }
    if (chartMode === "year") {
      return monthsOfYear(chartYear).map((month) => ({ key: month, label: monthShortLabel(month), count: byMonth.get(month) ?? 0 }));
    }
    return Array.from(byMonth.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, count]) => ({ key: month, label: monthShortLabel(month), count }));
  }, [visibleTickets, chartMode, chartMonth, chartYear]);

  const monthlyChartData = useMemo(() => monthlyCounts.map(({ label, count }) => ({ label, count })), [monthlyCounts]);

  function exportReportCsv() {
    const summary: CsvSummaryItem[] = [
      { label: `Tickets exportados (${periodLabel})`, value: exportTickets.length },
      { label: `Tickets nuevos (${periodLabel})`, value: counts.newCount },
      { label: `Tickets abiertos (${periodLabel})`, value: counts.openCount },
      { label: `En curso (${periodLabel})`, value: counts.inProgressCount },
      { label: `Pendientes (${periodLabel})`, value: counts.pendingCount },
      { label: `Resueltos (${periodLabel})`, value: counts.resolvedPeriodCount },
      { label: "Resueltos en total", value: counts.resolvedTotalCount },
      { label: `Tardaron +3 días (${periodLabel})`, value: counts.staleCount },
      { label: `Prioridad alta (${periodLabel})`, value: counts.highPriorityCount },
      { label: `Prioridad media (${periodLabel})`, value: counts.mediumPriorityCount },
      { label: `Prioridad baja (${periodLabel})`, value: counts.lowPriorityCount },
      ...monthlyCounts.map(({ label, count }) => ({ label: `Tickets en ${label}`, value: count })),
    ];
    downloadCsvReport(`informe_tickets_${new Date().toISOString().slice(0, 10)}.csv`, summary, exportTickets, [
      { header: "Ticket", value: (ticket) => ticket.ticketNumber },
      { header: "Fecha", value: (ticket) => formatDate(ticket.createdAt) },
      { header: "Solicitante", value: (ticket) => ticket.reporterName },
      { header: "Teléfono", value: (ticket) => ticket.reporterPhone },
      { header: "Departamento", value: (ticket) => ticket.department },
      { header: "Título", value: (ticket) => ticket.title },
      { header: "Categoría", value: (ticket) => ticketCategoryLabels[ticket.category] },
      { header: "Nivel de bloqueo", value: (ticket) => ticketBlockingLevelLabels[ticket.blockingLevel] },
      { header: "Prioridad", value: (ticket) => ticketPriorityLabels[ticket.priority] },
      { header: "Estado", value: (ticket) => ticketStatusLabels[ticket.status] },
      { header: "Tiempo empleado", value: (ticket) => ticket.resolutionTime ?? "" },
      { header: "Resuelto", value: (ticket) => ticket.resolvedAt ? formatDate(ticket.resolvedAt) : "" },
      { header: "Cerrado", value: (ticket) => ticket.closedAt ? formatDate(ticket.closedAt) : "" },
      { header: "Descripción", value: (ticket) => ticket.description },
    ]);
  }

  async function exportReportPdf() {
    setPdfBusy(true);
    try {
      await exportTicketReportPdf({ periodLabel, counts, tickets: exportTickets });
    } catch (cause) {
      setMessage(reportSafeError(cause, "No se pudo generar el PDF."));
    } finally {
      setPdfBusy(false);
    }
  }

  function handleSort(column: TicketSortColumn) {
    setSort((current) => current.column === column ? { column, direction: current.direction === "asc" ? "desc" : "asc" } : { column, direction: "desc" });
    setCompletedPage(1);
  }

  function handleFiltersChange(next: TicketFilterState) {
    setFilters(next);
    setCompletedPage(1);
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
        <div><p>Incidencias enviadas desde /soporte por cualquier trabajador de la empresa.</p></div>
        <div className="panel-heading-trailing">
          <QuickCreateTicketButton visible={canManage} onCreated={() => void loadTickets()} />
          <ReportExportButtons onExportCsv={exportReportCsv} onExportPdf={() => void exportReportPdf()} pdfBusy={pdfBusy} />
        </div>
      </section>

      <Toast message={message} onDismiss={() => setMessage(null)} />

      <section className="panel period-bar">
        <label><span>Periodo</span>
          <select value={chartMode} onChange={(event) => setChartMode(event.target.value as "month" | "year" | "total")}>
            <option value="month">Un mes</option>
            <option value="year">Por año</option>
            <option value="total">Todo el histórico</option>
          </select>
        </label>
        {chartMode === "month" ? (
          <label><span>Mes</span><input type="month" value={chartMonth} max={monthKey()} onChange={(event) => setChartMonth(event.target.value)} /></label>
        ) : null}
        {chartMode === "year" ? (
          <label><span>Año</span>
            <select value={chartYear} onChange={(event) => setChartYear(Number(event.target.value))}>
              {availableChartYears.map((year) => <option key={year} value={year}>{year}</option>)}
            </select>
          </label>
        ) : null}
        <p className="muted">Afecta a las tarjetas, los gráficos y a lo que se exporta en CSV y PDF.</p>
      </section>

      <TicketDashboardCards counts={counts} periodLabel={periodLabel} />

      <section className="dashboard-grid">
        <article className="panel chart-panel">
          <div className="panel-heading"><div><h2>Tickets creados</h2><p className="panel-subtitle">{chartMode === "month" ? `Por semana · ${periodLabel}` : chartMode === "year" ? `Por mes · ${periodLabel}` : "Por mes · todo el histórico"}</p></div></div>
          <TrendChart
            data={monthlyChartData}
            series={[{ key: "count", label: "Tickets", color: "#4f46e5" }]}
            ariaLabel="Tickets creados en el periodo"
          />
        </article>
        <TicketPriorityPanel counts={counts} periodLabel={periodLabel} />
      </section>

      <TicketFilters filters={filters} departments={departments} resultCount={visibleTickets.length} onChange={handleFiltersChange} />

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
              tickets={completedPageTickets}
              sort={sort}
              onSort={handleSort}
              onQuickStatusChange={(ticket, status) => void handleQuickStatusChange(ticket, status)}
              quickEditingId={quickEditingId}
              canManage={canManage}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelect}
              onToggleSelectAll={() => toggleSelectAll(completedPageTickets.map((t) => t.id))}
            />
            {completedTotalPages > 1 ? (
              <div className="table-panel-footer table-panel-pagination">
                <button type="button" className="button button-secondary button-compact" disabled={effectiveCompletedPage <= 1} onClick={() => setCompletedPage(effectiveCompletedPage - 1)}>← Anterior</button>
                <span className="muted">Página {effectiveCompletedPage} de {completedTotalPages}</span>
                <button type="button" className="button button-secondary button-compact" disabled={effectiveCompletedPage >= completedTotalPages} onClick={() => setCompletedPage(effectiveCompletedPage + 1)}>Siguiente →</button>
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
