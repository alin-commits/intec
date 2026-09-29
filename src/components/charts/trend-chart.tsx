"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { numberFormatter } from "@/lib/format";

export type TrendSeries = { key: string; label: string; color: string };
type TrendChartProps = {
  data: Record<string, number | string>[];
  series: TrendSeries[];
  ariaLabel: string;
  /**
   * Para filtrar pulsando, como en Power BI: al pulsar un punto se llama con su
   * posición. Sin esto el gráfico solo enseña el detalle al pasar por encima.
   */
  onSelect?: (index: number) => void;
  /** El punto elegido, que se resalta. */
  selectedIndex?: number | null;
};

/**
 * El lienzo se dibuja en sus propias unidades y luego se estira al ancho que
 * haya. En un ordenador el de 720 se ve casi a tamaño real, pero en un móvil de
 * 390 px se encoge a la mitad y las etiquetas de los meses quedan en 6 px, que
 * no hay quien los lea. Por eso en pantallas estrechas se usa un lienzo casi
 * del tamaño del hueco: así el texto sale al tamaño que dice el CSS.
 */
const WIDE = { width: 720, height: 250, padding: { top: 18, right: 22, bottom: 38, left: 36 } };
const NARROW = { width: 380, height: 260, padding: { top: 16, right: 12, bottom: 34, left: 40 } };
/** Por debajo de esto el lienzo ancho ya se estaría encogiendo demasiado. */
const NARROW_UNDER = 520;

type Geometry = typeof WIDE & { chartWidth: number; chartHeight: number };
function geometryFor(narrow: boolean): Geometry {
  const base = narrow ? NARROW : WIDE;
  return {
    ...base,
    chartWidth: base.width - base.padding.left - base.padding.right,
    chartHeight: base.height - base.padding.top - base.padding.bottom,
  };
}

function xForIndex(geometry: Geometry, index: number, count: number): number {
  return geometry.padding.left + (index / Math.max(1, count - 1)) * geometry.chartWidth;
}

/**
 * El eje va de `min` a `max`. Cuando todo es positivo, `min` es cero y sale el
 * gráfico de siempre; cuando hay un mes en negativo —más abonos que venta, o un
 * margen en pérdidas— el cero deja de ser el suelo y la línea baja por debajo
 * en vez de dibujarse encima de las etiquetas de los meses.
 */
function yForValue(geometry: Geometry, value: number, min: number, max: number): number {
  const span = Math.max(1, max - min);
  return geometry.padding.top + geometry.chartHeight - ((value - min) / span) * geometry.chartHeight;
}

function pointsFor(geometry: Geometry, data: TrendChartProps["data"], key: string, min: number, max: number): string {
  return data
    .map((row, index) => `${xForIndex(geometry, index, data.length)},${yForValue(geometry, Number(row[key]) || 0, min, max)}`)
    .join(" ");
}

