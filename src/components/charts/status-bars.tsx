"use client";

import { leadStatusLabels } from "@/lib/constants";
import type { LeadStatus } from "@/lib/types";

const statusOrder: LeadStatus[] = ["new", "contact_attempt", "contacted", "offer_sent", "interested", "won", "lost", "invalid"];

type StatusBarsProps = {
  counts: Partial<Record<LeadStatus, number>>;
};

export function StatusBars({ counts }: StatusBarsProps) {
  const rows = statusOrder.map((status) => ({ label: leadStatusLabels[status], value: counts[status] ?? 0 }));
  const max = Math.max(1, ...rows.map((row) => row.value));
  return (
    <div className="status-bars">
      {rows.map((row) => (
        <div className="status-row" key={row.label}>
          <span>{row.label}</span>
          <div className="status-track">
            <div className="status-fill" style={{ width: `${(row.value / max) * 100}%` }} />
          </div>
          <strong>{row.value}</strong>
        </div>
      ))}
    </div>
  );
}
