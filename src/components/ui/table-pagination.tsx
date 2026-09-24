"use client";

type TablePaginationProps = {
  page: number;
  pageCount: number;
  total: number;
  /** Cómo se llama lo que se está listando: "facturas", "suscripciones"… */
  label: string;
  onChange: (page: number) => void;
};

/** Anterior / Siguiente para las tablas que enseñan unas pocas filas por página. */
export function TablePagination({ page, pageCount, total, label, onChange }: TablePaginationProps) {
  if (pageCount <= 1) return null;
  return (
    <div className="table-panel-footer table-panel-pagination">
      <button type="button" className="button button-compact button-secondary" disabled={page === 0} onClick={() => onChange(Math.max(0, page - 1))}>
        Anterior
      </button>
      <span className="muted">Página {page + 1} de {pageCount} · {total} {label}</span>
      <button type="button" className="button button-compact button-secondary" disabled={page + 1 >= pageCount} onClick={() => onChange(page + 1)}>
        Siguiente
      </button>
    </div>
  );
}
