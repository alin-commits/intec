"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { numberFormatter } from "@/lib/format";
import { ChartDialog, ChartExpandButton, compactNumber } from "./chart-expand";

export type TrendSeries = { key: string; label: string; color: string };
type TrendChartProps = {
  /** Un valor null es un hueco: la línea se corta ahí en vez de caer a cero. */
  data: Record<string, number | string | null>[];
  series: TrendSeries[];
  ariaLabel: string;
  /**
   * Para filtrar pulsando, como en Power BI: al pulsar un punto se llama con su
   * posición. Sin esto el gráfico solo enseña el detalle al pasar por encima.
   */
  onSelect?: (index: number) => void;
  /** El punto elegido, que se resalta. */
  selectedIndex?: number | null;
  /** El título del gráfico ampliado; si no, el de accesibilidad. */
  title?: string;
  /** Cómo se escribe una cifra en el detalle y al pasar por encima (por defecto, 1.234). */
  valueFormatter?: (value: number) => string;
  /**
   * Si tiene sentido sumar los puntos (ventas, consultas…). Un saldo, un
   * acumulado o un recuento de clientes no se suman: ahí va `false` y el
   * detalle ampliado no enseña el total. Con una lista, solo esas líneas.
   */
  total?: boolean | string[];
  /** `false` para no ofrecer la vista en grande. */
  expandable?: boolean;
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
/** En grande: más alto y con sitio a la izquierda para las cifras del eje. */
const BIG_WIDE = { width: 1060, height: 430, padding: { top: 26, right: 28, bottom: 44, left: 66 } };
const BIG_NARROW = { width: 380, height: 340, padding: { top: 18, right: 14, bottom: 36, left: 48 } };
/** Por debajo de esto el lienzo ancho ya se estaría encogiendo demasiado. */
const NARROW_UNDER = 520;

type Geometry = typeof WIDE & { chartWidth: number; chartHeight: number };
function geometryFor(narrow: boolean, big: boolean): Geometry {
  const base = big ? (narrow ? BIG_NARROW : BIG_WIDE) : narrow ? NARROW : WIDE;
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

/** El valor de un punto, o null si es un hueco. */
const valueAt = (row: TrendChartProps["data"][number], key: string): number | null => (row[key] === null ? null : Number(row[key]) || 0);

/** Los tramos de línea de una serie: uno por cada racha de puntos sin huecos. */
function segmentsFor(geometry: Geometry, data: TrendChartProps["data"], key: string, min: number, max: number): string[] {
  const segments: string[] = [];
  let current: string[] = [];
  data.forEach((row, index) => {
    const value = valueAt(row, key);
    if (value === null) {
      if (current.length > 0) segments.push(current.join(" "));
      current = [];
      return;
    }
    current.push(`${xForIndex(geometry, index, data.length)},${yForValue(geometry, value, min, max)}`);
  });
  if (current.length > 0) segments.push(current.join(" "));
  return segments;
}

export function TrendChart(props: TrendChartProps) {
  const { data, series, ariaLabel, title, valueFormatter, total = true, expandable = true } = props;
  const [expanded, setExpanded] = useState(false);
  const canvas = <TrendCanvas {...props} big={false} />;
  if (!expandable || data.length === 0) return canvas;
  const name = title ?? ariaLabel;
  return (
    <div className="chart-expandable">
      <ChartExpandButton label={name} onClick={() => setExpanded(true)} />
      {canvas}
      <ChartDialog open={expanded} title={name} onClose={() => setExpanded(false)}>
        {/* En grande no filtra: pulsar ahí cambiaría la página de detrás sin verlo. */}
        <TrendCanvas {...props} onSelect={undefined} big />
        <TrendDetails data={data} series={series} format={valueFormatter ?? ((value) => numberFormatter.format(value))} total={total} />
      </ChartDialog>
    </div>
  );
}

function TrendCanvas({ data, series, ariaLabel, onSelect, selectedIndex = null, valueFormatter, big }: TrendChartProps & { big: boolean }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [narrow, setNarrow] = useState(false);
  const format = valueFormatter ?? ((value: number) => numberFormatter.format(value));

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

  const geometry = geometryFor(narrow, big);
  const { width, height, padding, chartWidth } = geometry;
  const values = data.flatMap((row) => series.flatMap((item) => {
    const value = valueAt(row, item.key);
    return value === null ? [] : [value];
  }));
  const max = Math.max(...values, 1);
  // El suelo es el cero salvo que haya negativos, que entonces baja hasta ellos.
  const min = Math.min(...values, 0);
  const grid = [0, 0.25, 0.5, 0.75, 1];
  // En estrecho caben menos fechas sin que se solapen unas con otras; en grande, más.
  const labelStep = Math.max(1, Math.ceil(data.length / (big ? (narrow ? 5 : 14) : narrow ? 4 : 8)));
  // En grande, con una sola línea y pocos puntos, cada punto lleva su cifra.
  const pointLabels = big && !narrow && series.length === 1 && data.length <= 24;

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
    <div className={big ? "chart-wrap is-big" : "chart-wrap"} ref={wrapRef} aria-label={ariaLabel}>
      <svg ref={svgRef} viewBox={`0 0 ${width} ${height}`} role="img" className="chart-svg">
        {grid.map((ratio) => {
          const y = padding.top + geometry.chartHeight * ratio;
          return <line key={ratio} x1={padding.left} y1={y} x2={width - padding.right} y2={y} className="chart-grid" />;
        })}
        {big ? grid.map((ratio) => (
          <text key={`axis-${ratio}`} x={padding.left - 8} y={padding.top + geometry.chartHeight * ratio + 4} textAnchor="end" className="chart-axis-label">
            {compactNumber(max - ratio * (max - min))}
          </text>
        )) : null}
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
        {series.map((item) => segmentsFor(geometry, data, item.key, min, max).map((points, segment) => (
          <polyline key={`${item.key}-${segment}`} points={points} className="chart-line" style={{ stroke: item.color, pointerEvents: "none" }} />
        )))}
        {series.map((item) => data.map((row, index) => {
          const value = valueAt(row, item.key);
          if (value === null) return null;
          return (
            <circle
              key={`${item.key}-${index}`}
              cx={xForIndex(geometry, index, data.length)}
              cy={yForValue(geometry, value, min, max)}
              r={hoverIndex === index || selectedIndex === index ? (narrow ? 4 : 5) : (narrow ? 3 : 4)}
              fill={item.color}
              stroke="white"
              strokeWidth={2}
              style={{ pointerEvents: "none" }}
            />
          );
        }))}
        {pointLabels ? data.map((row, index) => {
          const value = valueAt(row, series[0].key);
          if (value === null) return null;
          return (
            <text key={`value-${index}`} x={xForIndex(geometry, index, data.length)} y={yForValue(geometry, value, min, max) - 11} textAnchor="middle" className="chart-point-label" style={{ pointerEvents: "none" }}>
              {compactNumber(value)}
            </text>
          );
        }) : null}
        {data.map((row, index) => {
          if (index % labelStep !== 0 && index !== data.length - 1) return null;
          // La última siempre sale; la de antes, si le queda pegada, se pisarían.
          if (index !== data.length - 1 && data.length - 1 - index < labelStep / 2) return null;
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
                  <strong>{hovered[item.key] === null ? "—" : format(Number(hovered[item.key]) || 0)}</strong>
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

/** Debajo del gráfico ampliado: total, media, máximo y mínimo de cada línea, y todas las cifras. */
function TrendDetails({ data, series, format, total }: { data: TrendChartProps["data"]; series: TrendSeries[]; format: (value: number) => string; total: boolean | string[] }) {
  const summable = (key: string) => total === true || (Array.isArray(total) && total.includes(key));
  const anySummable = series.some((item) => summable(item.key));
  const stats = series.flatMap((item) => {
    const points = data.flatMap((row) => {
      const value = valueAt(row, item.key);
      return value === null ? [] : [{ label: String(row.label), value }];
    });
    if (points.length === 0) return [];
    const sum = points.reduce((acc, point) => acc + point.value, 0);
    const highest = points.reduce((best, point) => (point.value > best.value ? point : best));
    const lowest = points.reduce((best, point) => (point.value < best.value ? point : best));
    return [{ item, sum, average: sum / points.length, highest, lowest }];
  });

  return (
    <>
      <div className="chart-details-stats">
        {stats.map(({ item, sum, average, highest, lowest }) => (
          <div key={item.key} className="chart-details-card">
            <strong><i style={{ background: item.color }} />{item.label}</strong>
            <dl>
              {summable(item.key) ? <><dt>Total</dt><dd>{format(sum)}</dd></> : null}
              <dt>Media</dt><dd>{format(average)}</dd>
              <dt>Máximo</dt><dd>{format(highest.value)} <small>{highest.label}</small></dd>
              <dt>Mínimo</dt><dd>{format(lowest.value)} <small>{lowest.label}</small></dd>
            </dl>
          </div>
        ))}
      </div>
      <div className="table-scroll chart-details-table">
        <table>
          <thead>
            <tr><th>Periodo</th>{series.map((item) => <th key={item.key}>{item.label}</th>)}</tr>
          </thead>
          <tbody>
            {data.map((row, index) => (
              <tr key={index}>
                <td>{String(row.label)}</td>
                {series.map((item) => {
                  const value = valueAt(row, item.key);
                  return <td key={item.key}>{value === null ? "—" : format(value)}</td>;
                })}
              </tr>
            ))}
          </tbody>
          {anySummable ? (
            <tfoot>
              <tr>
                <th>Total</th>
                {series.map((item) => <th key={item.key}>{summable(item.key) ? format(stats.find((stat) => stat.item.key === item.key)?.sum ?? 0) : "—"}</th>)}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </>
  );
}
