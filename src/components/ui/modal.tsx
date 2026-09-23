"use client";

import { useEffect, type ReactNode } from "react";

export function Modal({ open, title, eyebrow, children, onClose, scrollInside = false }: {
  open: boolean;
  title: string;
  eyebrow?: string;
  children: ReactNode;
  onClose: () => void;
  /** For long content: the title stays fixed and only the body scrolls, inside the card's rounded edges. */
  scrollInside?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" role="presentation">
      <section className={scrollInside ? "modal-card modal-card-wide modal-card-scroll-inside" : "modal-card modal-card-wide"} role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div className="modal-heading">
          <div>{eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}<h2 id="modal-title">{title}</h2></div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Cerrar">×</button>
        </div>
        {scrollInside ? <div className="modal-scroll-body">{children}</div> : children}
      </section>
    </div>
  );
}
