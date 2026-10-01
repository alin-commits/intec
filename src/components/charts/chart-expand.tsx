"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Modal } from "@/components/ui/modal";

/*
  Cualquier gráfico se puede abrir en grande, con más detalle debajo. El
  diálogo va pegado al final de la página (portal): muchos gráficos ya están
  dentro de otro diálogo, como la ficha de un cliente, y así queda encima de
  él en vez de encerrado en su caja.
*/

function ExpandIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M12 3.5h4.5V8M8 16.5H3.5V12M16.5 3.5l-5 5M3.5 16.5l5-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ChartExpandButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" className="chart-expand-button" onClick={onClick} aria-label={`Ampliar: ${label}`} title="Ver en grande">
      <ExpandIcon />
      <span>Ampliar</span>
    </button>
  );
}

const subscribe = () => () => {};

export function ChartDialog({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  // En el servidor no hay document: el portal solo se monta en el navegador.
  const inBrowser = useSyncExternalStore(subscribe, () => true, () => false);
  if (!open || !inBrowser) return null;
  return createPortal(
    <Modal open large scrollInside title={title} eyebrow="Gráfico ampliado" onClose={onClose}>
      <div className="chart-dialog">{children}</div>
    </Modal>,
    document.body,
  );
}

const compactFormatter = new Intl.NumberFormat("es-ES", { notation: "compact", maximumFractionDigits: 1 });
const wholeFormatter = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0 });

/** Una cifra corta para los ejes y las etiquetas: 545 · 12,5 mil · 1,2 M. */
export const compactNumber = (value: number) => (Math.abs(value) >= 1000 ? compactFormatter.format(value) : wholeFormatter.format(value));
