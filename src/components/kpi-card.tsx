import type { KeyboardEvent, ReactNode } from "react";
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
  /** Para abrir el detalle o filtrar pulsando la tarjeta, como en Power BI. */
  onClick?: () => void;
  /** Lo que pasa al pulsar ("Ver lista", "Ver ofertas"...), para que se note que se puede. */
  actionLabel?: string;
  /** La tarjeta del filtro o la lista que está abierta. */
  active?: boolean;
};

const NO_COMPARISON = "Sin comparación";

function valueSizeClass(value: string): string {
  if (value.length > 13) return "kpi-value kpi-value-xlong";
  if (value.length > 9) return "kpi-value kpi-value-long";
  return "kpi-value";
}

export function KpiCard({ label, value, delta, positive = true, helper, icon, tone = "indigo", sparkline, onClick, actionLabel, active = false }: KpiCardProps) {
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
  const action = onClick && actionLabel ? <span className="kpi-action" aria-hidden="true">{actionLabel} →</span> : null;

  // Una tarjeta que se puede pulsar se porta como un botón también con el teclado.
  const clickable = onClick
    ? {
        role: "button",
        tabIndex: 0,
        "aria-pressed": active,
        onClick,
        onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onClick();
          }
        },
      }
    : {};
  const stateClass = `${onClick ? " kpi-card-clickable" : ""}${active ? " is-active" : ""}`;

  if (!icon) {
    return (
      <article className={`panel kpi-card${stateClass}`} {...clickable}>
        <div className="kpi-label">{label}</div>
        <div className={valueSizeClass(value)}>{value}</div>
        {footer}
        {action}
      </article>
    );
  }

  return (
    <article className={`panel kpi-card kpi-card-rich kpi-tone-${tone}${stateClass}`} {...clickable}>
      <div className="kpi-card-top">
        <span className="kpi-icon">{icon}</span>
        <div className="kpi-label">{label}</div>
      </div>
      <div className="kpi-card-body">
        <div className={valueSizeClass(value)}>{value}</div>
        {sparkline ? <Sparkline values={sparkline} /> : null}
      </div>
      {footer}
      {action}
    </article>
  );
}
