import type { LeadStatus, LossReason } from "@/lib/types";

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

/** El motivo tal como se escribe en un formulario, antes de guardarse. */
export type MotivoEscrito = { reason: LossReason | ""; detail: string };

export const MOTIVO_VACIO: MotivoEscrito = { reason: "", detail: "" };

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

/** Lo que se manda a la base: el motivo y su detalle, o nulos fuera de «perdido». */
export function motivoParaGuardar(perdido: boolean, motivo: MotivoEscrito): { lost_reason: LossReason | null; lost_detail: string | null } {
  if (!perdido || !motivo.reason) return { lost_reason: null, lost_detail: null };
  return { lost_reason: motivo.reason, lost_detail: motivo.detail.trim() || null };
}
