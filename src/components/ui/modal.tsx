"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

/** Lo que se puede enfocar con el tabulador dentro del diálogo. */
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({ open, title, eyebrow, children, onClose, scrollInside = false }: {
  open: boolean;
  title: string;
  eyebrow?: string;
  children: ReactNode;
  onClose: () => void;
  /** For long content: the title stays fixed and only the body scrolls, inside the card's rounded edges. */
  scrollInside?: boolean;
}) {
  // Cada diálogo necesita su propio id: si hay dos abiertos a la vez y comparten
  // uno, el lector de pantalla no sabe cuál está leyendo.
  const titleId = useId();
  const cardRef = useRef<HTMLElement>(null);
  const returnFocusTo = useRef<Element | null>(null);
  // onClose llega casi siempre como función nueva en cada render. Guardarla aquí
  // permite que el efecto de abajo dependa solo de `open`: cuando dependía de
  // onClose, cada letra escrita en un campo lo volvía a ejecutar y el foco
  // saltaba del campo a la ✕ de cerrar, que es lo primero enfocable del diálogo.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    returnFocusTo.current = document.activeElement;
    // El foco entra en el diálogo; si no, con el teclado habría que recorrer
    // toda la página de detrás para llegar al formulario.
    const card = cardRef.current;
    const first = card?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? card)?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // Solo cierra el diálogo de más arriba: con dos abiertos, un Escape
        // cerraba los dos y se perdía el formulario a medio rellenar.
        const cards = document.querySelectorAll(".modal-card");
        if (cards.length > 0 && cards[cards.length - 1] !== cardRef.current) return;
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !cardRef.current) return;
      const items = [...cardRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((item) => item.offsetParent !== null);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      // El tabulador da la vuelta dentro del diálogo en vez de escaparse detrás.
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      // Al cerrar, el foco vuelve a donde estaba y no se pierde el sitio.
      if (returnFocusTo.current instanceof HTMLElement) returnFocusTo.current.focus();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" role="presentation">
      <section
        ref={cardRef}
        tabIndex={-1}
        className={scrollInside ? "modal-card modal-card-wide modal-card-scroll-inside" : "modal-card modal-card-wide"}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="modal-heading">
          <div>{eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}<h2 id={titleId}>{title}</h2></div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Cerrar">×</button>
        </div>
        {scrollInside ? <div className="modal-scroll-body">{children}</div> : children}
      </section>
    </div>
  );
}
