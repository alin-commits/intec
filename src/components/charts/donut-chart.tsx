export type DonutItem = { label: string; value: number; color: string };

type DonutChartProps = {
  items: DonutItem[];
  centerLabel: string;
  ariaLabel: string;
  emptyMessage?: string;
  valueFormatter?: (value: number) => string;
  /**
   * Con `false` la rosquilla se dibuja sin su lista. Sirve para cuando quien la
   * usa ya enseña esos mismos nombres al lado con algo más —un margen, un botón
   * para filtrar—, y repetirlos sería la misma lista dos veces.
   */
  showLegend?: boolean;
  /** Para filtrar pulsando una porción, como en Power BI. */
  onSelect?: (label: string) => void;
  /** La porción elegida: las demás se apagan un poco. */
  selectedLabel?: string | null;
};

const SIZE = 160;
const STROKE = 26;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function DonutChart({ items, centerLabel, ariaLabel, emptyMessage = "Sin datos en este periodo.", valueFormatter, showLegend = true, onSelect, selectedLabel = null }: DonutChartProps) {
  const visible = items.filter((item) => item.value > 0);
  const total = visible.reduce((sum, item) => sum + item.value, 0);
  const format = valueFormatter ?? ((value: number) => value.toLocaleString("es-ES"));

  const lengths = visible.map((item) => (item.value / (total || 1)) * CIRCUMFERENCE);
  const segments = visible.map((item, index) => {
    const start = lengths.slice(0, index).reduce((sum, length) => sum + length, 0);
    return { ...item, dash: `${lengths[index]} ${CIRCUMFERENCE - lengths[index]}`, offset: -start };
  });
  const dimmed = (label: string) => selectedLabel !== null && selectedLabel !== label;

  return (
    <div className="donut-chart">
      <div className="donut-figure">
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={ariaLabel}>
          <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" stroke="#eef0f6" strokeWidth={STROKE} />
          {segments.map((segment) => (
            <circle
              key={segment.label}
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              stroke={segment.color}
              strokeWidth={STROKE}
              strokeDasharray={segment.dash}
              strokeDashoffset={segment.offset}
              transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
              className={onSelect ? "donut-segment is-clickable" : "donut-segment"}
              opacity={dimmed(segment.label) ? 0.3 : 1}
              onClick={onSelect ? () => onSelect(segment.label) : undefined}
            >
              <title>{`${segment.label}: ${format(segment.value)}${onSelect ? " · pulsa para filtrar" : ""}`}</title>
            </circle>
          ))}
        </svg>
        <div className="donut-center">
          <strong className={format(total).length > 10 ? "donut-center-xlong" : format(total).length > 7 ? "donut-center-long" : undefined}>{format(total)}</strong>
          <span>{centerLabel}</span>
        </div>
      </div>
      {total === 0 ? (
        <p className="muted donut-empty">{emptyMessage}</p>
      ) : !showLegend ? null : (
        <ul className="donut-legend">
          {visible.map((item) => {
            const content = (
              <>
                <i style={{ background: item.color }} />
                <span>{item.label}</span>
                <strong>{format(item.value)}</strong>
                <small>{Math.round((item.value / total) * 100)}%</small>
              </>
            );
            return (
              <li key={item.label} className={dimmed(item.label) ? "is-dimmed" : undefined}>
                {onSelect ? (
                  <button type="button" className="donut-legend-button" aria-pressed={selectedLabel === item.label} onClick={() => onSelect(item.label)}>
                    {content}
                  </button>
                ) : content}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
