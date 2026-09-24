"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

export type ConfirmationDialogProps = {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  /** Para cuando "Cancelar" y "Guardando…" no son lo que está pasando. */
  cancelLabel?: string;
  busyLabel?: string;
  busy?: boolean;
  destructive?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ConfirmationDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = "Cancelar",
  busyLabel = "Guardando…",
  busy = false,
  destructive = false,
  onCancel,
  onConfirm,
}: ConfirmationDialogProps) {
  const titleId = useId();
  const cardRef = useRef<HTMLElement>(null);
  const returnFocusTo = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    returnFocusTo.current = document.activeElement;
    cardRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (busy) return;
      // Solo si el foco está dentro: con el Enter global, pulsarlo en un campo
      // del formulario de detrás lo enviaba y además confirmaba el diálogo.
      if (!cardRef.current?.contains(document.activeElement)) return;
      if (event.key === "Escape") {
        event.stopPropagation();
        onCancel();
      }
      if (event.key === "Enter" && !(document.activeElement instanceof HTMLTextAreaElement)) {
        event.preventDefault();
        onConfirm();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      if (returnFocusTo.current instanceof HTMLElement) returnFocusTo.current.focus();
    };
  }, [busy, onCancel, onConfirm, open]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation">
      <section ref={cardRef} tabIndex={-1} className="modal-card confirmation-card" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="modal-heading">
          <div>
            <span className="eyebrow">Confirmación</span>
            <h2 id={titleId}>{title}</h2>
          </div>
        </div>
        <div className="confirmation-content">{children}</div>
        <div className="modal-actions">
          <button type="button" className="button button-secondary" onClick={onCancel} disabled={busy}>{cancelLabel}</button>
          <button type="button" className={destructive ? "button button-danger" : "button button-primary"} onClick={onConfirm} disabled={busy}>
            {busy ? busyLabel : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
