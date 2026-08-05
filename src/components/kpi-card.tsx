type KpiCardProps = {
  label: string;
  value: string;
  delta: string;
  positive?: boolean;
  helper?: string;
};

export function KpiCard({ label, value, delta, positive = true, helper }: KpiCardProps) {
  return (
    <article className="panel kpi-card">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-footer">
        <span className={positive ? "trend trend-positive" : "trend trend-negative"}>
          {positive ? "↑" : "↓"} {delta}
        </span>
        <span>{helper ?? "frente al mes anterior"}</span>
      </div>
    </article>
  );
}
