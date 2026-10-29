import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { inquiryLossReasonOrder, leadLossReasonOrder, lossReasonLabels } from "@/lib/constants";
import { construirPregunta, esquemaDeClasificacion, NO_SE_SABE, type TipoDePerdida } from "@/lib/motivo-ia-prompt";
import type { LossReason } from "@/lib/types";

/*
  Elegir con IA el motivo de una pérdida, a partir de lo que cuenta el comercial.

  La IA no decide: propone. El comercial escribe qué ha pasado, la IA dice qué
  motivo de la lista le cuadra y por qué, y quien lo guarda —o lo cambia— es
  él. Si lo guarda tal cual, consta que salió de la IA.

  Mismo camino que lee las respuestas de los proveedores en compras: Claude,
  con el modelo pequeño. Para leer tres líneas y elegir entre nueve opciones
  sobra, y cada consulta sale por una fracción de céntimo.
*/

const MODELO = process.env.MOTIVOS_MODELO_IA?.trim() || "claude-haiku-5-5";

export function motivoIaConfigurado(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export type MotivoPropuesto =
  | { ok: true; motivo: LossReason; porque: string }
  | { ok: true; motivo: null; porque: string }
  | { ok: false; error: string };

export function opcionesDe(tipo: TipoDePerdida) {
  const lista = tipo === "lead" ? leadLossReasonOrder : inquiryLossReasonOrder;
  return lista.map((codigo) => ({ codigo, etiqueta: lossReasonLabels[codigo] }));
}

export async function proponerMotivo(input: { tipo: TipoDePerdida; texto: string; interes?: string | null }): Promise<MotivoPropuesto> {
  if (!motivoIaConfigurado()) return { ok: false, error: "La IA no está configurada en el servidor." };
  const opciones = opcionesDe(input.tipo);
  const esquema = esquemaDeClasificacion(opciones);
  try {
    const anthropic = new Anthropic();
    const respuesta = await anthropic.messages.parse({
      model: MODELO,
      max_tokens: 2000,
      // Esfuerzo bajo: elegir entre nueve motivos a partir de tres líneas no
      // pide razonar largo.
      output_config: { format: zodOutputFormat(esquema), effort: "low" },
      messages: [{ role: "user", content: construirPregunta({ ...input, opciones }) }],
    });
    if (respuesta.stop_reason === "refusal") return { ok: false, error: "La IA no ha querido leerlo. Elige el motivo a mano." };
    const salida = respuesta.parsed_output;
    if (!salida) return { ok: false, error: "La IA no ha devuelto un motivo. Elige el motivo a mano." };
    const porque = salida.porque.trim().slice(0, 240);
    if (salida.motivo === NO_SE_SABE) return { ok: true, motivo: null, porque };
    // Solo uno de la lista de este tipo: la base no admitiría otro.
    const valido = opciones.some((opcion) => opcion.codigo === salida.motivo);
    return valido ? { ok: true, motivo: salida.motivo as LossReason, porque } : { ok: true, motivo: null, porque };
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) console.error("Motivos: Anthropic va saturado.");
    else if (error instanceof Anthropic.AuthenticationError) console.error("Motivos: la clave de Anthropic no vale.");
    else if (error instanceof Anthropic.APIError) console.error(`Motivos: Anthropic respondió ${error.status}`, error.message);
    else console.error("Motivos: no se pudo proponer el motivo con Claude", error);
    return { ok: false, error: "No se pudo consultar a la IA. Elige el motivo a mano." };
  }
}
