"use client";

import { useEffect, useRef, type RefObject } from "react";

/** Cierra un desplegable al pulsar fuera de él. Lo usan la campana, el buscador y el cambiador de cuenta. */
export function useClickOutside(ref: RefObject<HTMLElement | null>, onOutside: () => void) {
  const callback = useRef(onOutside);
  // En un efecto, no en el render: React 19 no deja tocar refs mientras pinta.
  useEffect(() => { callback.current = onOutside; });
  useEffect(() => {
    function handle(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) callback.current();
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [ref]);
}
