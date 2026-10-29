import type { LeadStatus, LossReason, LossReasonSource } from "@/lib/types";

/*
  Lo que hay que cerrar: leads y consultas que se quedaron a medio camino.

  Un lead contactado o una consulta interesada que lleva una semana sin
  moverse casi nunca sigue viva: o se ganó y nadie lo apuntó, o se perdió y
  nadie lo dijo. Las dos cosas estropean las cifras —la conversión sale peor de
  lo que es y el embudo parece lleno de oportunidades que no existen—, así que
  al comercial se le recuerda que las cierre.
*/

/** Días sin cambiar de estado a partir de los cuales algo se da por parado. */
export const DIAS_PARA_CERRAR = 7;

/** Los estados que se quedan a medias: ni ganado ni perdido, pero ya atendido. */
export const LEADS_POR_CERRAR: LeadStatus[] = ["contacted", "interested"];
export const CONSULTAS_POR_CERRAR = ["contactado", "interesado"] as const;

const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * Desde cuándo está en su estado actual: el último cambio de estado, o la
 * fecha de alta si nunca cambió. Con las fechas en ISO, la mayor es la última.
 */
export function ultimoCambio(creadoEl: string, cambios: (string | null | undefined)[]): string {
  return cambios.reduce<string>((ultimo, fecha) => (fecha && fecha > ultimo ? fecha : ultimo), creadoEl);
}

/** Días enteros desde una fecha hasta ahora. Nunca negativos. */
export function diasDesde(fecha: string, ahora: Date): number {
  const desde = new Date(fecha).getTime();
  if (!Number.isFinite(desde)) return 0;
  return Math.max(0, Math.floor((ahora.getTime() - desde) / DIA_MS));
}

/** Si algo que lleva `dias` en un estado a medias pide ya que se cierre. */
export function pideCerrarse(dias: number): boolean {
  return dias >= DIAS_PARA_CERRAR;
}

/**
 * El motivo tal como se escribe en un formulario, antes de guardarse.
 * porIa dice si el motivo elegido es el que propuso la IA y nadie lo tocó.
 */
export type MotivoEscrito = { reason: LossReason | ""; detail: string; porIa?: boolean };

export const MOTIVO_VACIO: MotivoEscrito = { reason: "", detail: "", porIa: false };

/** El largo que admite la base para el detalle. */
export const DETALLE_MAXIMO = 300;

/**
 * Qué falta para poder guardar algo como perdido, o null si está completo.
 *
 * Son las mismas reglas que comprueba la base —un motivo de la lista, y con
 * «otro», su explicación—: aquí se dicen antes de mandar nada, en vez de que
 * llegue un error de la base que nadie entiende.
 */
export function faltaEnElMotivo(motivo: MotivoEscrito): string | null {
  if (!motivo.reason) return "Elige por qué se ha perdido.";
  const detalle = motivo.detail.trim();
  if (motivo.reason === "otro" && !detalle) return "Con «Otro motivo», escribe cuál.";
  if (detalle.length > DETALLE_MAXIMO) return `El detalle no puede pasar de ${DETALLE_MAXIMO} caracteres.`;
  return null;
}

export type MotivoGuardado = { lost_reason: LossReason | null; lost_detail: string | null; lost_reason_source: LossReasonSource | null };

/**
 * Lo que se manda a la base: el motivo, su detalle y quién lo eligió, o nulos
 * fuera de «perdido».
 *
 * El autor va siempre que va el motivo. Si no, un motivo que propuso la IA y
 * luego alguien cambió a mano seguiría constando en la base como de la IA:
 * la base conserva lo que no se le manda.
 */
export function motivoParaGuardar(perdido: boolean, motivo: MotivoEscrito): MotivoGuardado {
  if (!perdido || !motivo.reason) return { lost_reason: null, lost_detail: null, lost_reason_source: null };
  return { lost_reason: motivo.reason, lost_detail: motivo.detail.trim() || null, lost_reason_source: motivo.porIa ? "ia" : "persona" };
}

/* -------------------------------------------------------------------------
   Por qué se pierden: el reparto de los motivos
   ------------------------------------------------------------------------- */

export type Perdido = { reason: LossReason | null | undefined; source?: LossReasonSource | null; value?: number | null };

export type FilaDeReparto = {
  motivo: LossReason;
  cuantos: number;
  /** Sobre los que tienen motivo: los de antes, sin él, no cuentan para el reparto. */
  porcentaje: number;
  /** Lo que valía lo perdido por ese motivo, cuando se sabe. */
  valor: number;
  porIa: number;
};

/**
 * El reparto de lo perdido por motivo, en el orden de su lista.
 *
 * El porcentaje es sobre los que tienen motivo, no sobre todos: los que se
 * perdieron antes de que existiera el motivo no dicen nada de por qué, y
 * meterlos en la cuenta haría parecer que cada motivo pesa menos de lo que
 * pesa. Se cuentan aparte, para que se vea cuántos son.
 */
export function repartoDePerdidas(perdidos: Perdido[], orden: LossReason[]): { filas: FilaDeReparto[]; conMotivo: number; sinMotivo: number; porIa: number } {
  const conMotivo = perdidos.filter((item) => item.reason);
  const filas = orden.map((motivo) => {
    const suyos = conMotivo.filter((item) => item.reason === motivo);
    return {
      motivo,
      cuantos: suyos.length,
      porcentaje: conMotivo.length > 0 ? (suyos.length / conMotivo.length) * 100 : 0,
      valor: suyos.reduce((suma, item) => suma + (Number(item.value) || 0), 0),
      porIa: suyos.filter((item) => item.source === "ia").length,
    };
  });
  // Un motivo que ya no está en la lista —uno de los de antes de separarlas—
  // también se cuenta: si no, el total no cuadraría con lo de encima.
  for (const item of conMotivo) {
    if (item.reason && !orden.includes(item.reason) && !filas.some((fila) => fila.motivo === item.reason)) {
      const suyos = conMotivo.filter((otro) => otro.reason === item.reason);
      filas.push({
        motivo: item.reason,
        cuantos: suyos.length,
        porcentaje: (suyos.length / conMotivo.length) * 100,
        valor: suyos.reduce((suma, otro) => suma + (Number(otro.value) || 0), 0),
        porIa: suyos.filter((otro) => otro.source === "ia").length,
      });
    }
  }
  return {
    // De más a menos: lo primero que se lee es por qué se pierde más.
    filas: filas.filter((fila) => fila.cuantos > 0).sort((a, b) => b.cuantos - a.cuantos || orden.indexOf(a.motivo) - orden.indexOf(b.motivo)),
    conMotivo: conMotivo.length,
    sinMotivo: perdidos.length - conMotivo.length,
    porIa: conMotivo.filter((item) => item.source === "ia").length,
  };
}
