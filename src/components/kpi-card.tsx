import type { ReactNode } from "react";
import { Sparkline } from "@/components/charts/sparkline";

export type KpiTone = "indigo" | "emerald" | "amber" | "sky" | "rose";

type KpiCardProps = {
  label: string;
  value: string;
  delta: string;
  positive?: boolean;
  helper?: string;
  icon?: ReactNode;
  tone?: KpiTone;
  sparkline?: number[];
};

const NO_COMPARISON = "Sin comparación";

function valueSizeClass(value: string): string {
  if (value.length > 13) return "kpi-value kpi-value-xlong";
  if (value.length > 9) return "kpi-value kpi-value-long";
  return "kpi-value";
}

export function KpiCard({ label, value, delta, positive = true, helper, icon, tone = "indigo", sparkline }: KpiCardProps) {
  const neutral = delta === NO_COMPARISON;
  const context = helper ?? "frente al mes anterior";
  const footer = neutral ? (
    context ? <div className="kpi-footer"><span>{context}</span></div> : null
  ) : (
    <div className="kpi-footer">
      <span className={positive ? "trend trend-positive" : "trend trend-negative"}>{positive ? "↑" : "↓"} {delta}</span>
      <span>{context}</span>
    </div>
  );

  if (!icon) {
    return (
      <article className="panel kpi-card">
        <div className="kpi-label">{label}</div>
        <div className={valueSizeClass(value)}>{value}</div>
        {footer}
      </article>
    );
  }

  return (
    <article className={`panel kpi-card kpi-card-rich kpi-tone-${tone}`}>
      <div className="kpi-card-top">
        <span className="kpi-icon">{icon}</span>
        <div className="kpi-label">{label}</div>
      </div>
      <div className="kpi-card-body">
        <div className={valueSizeClass(value)}>{value}</div>
        {sparkline ? <Sparkline values={sparkline} /> : null}
      </div>
      {footer}
    </article>
  );
}
