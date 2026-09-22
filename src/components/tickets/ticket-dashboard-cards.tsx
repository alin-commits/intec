import { DonutChart } from "@/components/charts/donut-chart";
import { CheckCircleIcon, ClockIcon, PlusCircleIcon, TicketsIcon } from "@/components/icons";
import { KpiCard } from "@/components/kpi-card";
import type { TicketDashboardCounts } from "@/lib/tickets/map";

const NO_COMPARISON = "Sin comparación";

export function TicketDashboardCards({ counts, periodLabel }: { counts: TicketDashboardCounts; periodLabel: string }) {
  return (
    <section className="kpi-grid">
      <KpiCard label="Nuevos" value={String(counts.newCount)} delta={NO_COMPARISON} helper={`sin empezar · ${periodLabel}`} icon={<PlusCircleIcon />} tone="indigo" />
      <KpiCard
        label="Abiertos"
        value={String(counts.openCount)}
        delta={NO_COMPARISON}
        helper={`${counts.inProgressCount} en curso · ${counts.pendingCount} pendientes`}
        icon={<TicketsIcon />}
        tone="sky"
      />
      <KpiCard
        label="Resueltos"
        value={String(counts.resolvedPeriodCount)}
        delta={NO_COMPARISON}
        helper={`${periodLabel} · ${counts.resolvedTotalCount} en total`}
        icon={<CheckCircleIcon />}
        tone="emerald"
      />
      <KpiCard
        label="Tardaron más de 3 días"
        value={String(counts.staleCount)}
        delta={NO_COMPARISON}
        helper={periodLabel}
        icon={<ClockIcon />}
        tone={counts.staleCount > 0 ? "rose" : "amber"}
      />
    </section>
  );
}

export function TicketPriorityPanel({ counts, periodLabel }: { counts: TicketDashboardCounts; periodLabel: string }) {
  return (
    <section className="panel chart-panel">
      <div className="panel-heading"><div><h2>Por prioridad</h2><p className="panel-subtitle">{periodLabel}</p></div></div>
      <DonutChart
        items={[
          { label: "Alta", value: counts.highPriorityCount, color: "#dc2626" },
          { label: "Media", value: counts.mediumPriorityCount, color: "#f59e0b" },
          { label: "Baja", value: counts.lowPriorityCount, color: "#94a3b8" },
        ]}
        centerLabel="tickets"
        ariaLabel="Tickets por prioridad"
        emptyMessage="Sin tickets en este periodo."
      />
    </section>
  );
}
