export type BarChartItem = { label: string; value: number; color: string };

type BarChartProps = {
  items: BarChartItem[];
  ariaLabel: string;
  valueFormatter?: (value: number) => string;
};

export function BarChart({ items, ariaLabel, valueFormatter }: BarChartProps) {
  const sorted = [...items].sort((a, b) => b.value - a.value);
  const max = Math.max(...sorted.map((item) => item.value), 1);
  const format = valueFormatter ?? ((value: number) => String(value));

  if (sorted.length === 0) {
    return <p className="muted">Sin datos suficientes para mostrar la comparativa.</p>;
  }

  return (
    <div className="bar-chart" role="img" aria-label={ariaLabel}>
      {sorted.map((item) => (
        <div className="bar-chart-row" key={item.label} title={`${item.label}: ${format(item.value)}`}>
          <span>{item.label}</span>
          <div className="bar-chart-track">
            <div className="bar-chart-fill" style={{ width: `${Math.max(2, (item.value / max) * 100)}%`, background: item.color }} />
          </div>
          <strong>{format(item.value)}</strong>
        </div>
      ))}
    </div>
  );
}
