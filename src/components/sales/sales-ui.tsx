"use client";

import { useEffect, useState, type ReactNode } from "react";

/*
  Piezas que comparten las páginas de Ventas.
*/

/**
 * Carga algo de la base de datos cuando cambia `key` (una cadena que resume
 * todo lo que cambia la consulta). Mientras llega lo nuevo se sigue enseñando
 * lo anterior, para que el panel no parpadee a cero en cada clic. Con `key`
 * nulo no se pregunta nada.
 */
export function useSageQuery<T>(key: string | null, load: () => PromiseLike<{ data: T | null; error: unknown }>) {
  const [state, setState] = useState<{ key: string | null; data: T | null; failed: boolean }>({ key: null, data: null, failed: false });
  useEffect(() => {
    if (key === null) return;
    let active = true;
    Promise.resolve(load()).then(
      ({ data, error }) => {
        if (!active) return;
        if (error) console.error("No se pudo cargar del panel de ventas:", error);
        setState({ key, data: error ? null : data, failed: Boolean(error) });
      },
      (cause: unknown) => {
        if (!active) return;
        console.error("No se pudo cargar del panel de ventas:", cause);
        setState({ key, data: null, failed: true });
      },
    );
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- la clave resume todo lo que cambia la consulta
  }, [key]);
  return {
    data: state.data,
    loading: key !== null && state.key !== key,
    failed: state.key === key && state.failed,
  };
}

export type RankItem = {
  key: string;
  label: string;
  /** Lo que mide la barra. */
  value: number;
  valueLabel: string;
  /** La columna pequeña de la derecha (un margen, un porcentaje...). */
  extra?: string;
  muted?: boolean;
  title?: string;
};

