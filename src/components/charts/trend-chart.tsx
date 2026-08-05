"use client";

type TrendPoint = { label: string; web: number; phone: number };
type TrendChartProps = { data: TrendPoint[] };

const width = 720;
const height = 250;
const padding = { top: 18, right: 22, bottom: 38, left: 36 };

function pointsFor(data: TrendPoint[], key: "web" | "phone", max: number): string {
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  return data.map((item, index) => {
    const x = padding.left + (index / Math.max(1, data.length - 1)) * chartWidth;
    const y = padding.top + chartHeight - (item[key] / Math.max(1, max)) * chartHeight;
    return `${x},${y}`;
  }).join(" ");
}

export function TrendChart({ data }: TrendChartProps) {
  const max = Math.max(...data.flatMap((item) => [item.web, item.phone]), 1);
  const grid = [0, 0.25, 0.5, 0.75, 1];
  const labelStep = Math.max(1, Math.ceil(data.length / 8));

  return (
    <div className="chart-wrap" aria-label="Evolución de consultas web y telefónicas">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" className="chart-svg">
        {grid.map((ratio) => {
          const y = padding.top + (height - padding.top - padding.bottom) * ratio;
          return <line key={ratio} x1={padding.left} y1={y} x2={width - padding.right} y2={y} className="chart-grid" />;
        })}
        <polyline points={pointsFor(data, "web", max)} className="chart-line chart-line-web" />
        <polyline points={pointsFor(data, "phone", max)} className="chart-line chart-line-phone" />
        {data.map((item, index) => {
          if (index % labelStep !== 0 && index !== data.length - 1) return null;
          const chartWidth = width - padding.left - padding.right;
          const x = padding.left + (index / Math.max(1, data.length - 1)) * chartWidth;
          return <text key={`${item.label}-${index}`} x={x} y={height - 12} textAnchor="middle" className="chart-label">{item.label}</text>;
        })}
      </svg>
      <div className="chart-legend"><span><i className="legend-dot legend-web" /> Web</span><span><i className="legend-dot legend-phone" /> Telefónicas</span></div>
    </div>
  );
}
