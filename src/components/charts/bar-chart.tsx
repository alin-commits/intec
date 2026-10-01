"use client";

import { useState } from "react";
import { formatPercent } from "@/lib/format";
import { ChartDialog, ChartExpandButton } from "./chart-expand";

export type BarChartItem = { label: string; value: number; color: string };

type BarChartProps = {
  items: BarChartItem[];
  ariaLabel: string;
  valueFormatter?: (value: number) => string;
  /** El título del gráfico ampliado; si no, el de accesibilidad. */
  title?: string;
  /** `false` si las cifras no se suman (un porcentaje): el detalle no enseña total ni peso. */
  total?: boolean;
  /** `false` para no ofrecer la vista en grande. */
  expandable?: boolean;
};

export function BarChart({ items, ariaLabel, valueFormatter, title, total = true, expandable = true }: BarChartProps) {
  const [expanded, setExpanded] = useState(false);
  const sorted = [...items].sort((a, b) => b.value - a.value);
  const format = valueFormatter ?? ((value: number) => String(value));

  if (sorted.length === 0) {
    return <p className="muted">Sin datos suficientes para mostrar la comparativa.</p>;
  }

  const bars = (big: boolean) => {
    const max = Math.max(...sorted.map((item) => item.value), 1);
    return (
      <div className={big ? "bar-chart is-big" : "bar-chart"} role="img" aria-label={ariaLabel}>
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
  };
  if (!expandable) return bars(false);

  const sum = sorted.reduce((acc, item) => acc + item.value, 0);
  const name = title ?? ariaLabel;
  return (
    <div className="chart-expandable">
      <ChartExpandButton label={name} onClick={() => setExpanded(true)} />
      {bars(false)}
      <ChartDialog open={expanded} title={name} onClose={() => setExpanded(false)}>
        {bars(true)}
        <div className="table-scroll chart-details-table">
          <table>
            <thead><tr><th>Nombre</th><th>Cifra</th>{total ? <th>Peso</th> : null}</tr></thead>
            <tbody>
              {sorted.map((item) => (
                <tr key={item.label}>
                  <td><span className="chart-details-name"><i style={{ background: item.color }} />{item.label}</span></td>
                  <td>{format(item.value)}</td>
                  {total ? <td>{sum > 0 ? formatPercent((item.value / sum) * 100) : "—"}</td> : null}
                </tr>
              ))}
            </tbody>
            {total ? <tfoot><tr><th>Total</th><th>{format(sum)}</th><th>100,0 %</th></tr></tfoot> : null}
          </table>
        </div>
      </ChartDialog>
    </div>
  );
}
