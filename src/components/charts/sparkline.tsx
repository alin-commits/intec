type SparklineProps = {
  values: number[];
  ariaLabel?: string;
};

const WIDTH = 96;
const HEIGHT = 34;
const PAD = 2;

export function Sparkline({ values, ariaLabel }: SparklineProps) {
  if (values.length < 2 || values.every((value) => value === 0)) return null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const step = (WIDTH - PAD * 2) / (values.length - 1);
  const points = values.map((value, index) => [PAD + index * step, HEIGHT - PAD - ((value - min) / range) * (HEIGHT - PAD * 2)] as const);
  const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `M${points[0][0]},${HEIGHT} L${line.replace(/ /g, " L")} L${points[points.length - 1][0]},${HEIGHT} Z`;

  return (
    <svg className="sparkline" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role={ariaLabel ? "img" : undefined} aria-label={ariaLabel} aria-hidden={ariaLabel ? undefined : true}>
      <path d={area} fill="currentColor" opacity="0.12" />
      <polyline points={line} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
