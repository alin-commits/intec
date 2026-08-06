function DashboardCard({ label, value }: { label: string; value: number }) {
  return (
    <article className="panel kpi-card">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
    </article>
  );
}

export type TicketDashboardCounts = {
  newCount: number;
  openCount: number;
  inProgressCount: number;
  pendingCount: number;
  resolvedThisMonthCount: number;
  staleOpenCount: number;
};

export function TicketDashboardCards({ counts }: { counts: TicketDashboardCounts }) {
  return (
    <section className="kpi-grid ticket-kpi-grid">
      <DashboardCard label="Tickets nuevos" value={counts.newCount} />
      <DashboardCard label="Tickets abiertos" value={counts.openCount} />
      <DashboardCard label="En curso" value={counts.inProgressCount} />
      <DashboardCard label="Pendientes" value={counts.pendingCount} />
      <DashboardCard label="Resueltos este mes" value={counts.resolvedThisMonthCount} />
      <DashboardCard label="Abiertos +3 días" value={counts.staleOpenCount} />
    </section>
  );
}
