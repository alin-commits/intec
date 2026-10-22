"use client";

import { useId, useMemo, useRef, useState } from "react";
import { useClickOutside } from "@/components/ui/use-click-outside";

/*
  Un filtro de varias opciones con casillas.

  Nace para los meses y los comerciales del panel de Ventas, donde marcar dos
  trimestres o tres comerciales a la vez es lo normal y con un desplegable de
  uno en uno no se puede.

  Decisiones de uso, que son las que lo hacen cómodo:

   · El botón dice lo que hay marcado, no "3 seleccionados": con pocos los
     enumera y con muchos dice cuántos. Hay que poder leer el filtro sin abrirlo.
   · Nada marcado significa "todo", no "nada". Es lo que espera cualquiera de
     un filtro, y evita la pantalla en blanco al desmarcar lo último.
   · El buscador solo aparece cuando hay bastantes opciones. Con doce meses
     estorba; con treinta comerciales hace falta.
   · Se cierra al pulsar fuera y con Escape, y lo marcado se aplica al momento:
     no hay botón de aceptar que se quede sin pulsar.
*/

export type OpcionMulti = { value: string; label: string; grupo?: string };

/** A partir de cuántas opciones aparece el buscador. */
const DESDE_CUANTAS_BUSCADOR = 14;

export function MultiSelect({ label, opciones, seleccionadas, onChange, textoVacio = "Todas", nombrarHasta = 2 }: {
  label: string;
  opciones: OpcionMulti[];
  seleccionadas: string[];
  onChange: (valores: string[]) => void;
  /** Qué dice el botón cuando no hay nada marcado. */
  textoVacio?: string;
  /** Hasta cuántas se enumeran antes de decir solo cuántas son. */
  nombrarHasta?: number;
}) {
  const [abierto, setAbierto] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const caja = useRef<HTMLDivElement>(null);
  const id = useId();
  useClickOutside(caja, () => setAbierto(false));

  const marcadas = useMemo(() => new Set(seleccionadas), [seleccionadas]);
  const visibles = useMemo(() => {
    const texto = busqueda.trim().toLowerCase();
    if (!texto) return opciones;
    return opciones.filter((opcion) => opcion.label.toLowerCase().includes(texto));
  }, [opciones, busqueda]);

  // Agrupadas si alguna lo pide (los meses, por año).
  const grupos = useMemo(() => {
    const mapa = new Map<string, OpcionMulti[]>();
    for (const opcion of visibles) {
      const clave = opcion.grupo ?? "";
      mapa.set(clave, [...(mapa.get(clave) ?? []), opcion]);
    }
    return [...mapa.entries()];
  }, [visibles]);

  const resumen = (() => {
    if (seleccionadas.length === 0) return textoVacio;
    const nombres = seleccionadas
      .map((valor) => opciones.find((opcion) => opcion.value === valor)?.label)
      .filter(Boolean) as string[];
    if (nombres.length === 0) return textoVacio;
    if (nombres.length <= nombrarHasta) return nombres.join(", ");
    return `${nombres.length} seleccionados`;
  })();

  function alternar(valor: string) {
    onChange(marcadas.has(valor) ? seleccionadas.filter((item) => item !== valor) : [...seleccionadas, valor]);
  }

  return (
    <div className="multi-select" ref={caja}>
      <span className="multi-select-label" id={`${id}-label`}>{label}</span>
      <button type="button" className={abierto ? "multi-select-boton abierto" : "multi-select-boton"}
        aria-expanded={abierto} aria-haspopup="listbox" aria-labelledby={`${id}-label`}
        onClick={() => setAbierto((actual) => !actual)}>
        <span className={seleccionadas.length === 0 ? "multi-select-resumen vacio" : "multi-select-resumen"}>{resumen}</span>
        <span className="multi-select-flecha" aria-hidden="true" />
      </button>

      {abierto ? (
        <div className="multi-select-panel" role="listbox" aria-multiselectable="true"
          onKeyDown={(evento) => { if (evento.key === "Escape") setAbierto(false); }}>
          {opciones.length >= DESDE_CUANTAS_BUSCADOR ? (
            <input type="search" className="multi-select-buscador" placeholder="Buscar…" autoFocus
              value={busqueda} onChange={(evento) => setBusqueda(evento.target.value)} />
          ) : null}

          <div className="multi-select-acciones">
            <button type="button" className="text-link" onClick={() => onChange(visibles.map((opcion) => opcion.value))}>
              {busqueda ? "Marcar los que salen" : "Marcar todos"}
            </button>
            {seleccionadas.length > 0 ? (
              <button type="button" className="text-link" onClick={() => onChange([])}>Ninguno</button>
            ) : null}
          </div>

          <div className="multi-select-lista">
            {grupos.map(([grupo, suyas]) => (
              <div key={grupo || "sin-grupo"}>
                {grupo ? <p className="multi-select-grupo">{grupo}</p> : null}
                {suyas.map((opcion) => (
                  <label key={opcion.value} className="multi-select-opcion">
                    <input type="checkbox" checked={marcadas.has(opcion.value)} onChange={() => alternar(opcion.value)} />
                    <span>{opcion.label}</span>
                  </label>
                ))}
              </div>
            ))}
            {visibles.length === 0 ? <p className="multi-select-vacio">Nada que encaje con «{busqueda}».</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