/** Un ranking con barra que filtra al pulsar, como el de comerciales. */
export function RankList({ items, activeKey = null, onSelect, empty = "Sin datos en este periodo.", limit }: {
  items: RankItem[];
  activeKey?: string | null;
  onSelect?: (key: string) => void;
  empty?: string;
  limit?: number;
}) {
  if (items.length === 0) return <p className="muted">{empty}</p>;
  const shown = limit ? items.slice(0, limit) : items;
  const max = Math.max(...shown.map((item) => item.value), 1);
  return (
    <ol className="sales-rank">
      {shown.map((item) => {
        const content = (
          <>
            <span className="sales-rank-name" title={item.title ?? item.label}>{item.label}</span>
            <span className="sales-rank-track">
              <span className="sales-rank-fill" style={{ width: `${Math.max(1.5, (Math.max(item.value, 0) / max) * 100)}%` }} />
            </span>
            <strong className="sales-rank-value">{item.valueLabel}</strong>
            <span className="sales-rank-margin">{item.extra ?? ""}</span>
          </>
        );
        const className = `sales-rank-row${activeKey === item.key ? " is-active" : ""}${item.muted ? " is-muted" : ""}`;
        return (
          <li key={item.key}>
            {onSelect ? (
              <button type="button" className={className} onClick={() => onSelect(item.key)} aria-pressed={activeKey === item.key}>
                {content}
              </button>
            ) : (
              <div className={`${className} is-static`}>{content}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export type Column<T> = {
  key: string;
  header: string;
  /** Lo que se pinta en la celda. */
  render: (row: T) => ReactNode;
  /** Por lo que se ordena al pulsar la cabecera; sin esto la columna no ordena. */
  sort?: (row: T) => number | string;
  /** Las columnas de texto van a la izquierda; las de números, a la derecha. */
  text?: boolean;
  /** Se esconde en el móvil, donde no caben todas. */
  optional?: boolean;
};

/**
 * Una tabla que se ordena pulsando la cabecera y que filtra pulsando la fila,
 * como las de Power BI. `rowKey` identifica la fila y `activeKey` la resalta.
 */
export function DataTable<T>({ rows, columns, rowKey, activeKey = null, onRowClick, initialSort, footer, empty = "Sin datos en este periodo.", limit }: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  activeKey?: string | null;
  onRowClick?: (row: T) => void;
  initialSort?: { key: string; desc: boolean };
  footer?: ReactNode;
  empty?: string;
  limit?: number;
}) {
  const [sort, setSort] = useState<{ key: string; desc: boolean } | null>(initialSort ?? null);
  const [showAll, setShowAll] = useState(false);
  const column = sort ? columns.find((item) => item.key === sort.key) : undefined;
  const sorted = column?.sort
    ? [...rows].sort((a, b) => {
        const left = column.sort?.(a) ?? 0;
        const right = column.sort?.(b) ?? 0;
        const order = typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right), "es");
        return sort?.desc ? -order : order;
      })
    : rows;
  const visible = limit && !showAll ? sorted.slice(0, limit) : sorted;

  return (
    <>
      <div className="table-scroll">
        <table className="sales-data-table">
          <thead>
            <tr>
              {columns.map((item) => (
                <th key={item.key} className={`${item.text ? "is-text" : ""}${item.optional ? " is-optional" : ""}`} aria-sort={sort?.key === item.key ? (sort.desc ? "descending" : "ascending") : undefined}>
                  {item.sort ? (
                    <button
                      type="button"
                      className="sales-sort-button"
                      onClick={() => setSort((current) => ({ key: item.key, desc: current?.key === item.key ? !current.desc : !item.text }))}
                    >
                      {item.header}
                      <span aria-hidden="true">{sort?.key === item.key ? (sort.desc ? "↓" : "↑") : "↕"}</span>
                    </button>
                  ) : item.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => {
              const key = rowKey(row);
              const active = activeKey === key;
              return (
                <tr key={key} className={`${onRowClick ? "is-clickable" : ""}${active ? " is-active" : ""}`} onClick={onRowClick ? () => onRowClick(row) : undefined}>
                  {columns.map((item, index) => (
                    <td key={item.key} className={`${item.text ? "is-text" : ""}${item.optional ? " is-optional" : ""}`}>
                      {index === 0 && onRowClick ? (
                        <button type="button" className="sales-row-button" aria-pressed={active} onClick={(event) => { event.stopPropagation(); onRowClick(row); }}>
                          {item.render(row)}
                        </button>
                      ) : item.render(row)}
                    </td>
                  ))}
                </tr>
              );
            })}
            {rows.length === 0 ? <tr><td colSpan={columns.length} className="muted is-text">{empty}</td></tr> : null}
          </tbody>
          {footer ? <tfoot>{footer}</tfoot> : null}
        </table>
      </div>
      {limit && rows.length > limit ? (
        <button type="button" className="sales-more-button" onClick={() => setShowAll((value) => !value)}>
          {showAll ? "Ver menos" : `Ver los ${rows.length}`}
        </button>
      ) : null}
    </>
  );
}

/** Un bloque de panel con título, subtítulo y, a la derecha, lo que haga falta. */
export function Panel({ title, subtitle, trailing, className = "panel panel-padded", children }: {
  title: string;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <article className={className}>
      <div className="panel-heading">
        <div>
          <h2>{title}</h2>
          {subtitle ? <p className="panel-subtitle">{subtitle}</p> : null}
        </div>
        {trailing ? <div className="panel-heading-trailing">{trailing}</div> : null}
      </div>
      {children}
    </article>
  );
}

/** Lo que dice un cuadro cuyo detalle todavía no ha mandado Sage. */
export function PendingDetail({ what }: { what: string }) {
  return (
    <div className="sales-pending">
      <strong>Pendiente de la próxima lectura completa de Sage</strong>
      <span>
        {what} llegará en cuanto el programa del servidor de Sage mande el detalle nuevo (clientes, artículos,
        ofertas y pedidos uno a uno). No hace falta hacer nada aquí: se rellena solo.
      </span>
    </div>
  );
}

/** Aviso de que no se pudo cargar un cuadro, sin tumbar el resto de la página. */
export function LoadFailed({ what }: { what: string }) {
  return <p className="sales-load-failed">No se pudo cargar {what}. Recarga la página para intentarlo otra vez.</p>;
}

/** Días con decimal, para plazos medios. */
export const days = (value: number) => `${value.toFixed(1).replace(".", ",").replace(",0", "")} días`;

/** "12,5 %" o "—" si no hay base. */
export const share = (part: number, total: number) => (total > 0 ? `${((part / total) * 100).toFixed(1).replace(".", ",")} %` : "—");

/** Una fecha corta, "5 sept". */
export const shortDate = (day: string | null) =>
  day ? new Date(`${day}T12:00:00`).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "2-digit" }) : "—";
