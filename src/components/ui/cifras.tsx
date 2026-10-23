"use client";

import type { ReactNode } from "react";

/*
  Una tira de cifras: varias en fila, dentro de un solo panel.

  Nace de contar las tarjetas del Resumen: catorce, todas del mismo tamaño,
  antes de que apareciera un solo gráfico. Una tarjeta grande es una forma de
  decir "esto importa", y cuando todo lo es, no lo es nada: la vista no sabe
  dónde posarse y hay que leerlas una a una para encontrar lo que se buscaba.

  Así que las que acompañan —albaranes, descuento, cuántos clientes— pasan a
  esta tira: se leen igual de bien, ocupan un tercio y dejan el tamaño grande
  para las cuatro que de verdad mandan.

  Siguen pudiéndose pulsar donde antes se podía: lo que cambia es el tamaño, no
  lo que se puede hacer.
*/

export type Cifra = {
  key: string;
  etiqueta: string;
  valor: string;
  /** La línea pequeña de debajo: con qué se compara, de qué se compone. */
  nota?: ReactNode;
  /** Para pintar la cifra en verde o en rojo cuando dice algo por sí sola. */
  tono?: "bueno" | "malo";
  /** La que manda de la tira: va en el color de marca y un punto más grande. */
  fuerte?: boolean;
  onClick?: () => void;
  /** Lo que pasa al pulsar ("Ver lista"), para que se note que se puede. */
  accion?: string;
};

export function Cifras({ titulo, subtitulo, cifras, className = "panel panel-padded", children }: {
  titulo?: string;
  subtitulo?: string;
  cifras: Cifra[];
  className?: string;
  /** Lo que vaya debajo de la tira: una nota, una advertencia, un desplegable. */
  children?: ReactNode;
}) {
  if (cifras.length === 0) return null;
  return (
    <section className={className}>
      {titulo ? (
        <div className="panel-heading">
          <div>
            <h2>{titulo}</h2>
            {subtitulo ? <p className="panel-subtitle">{subtitulo}</p> : null}
          </div>
        </div>
      ) : null}
      <div className="cifras">
        {cifras.map((cifra) => {
          const dentro = (
            <>
              <span className="cifra-etiqueta">{cifra.etiqueta}</span>
              <span className={cifra.tono ? `cifra-valor es-${cifra.tono}` : "cifra-valor"}>{cifra.valor}</span>
              {cifra.nota ? <span className="cifra-nota">{cifra.nota}</span> : null}
              {cifra.onClick && cifra.accion ? <span className="cifra-accion" aria-hidden="true">{cifra.accion} →</span> : null}
            </>
          );
          const clase = cifra.fuerte ? "cifra es-fuerte" : "cifra";
          return cifra.onClick
            ? <button key={cifra.key} type="button" className={`${clase} es-pulsable`} onClick={cifra.onClick}>{dentro}</button>
            : <div key={cifra.key} className={clase}>{dentro}</div>;
        })}
      </div>
      {children}
    </section>
  );
}