export function TrendChart({ data, series, ariaLabel, onSelect, selectedIndex = null }: TrendChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [narrow, setNarrow] = useState(false);

  // El gráfico se mide a sí mismo en vez de preguntar por el ancho de la
  // ventana: así también acierta cuando está dentro de una columna estrecha de
  // un escritorio, no solo en un móvil.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width ?? 0;
      if (measured > 0) setNarrow(measured < NARROW_UNDER);
    });
    observer.observe(wrap);
    return () => observer.disconnect();
  }, []);

  const geometry = geometryFor(narrow);
  const { width, height, padding, chartWidth } = geometry;
  const values = data.flatMap((row) => series.map((item) => Number(row[item.key]) || 0));
  const max = Math.max(...values, 1);
  // El suelo es el cero salvo que haya negativos, que entonces baja hasta ellos.
  const min = Math.min(...values, 0);
  const grid = [0, 0.25, 0.5, 0.75, 1];
  // En estrecho caben menos fechas sin que se solapen unas con otras.
  const labelStep = Math.max(1, Math.ceil(data.length / (narrow ? 4 : 8)));

  function indexAt(event: MouseEvent<SVGRectElement>): number | null {
    const svg = svgRef.current;
    if (!svg || data.length === 0) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0) return null;
    const fraction = (event.clientX - rect.left) / rect.width;
    const dataX = fraction * width;
    const relative = (dataX - padding.left) / chartWidth;
    const index = Math.round(relative * (data.length - 1));
    return Math.min(data.length - 1, Math.max(0, index));
  }

  function handleMove(event: MouseEvent<SVGRectElement>) {
    const index = indexAt(event);
    if (index !== null) setHoverIndex(index);
  }

  // En un móvil no hay "pasar por encima": el toque es a la vez el clic.
  function handleClick(event: MouseEvent<SVGRectElement>) {
    const index = indexAt(event);
    if (index !== null && onSelect) onSelect(index);
  }

  const hovered = hoverIndex !== null ? data[hoverIndex] : null;
  const tooltipX = hoverIndex !== null ? xForIndex(geometry, hoverIndex, data.length) : 0;
  const tooltipWidth = narrow ? 150 : 172;
  const tooltipHeight = 40 + series.length * 24 + (onSelect ? 20 : 0);
  // La franja del punto elegido: medio paso a cada lado.
  const step = data.length > 1 ? chartWidth / (data.length - 1) : chartWidth;
  const selectedX = selectedIndex !== null && selectedIndex < data.length ? xForIndex(geometry, selectedIndex, data.length) : null;
  const tooltipOnLeft = tooltipX > width - padding.right - tooltipWidth - 8;
  const tooltipLeft = tooltipOnLeft ? tooltipX - tooltipWidth - 10 : tooltipX + 10;

  if (data.length === 0) {
    return <p className="muted">Sin datos suficientes para mostrar la evolución.</p>;
  }

  return (
    <div className="chart-wrap" ref={wrapRef} aria-label={ariaLabel}>
      <svg ref={svgRef} viewBox={`0 0 ${width} ${height}`} role="img" className="chart-svg">
        {grid.map((ratio) => {
          const y = padding.top + geometry.chartHeight * ratio;
          return <line key={ratio} x1={padding.left} y1={y} x2={width - padding.right} y2={y} className="chart-grid" />;
        })}
        {selectedX !== null ? (
          <rect
            x={Math.max(padding.left, selectedX - step / 2)}
            y={padding.top}
            width={Math.min(step, width - padding.right - Math.max(padding.left, selectedX - step / 2))}
            height={geometry.chartHeight}
            className="chart-selected-band"
          />
        ) : null}
        {min < 0 ? (
          <line
            x1={padding.left}
            y1={yForValue(geometry, 0, min, max)}
            x2={width - padding.right}
            y2={yForValue(geometry, 0, min, max)}
            className="chart-zero"
          />
        ) : null}
        {series.map((item) => (
          <polyline key={item.key} points={pointsFor(geometry, data, item.key, min, max)} className="chart-line" style={{ stroke: item.color, pointerEvents: "none" }} />
        ))}
        {series.map((item) => data.map((row, index) => (
          <circle
            key={`${item.key}-${index}`}
            cx={xForIndex(geometry, index, data.length)}
            cy={yForValue(geometry, Number(row[item.key]) || 0, min, max)}
            r={hoverIndex === index || selectedIndex === index ? (narrow ? 4 : 5) : (narrow ? 3 : 4)}
            fill={item.color}
            stroke="white"
            strokeWidth={2}
            style={{ pointerEvents: "none" }}
          />
        )))}
        {data.map((row, index) => {
          if (index % labelStep !== 0 && index !== data.length - 1) return null;
          const isFirst = index === 0;
          const isLast = index === data.length - 1;
          const anchor = isLast && !isFirst ? "end" : isFirst && !isLast ? "start" : "middle";
          return <text key={`label-${index}`} x={xForIndex(geometry, index, data.length)} y={height - 12} textAnchor={anchor} className={selectedIndex === index ? "chart-label is-selected" : "chart-label"} style={{ pointerEvents: "none" }}>{String(row.label)}</text>;
        })}
        {hoverIndex !== null ? (
          <line x1={tooltipX} y1={padding.top} x2={tooltipX} y2={height - padding.bottom} className="chart-crosshair" />
        ) : null}
        <rect
          x={padding.left}
          y={padding.top}
          width={chartWidth}
          height={geometry.chartHeight}
          fill="#000"
          fillOpacity={0}
          style={{ pointerEvents: "all", cursor: onSelect ? "pointer" : undefined }}
          onMouseMove={handleMove}
          onMouseLeave={() => setHoverIndex(null)}
          onClick={onSelect ? handleClick : undefined}
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
              {onSelect ? <em className="chart-tooltip-hint">{selectedIndex === hoverIndex ? "Pulsa para quitar el filtro" : "Pulsa para filtrar"}</em> : null}
            </div>
          </foreignObject>
        ) : null}
      </svg>
      {onSelect ? (
        // Para teclado y lectores de pantalla: el mismo filtro con botones.
        <div className="sr-only">
          {data.map((row, index) => (
            <button key={`select-${index}`} type="button" aria-pressed={selectedIndex === index} onClick={() => onSelect(index)}>
              {`Filtrar por ${String(row.label)}`}
            </button>
          ))}
        </div>
      ) : null}
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
