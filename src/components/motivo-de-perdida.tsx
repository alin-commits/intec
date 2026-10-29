"use client";

import { lossReasonLabels, lossReasonOrder } from "@/lib/constants";
import { DETALLE_MAXIMO, type MotivoEscrito } from "@/lib/por-cerrar";
import type { LossReason } from "@/lib/types";

/*
  Los campos del motivo de pérdida.

  Uno solo para los seis sitios desde los que algo se marca como perdido —el
  desplegable de la lista y la ficha, en leads y en consultas, y además la
  venta rápida y el alta de consultas—: si cada uno tuviera los suyos, la lista
  de motivos acabaría siendo distinta en cada pantalla.
*/
export function MotivoDePerdidaCampos({ value, onChange, disabled = false, obligatorio = true }: {
  value: MotivoEscrito;
  onChange: (motivo: MotivoEscrito) => void;
  disabled?: boolean;
  /**
   * Al pasar a perdido, sí. Al editar algo que ya estaba perdido de antes de
   * que existiera el motivo, no: corregir un teléfono no tiene que obligar a
   * inventarse por qué se perdió hace meses.
   */
  obligatorio?: boolean;
}) {
  const pideDetalle = value.reason === "otro";
  return (
    <div className="confirmation-sale-form motivo-de-perdida">
      <label>
        <span>¿Por qué se ha perdido?{obligatorio ? " *" : ""}</span>
        <select
          value={value.reason}
          disabled={disabled}
          required={obligatorio}
          onChange={(event) => onChange({ ...value, reason: event.target.value as LossReason | "" })}
        >
          <option value="">{obligatorio ? "Elige un motivo…" : "Sin motivo apuntado"}</option>
          {lossReasonOrder.map((motivo) => <option key={motivo} value={motivo}>{lossReasonLabels[motivo]}</option>)}
        </select>
      </label>
      <label>
        <span>{pideDetalle ? "¿Cuál? *" : "Detalle (si ayuda)"}</span>
        <input
          type="text"
          value={value.detail}
          maxLength={DETALLE_MAXIMO}
          disabled={disabled}
          required={pideDetalle}
          placeholder={pideDetalle ? "Cuéntalo en una frase" : "Por ejemplo: 12 % más caro que la competencia"}
          onChange={(event) => onChange({ ...value, detail: event.target.value })}
        />
      </label>
    </div>
  );
}

/** El motivo para enseñarlo junto al estado: «Precio» o «Otro: cerró la obra». */
export function motivoEnTexto(reason: LossReason | null | undefined, detail: string | null | undefined): string | null {
  if (!reason) return null;
  if (reason === "otro") return detail ? `Otro: ${detail}` : lossReasonLabels.otro;
  return lossReasonLabels[reason];
}
