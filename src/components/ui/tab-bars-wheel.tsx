"use client";

import { useEffect } from "react";

/**
 * Las barras de pestañas que no caben (Marketing, Ventas, Administración…) se
 * desplazan en horizontal. Con el ratón, la rueda solo mueve la página hacia
 * abajo, así que las pestañas del final no se podían alcanzar. Con esto, la
 * rueda encima de una barra así la mueve de lado; al llegar al final, vuelve
 * a mover la página como siempre.
 */
export function TabBarsWheel() {
  useEffect(() => {
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      const target = event.target instanceof Element ? event.target : null;
      const bar = target?.closest(".view-tabs");
      if (!(bar instanceof HTMLElement) || bar.scrollWidth <= bar.clientWidth + 1) return;
      const max = bar.scrollWidth - bar.clientWidth;
      const next = Math.max(0, Math.min(max, bar.scrollLeft + event.deltaY));
      if (next === bar.scrollLeft) return;
      event.preventDefault();
      bar.scrollLeft = next;
    };
    document.addEventListener("wheel", onWheel, { passive: false });
    return () => document.removeEventListener("wheel", onWheel);
  }, []);
  return null;
}
