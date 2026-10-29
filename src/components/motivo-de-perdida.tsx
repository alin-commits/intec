"use client";

import { useState } from "react";
import { inquiryLossReasonOrder, leadLossReasonOrder, lossReasonLabels } from "@/lib/constants";
import { DETALLE_MAXIMO, type MotivoEscrito } from "@/lib/por-cerrar";
import type { LossReason, LossReasonSource } from "@/lib/types";

/*
  Los campos del motivo de pérdida.

  Uno solo para los seis sitios desde los que algo se marca como perdido —el
  desplegable de la lista y la ficha, en leads y en consultas, y además la
  venta rápida y el alta de consultas—, cada uno con la lista de su tipo: un
  lead y una consulta se pierden por cosas distintas.

  Y con la IA a mano: el comercial cuenta con sus palabras qué ha pasado, y la
  IA propone qué motivo es y por qué. No decide ella: rellena el desplegable,
  y el comercial lo guarda o lo cambia. Si lo cambia, deja de constar como de
  la IA.
*/
export function MotivoDePerdidaCampos({ tipo, value, onChange, disabled = false, obligatorio = true, interes = null }: {
  tipo: "lead" | "consulta";
  value: MotivoEscrito;
  onChange: (motivo: MotivoEscrito) => void;
  disabled?: boolean;
  /**
   * Al pasar a perdido, sí. Al editar algo que ya estaba perdido de antes de
   * que existiera el motivo, no: corregir un teléfono no tiene que obligar a
   * inventarse por qué se perdió hace meses.
   */
  obligatorio?: boolean;
  /** Qué pedía, si se sabe: a la IA le ayuda a ver si «no era lo que necesitaba». */
  interes?: string | null;
}) {
  const opciones = tipo === "lead" ? leadLossReasonOrder : inquiryLossReasonOrder;
  const pideDetalle = value.reason === "otro";
  const [pensando, setPensando] = useState(false);
  const [aviso, setAviso] = useState<{ tono: "ok" | "duda" | "error"; texto: string } | null>(null);
  const textoParaIa = value.detail.trim();

  async function preguntarIa() {
    setPensando(true);
    setAviso(null);
    try {
      const respuesta = await fetch("/api/motivo-de-perdida", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo, texto: textoParaIa, interes }),
      });
      const datos = await respuesta.json().catch(() => ({})) as { motivo?: LossReason | null; porque?: string; error?: string };
      if (!respuesta.ok) {
        setAviso({ tono: "error", texto: datos.error ?? "No se pudo consultar a la IA. Elige el motivo a mano." });
        return;
      }
      if (!datos.motivo) {
        setAviso({ tono: "duda", texto: `No lo ve claro${datos.porque ? `: ${datos.porque}` : ""}. Elige tú el motivo.` });
        return;
      }
      onChange({ ...value, reason: datos.motivo, porIa: true });
      setAviso({ tono: "ok", texto: `Propone «${lossReasonLabels[datos.motivo]}»${datos.porque ? `: ${datos.porque}` : ""}. Si no es, cámbialo.` });
    } catch {
      setAviso({ tono: "error", texto: "No se pudo consultar a la IA. Elige el motivo a mano." });
    } finally {
      setPensando(false);
    }
  }

  return (
    <div className="confirmation-sale-form motivo-de-perdida">
      <label>
        <span>¿Qué ha pasado?{pideDetalle ? " *" : ""}</span>
        <input
          type="text"
          value={value.detail}
          maxLength={DETALLE_MAXIMO}
          disabled={disabled}
          required={pideDetalle}
          placeholder="Con tus palabras: «lo ha comprado más barato en otro sitio»"
          onChange={(event) => onChange({ ...value, detail: event.target.value })}
        />
      </label>
      <div className="motivo-ia">
        <button
          type="button"
          className="button button-compact button-secondary"
          disabled={disabled || pensando || textoParaIa.length < 8}
          title={textoParaIa.length < 8 ? "Escribe antes qué ha pasado" : undefined}
          onClick={() => void preguntarIa()}
        >
          {pensando ? "Pensando…" : "Que lo elija la IA"}
        </button>
        {aviso ? <small className={`motivo-ia-aviso is-${aviso.tono}`} role="status">{aviso.texto}</small> : null}
      </div>
      <label>
        <span>
          ¿Por qué se ha perdido?{obligatorio ? " *" : ""}
          {value.porIa && value.reason ? <em className="motivo-por-ia"> · elegido por la IA</em> : null}
        </span>
        <select
          value={value.reason}
          disabled={disabled}
          required={obligatorio}
          // Elegirlo a mano es decidirlo una persona, aunque coincida con lo que dijo la IA.
          onChange={(event) => onChange({ ...value, reason: event.target.value as LossReason | "", porIa: false })}
        >
          <option value="">{obligatorio ? "Elige un motivo…" : "Sin motivo apuntado"}</option>
          {opciones.map((motivo) => <option key={motivo} value={motivo}>{lossReasonLabels[motivo]}</option>)}
          {/* Un motivo guardado que ya no es de esta lista se enseña igual: no se pierde al abrir la ficha. */}
          {value.reason && !opciones.includes(value.reason) ? <option value={value.reason}>{lossReasonLabels[value.reason]}</option> : null}
        </select>
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

/** Lo que ya está guardado, tal como lo pide el formulario para editarlo. */
export function motivoDeLoGuardado(reason: LossReason | null | undefined, detail: string | null | undefined, source: LossReasonSource | null | undefined): MotivoEscrito {
  return { reason: reason ?? "", detail: detail ?? "", porIa: source === "ia" };
}
