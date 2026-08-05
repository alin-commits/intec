"use client";

import { useEffect, type ReactNode } from "react";

export type ConfirmationDialogProps = {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
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
  busy = false,
  destructive = false,
  onCancel,
  onConfirm,
}: ConfirmationDialogProps) {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
      if (event.key === "Enter" && !busy) onConfirm();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [busy, onCancel, onConfirm, open]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-card confirmation-card" role="dialog" aria-modal="true" aria-labelledby="confirmation-title">
        <div className="modal-heading">
          <div>
            <span className="eyebrow">Confirmación</span>
            <h2 id="confirmation-title">{title}</h2>
          </div>
        </div>
        <div className="confirmation-content">{children}</div>
        <div className="modal-actions">
          <button type="button" className="button button-secondary" onClick={onCancel} disabled={busy}>Cancelar</button>
          <button type="button" className={destructive ? "button button-danger" : "button button-primary"} onClick={onConfirm} disabled={busy}>
            {busy ? "Guardando…" : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
