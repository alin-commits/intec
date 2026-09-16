import type { TicketDashboardCounts } from "@/lib/tickets/map";

function DashboardCard({ label, value }: { label: string; value: number }) {
  return (
    <article className="panel kpi-card">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
    </article>
  );
}

export function TicketDashboardCards({ counts, periodLabel }: { counts: TicketDashboardCounts; periodLabel: string }) {
  return (
    <section className="kpi-grid ticket-kpi-grid">
      <DashboardCard label={`Tickets nuevos (${periodLabel})`} value={counts.newCount} />
      <DashboardCard label={`Tickets abiertos (${periodLabel})`} value={counts.openCount} />
      <DashboardCard label={`En curso (${periodLabel})`} value={counts.inProgressCount} />
      <DashboardCard label={`Pendientes (${periodLabel})`} value={counts.pendingCount} />
      <DashboardCard label={`Resueltos (${periodLabel})`} value={counts.resolvedPeriodCount} />
      <DashboardCard label="Resueltos en total" value={counts.resolvedTotalCount} />
      <DashboardCard label={`Tardaron +3 días (${periodLabel})`} value={counts.staleCount} />
      <DashboardCard label={`Prioridad alta (${periodLabel})`} value={counts.highPriorityCount} />
      <DashboardCard label={`Prioridad media (${periodLabel})`} value={counts.mediumPriorityCount} />
      <DashboardCard label={`Prioridad baja (${periodLabel})`} value={counts.lowPriorityCount} />
    </section>
  );
}
