"use client";

import { useState } from "react";

/*
  El aviso flotante que lleva al comparador.

  Marcar varias cosas en los filtros no se nota: el panel sigue enseñando un
  total, solo que más pequeño. Quien marca tres meses casi siempre quiere
  verlos uno al lado del otro, y el comparador es la pestaña que hace eso, pero
  no hay forma de adivinarlo si nadie lo dice.

  Decisiones para que ayude y no estorbe:

   · Sale a partir de dos cosas marcadas. Con una no hay nada que comparar.
   · No sale estando ya en el comparador: ahí ya estás.
   · Se cierra y no vuelve en lo que queda de sesión. Un aviso que reaparece
     cada vez que tocas un filtro deja de leerse en dos minutos.
*/

/** A partir de cuántas marcas tiene sentido comparar. */
const DESDE_CUANTAS = 2;
const CLAVE = "intec.ventas.aviso-comparador";

function yaCerrado(): boolean {
  try {
    return window.sessionStorage.getItem(CLAVE) === "1";
  } catch {
    // Sin almacén se enseña: molesta menos que callarse.
    return false;
  }
}

export function AvisoComparador({ marcados, onIr }: { marcados: number; onIr: () => void }) {
  const [cerrado, setCerrado] = useState(() => (typeof window === "undefined" ? false : yaCerrado()));
  if (cerrado || marcados < DESDE_CUANTAS) return null;

  function cerrar() {
    setCerrado(true);
    try {
      window.sessionStorage.setItem(CLAVE, "1");
    } catch {
      // Que no se pueda recordar no es motivo para no cerrarlo ahora.
    }
  }

  return (
    <div className="aviso-comparador" role="status">
      <span>
        Tienes <strong>{marcados}</strong> cosas marcadas. En el comparador salen una contra otra, con sus
        gráficos y su evolución.
      </span>
      <button type="button" className="button button-compact button-primary" onClick={() => { cerrar(); onIr(); }}>
        Ver el comparador
      </button>
      <button type="button" className="aviso-comparador-cerrar" onClick={cerrar} aria-label="Cerrar el aviso">×</button>
    </div>
  );
}
