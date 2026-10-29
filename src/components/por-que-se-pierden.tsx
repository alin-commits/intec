"use client";

import { lossReasonLabels } from "@/lib/constants";
import { currencyFormatter, formatPercent, numberFormatter } from "@/lib/format";
import { repartoDePerdidas, type Perdido } from "@/lib/por-cerrar";
import type { LossReason } from "@/lib/types";

/*
  Por qué se pierden: el reparto de los motivos de lo perdido.

  Uno en Leads y otro en Consultas, nunca juntos: se pierden por cosas
  distintas, y sumados darían un reparto que no describe a ninguno. Cada uno
  obedece a los filtros de su página, así que con una marca o unas fechas
  elegidas dice por qué se pierde en esa marca y esas fechas.

  No sale mientras no haya nada perdido en lo que se mira: un bloque vacío
  ocupa sitio y no dice nada.
*/
export function PorQueSePierden({ titulo, nota, perdidos, orden }: {
  titulo: string;
  nota: string;
  perdidos: Perdido[];
  orden: LossReason[];
}) {
  if (perdidos.length === 0) return null;
  const { filas, conMotivo, sinMotivo, porIa } = repartoDePerdidas(perdidos, orden);
  const hayValor = filas.some((fila) => fila.valor > 0);
  const pie = [
    `${numberFormatter.format(conMotivo)} con motivo`,
    sinMotivo > 0 ? `${numberFormatter.format(sinMotivo)} sin motivo apuntado, de antes de que se pidiera` : null,
    porIa > 0 ? `${numberFormatter.format(porIa)} elegidos por la IA` : null,
  ].filter(Boolean).join(" · ");

  return (
    <section className="panel panel-padded por-que-se-pierden">
      <div className="panel-heading">
        <div><span className="eyebrow">Análisis</span><h2>{titulo}</h2><p className="panel-subtitle">{nota}</p></div>
      </div>
      {conMotivo === 0 ? (
        <p className="muted">Ninguno de los perdidos tiene todavía motivo apuntado: saldrán aquí en cuanto se marque el primero.</p>
      ) : (
        <ul className="motivos-reparto">
          {filas.map((fila) => (
            <li key={fila.motivo}>
              <span className="motivo-nombre">
                {lossReasonLabels[fila.motivo]}
                {fila.porIa > 0 ? <small className="muted"> · {fila.porIa} por IA</small> : null}
              </span>
              {/* La barra es el peso del motivo: a simple vista se ve cuál manda. */}
              <span className="motivo-barra" aria-hidden="true"><span style={{ width: `${Math.max(fila.porcentaje, 2)}%` }} /></span>
              <span className="motivo-cifra"><strong>{numberFormatter.format(fila.cuantos)}</strong> · {formatPercent(fila.porcentaje)}</span>
              {/* El porcentaje solo no dice cuánto se pierde: al lado, lo que valía. */}
              {hayValor ? <span className="motivo-valor">{fila.valor > 0 ? currencyFormatter.format(fila.valor) : "—"}</span> : null}
            </li>
          ))}
        </ul>
      )}
      <p className="muted motivos-pie">{pie}</p>
    </section>
  );
}
