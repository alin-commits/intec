"use client";

import { useRef, useState, type MouseEvent } from "react";
import { numberFormatter } from "@/lib/format";

export type TrendSeries = { key: string; label: string; color: string };
type TrendChartProps = {
  data: Record<string, number | string>[];
  series: TrendSeries[];
  ariaLabel: string;
};

const width = 720;
const height = 250;
const padding = { top: 18, right: 22, bottom: 38, left: 36 };
const chartWidth = width - padding.left - padding.right;
const chartHeight = height - padding.top - padding.bottom;

function xForIndex(index: number, count: number): number {
  return padding.left + (index / Math.max(1, count - 1)) * chartWidth;
}

function yForValue(value: number, max: number): number {
  return padding.top + chartHeight - (value / Math.max(1, max)) * chartHeight;
}

function pointsFor(data: TrendChartProps["data"], key: string, max: number): string {
  return data.map((row, index) => `${xForIndex(index, data.length)},${yForValue(Number(row[key]) || 0, max)}`).join(" ");
}

export function TrendChart({ data, series, ariaLabel }: TrendChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const max = Math.max(...data.flatMap((row) => series.map((item) => Number(row[item.key]) || 0)), 1);
  const grid = [0, 0.25, 0.5, 0.75, 1];
  const labelStep = Math.max(1, Math.ceil(data.length / 8));

  function handleMove(event: MouseEvent<SVGRectElement>) {
    const svg = svgRef.current;
    if (!svg || data.length === 0) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0) return;
    const fraction = (event.clientX - rect.left) / rect.width;
    const dataX = fraction * width;
    const relative = (dataX - padding.left) / chartWidth;
    const index = Math.round(relative * (data.length - 1));
    setHoverIndex(Math.min(data.length - 1, Math.max(0, index)));
  }

  const hovered = hoverIndex !== null ? data[hoverIndex] : null;
  const tooltipX = hoverIndex !== null ? xForIndex(hoverIndex, data.length) : 0;
  const tooltipWidth = 172;
  const tooltipHeight = 40 + series.length * 24;
  const tooltipOnLeft = tooltipX > width - padding.right - tooltipWidth - 8;
  const tooltipLeft = tooltipOnLeft ? tooltipX - tooltipWidth - 10 : tooltipX + 10;

  if (data.length === 0) {
    return <p className="muted">Sin datos suficientes para mostrar la evolución.</p>;
  }

  return (
    <div className="chart-wrap" aria-label={ariaLabel}>
      <svg ref={svgRef} viewBox={`0 0 ${width} ${height}`} role="img" className="chart-svg">
        {grid.map((ratio) => {
          const y = padding.top + chartHeight * ratio;
          return <line key={ratio} x1={padding.left} y1={y} x2={width - padding.right} y2={y} className="chart-grid" />;
        })}
        {series.map((item) => (
          <polyline key={item.key} points={pointsFor(data, item.key, max)} className="chart-line" style={{ stroke: item.color, pointerEvents: "none" }} />
        ))}
        {series.map((item) => data.map((row, index) => (
          <circle
            key={`${item.key}-${index}`}
            cx={xForIndex(index, data.length)}
            cy={yForValue(Number(row[item.key]) || 0, max)}
            r={hoverIndex === index ? 5 : 4}
            fill={item.color}
            stroke="white"
            strokeWidth={2}
            style={{ pointerEvents: "none" }}
          />
        )))}
        {data.map((row, index) => {
          if (index % labelStep !== 0 && index !== data.length - 1) return null;
          return <text key={`label-${index}`} x={xForIndex(index, data.length)} y={height - 12} textAnchor="middle" className="chart-label" style={{ pointerEvents: "none" }}>{String(row.label)}</text>;
        })}
        {hoverIndex !== null ? (
          <line x1={tooltipX} y1={padding.top} x2={tooltipX} y2={height - padding.bottom} className="chart-crosshair" />
        ) : null}
        <rect
          x={padding.left}
          y={padding.top}
          width={chartWidth}
          height={chartHeight}
          fill="#000"
          fillOpacity={0}
          style={{ pointerEvents: "all" }}
          onMouseMove={handleMove}
          onMouseLeave={() => setHoverIndex(null)}
        />
        {hovered ? (
          <foreignObject x={tooltipLeft} y={padding.top} width={tooltipWidth} height={tooltipHeight} style={{ pointerEvents: "none", overflow: "visible" }}>
            <div className="chart-tooltip">
              <strong>{String(hovered.label)}</strong>
              {series.map((item) => (
                <div key={item.key} className="chart-tooltip-row">
                  <i style={{ background: item.color }} />
                  <span>{item.label}</span>
                  <strong>{numberFormatter.format(Number(hovered[item.key]) || 0)}</strong>
                </div>
              ))}
            </div>
          </foreignObject>
        ) : null}
      </svg>
      {series.length > 1 ? (
        <div className="chart-legend">
          {series.map((item) => (
            <span key={item.key}><i className="legend-dot" style={{ background: item.color }} />{item.label}</span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
