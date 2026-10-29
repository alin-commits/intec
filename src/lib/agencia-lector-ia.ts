import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { CONCEPTOS_SUGERIDOS } from "@/lib/agencia";
import { construirPregunta, esquemaDeLectura, limpiarLectura, type PartidaPropuesta } from "@/lib/agencia-lector";

/*
  La llamada a Claude que lee el presupuesto de la agencia.

  El mismo camino que el motivo de pérdida y las respuestas de compras, pero
  con el modelo grande: aquí hay que leer tablas de un PDF o de un Excel,
  repartir importes y no confundir un subtotal con una partida. Se usa unas
  pocas veces al año, así que el coste no pesa y equivocarse sí.

  El PDF va tal cual, que Claude lo lee entero, tablas incluidas. El Excel
  llega ya pasado a texto (ver xlsx-a-texto.ts).
*/

const MODELO = process.env.AGENCIA_MODELO_IA?.trim() || "claude-opus-5-5";

export function lectorConfigurado(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export type DocumentoDePresupuesto =
  | { tipo: "pdf"; base64: string; nombre: string }
  | { tipo: "texto"; texto: string; nombre: string };

export type PresupuestoLeido =
  | { ok: true; resumen: string; partidas: PartidaPropuesta[]; avisos: string[] }
  | { ok: false; error: string };

export async function leerPresupuesto(input: { documento: DocumentoDePresupuesto; marcas: { id: string; name: string }[]; hoy: string }): Promise<PresupuestoLeido> {
  if (!lectorConfigurado()) return { ok: false, error: "La IA no está configurada en el servidor." };
  const { documento, marcas } = input;
  const esquema = esquemaDeLectura(marcas.map((marca) => marca.name));
  const pregunta = construirPregunta({ marcas: marcas.map((marca) => marca.name), conceptos: CONCEPTOS_SUGERIDOS, hoy: input.hoy, archivo: documento.nombre });
  try {
    const anthropic = new Anthropic();
    const respuesta = await anthropic.messages.parse({
      model: MODELO,
      max_tokens: 16000,
      output_config: { format: zodOutputFormat(esquema), effort: "medium" },
      messages: [{
        role: "user",
        content: [
          documento.tipo === "pdf"
            ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: documento.base64 }, title: documento.nombre }
            : { type: "document", source: { type: "text", media_type: "text/plain", data: documento.texto }, title: documento.nombre },
          { type: "text", text: pregunta },
        ],
      }],
    });
    if (respuesta.stop_reason === "refusal") return { ok: false, error: "La IA no ha querido leer el documento. Mete las partidas a mano." };
    if (respuesta.stop_reason === "max_tokens") return { ok: false, error: "El presupuesto es demasiado largo para leerlo de una vez. Prueba con una parte, o mete las partidas a mano." };
    const salida = respuesta.parsed_output;
    if (!salida) return { ok: false, error: "La IA no ha devuelto las partidas. Prueba otra vez o mételas a mano." };
    return { ok: true, ...limpiarLectura(salida, marcas) };
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) console.error("Agencia: Anthropic va saturado.");
    else if (error instanceof Anthropic.AuthenticationError) console.error("Agencia: la clave de Anthropic no vale.");
    else if (error instanceof Anthropic.APIError) console.error(`Agencia: Anthropic respondió ${error.status}`, error.message);
    else console.error("Agencia: no se pudo leer el presupuesto con Claude", error);
    if (error instanceof Anthropic.RateLimitError) return { ok: false, error: "La IA va saturada ahora mismo. Prueba en un minuto." };
    return { ok: false, error: "No se pudo consultar a la IA. Prueba otra vez o mete las partidas a mano." };
  }
}
