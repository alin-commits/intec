import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { generateJsonWithGemini } from "@/lib/gemini";
import { ESQUEMA, Lectura, construirPregunta, interpretar, type LecturaDeRespuesta } from "@/lib/compras/leer-respuesta-prompt";

/*
  Entender qué ha contestado un proveedor.

  Dos caminos, y se elige solo: si hay clave de Anthropic va por Claude, y si
  no, por el mismo Gemini que lee las facturas. No es indecisión: Gemini
  funciona y acierta, pero su modelo pequeño se satura y devuelve 503 bastante
  a menudo —seis de ocho intentos en la primera prueba—, y esto corre sin nadie
  delante. Teniendo las dos, se usa la que menos se cae y la otra queda de
  reserva.

  Esto no decide nada: lee un correo y devuelve lo que ha entendido. Quién ha
  contestado y sobre qué pedido ya lo sabemos sin IA —la respuesta llega en el
  hilo de la reclamación—, así que aquí solo queda lo que un identificador no
  puede decir. El texto y el esquema están en leer-respuesta-prompt.ts, que se
  puede ejecutar suelto contra correos de verdad.
*/

export type { LecturaDeRespuesta };

/**
 * Qué modelo lee los correos.
 *
 * Haiku es el pequeño de la casa y para esto sobra: leer cuatro líneas de un
 * correo y sacar una fecha. Sale por céntimos al mes. Se puede subir a uno
 * mayor con COMPRAS_MODELO_IA si alguna vez se queda corto.
 */
const MODELO = process.env.COMPRAS_MODELO_IA?.trim() || "claude-haiku-5-5";

export function iaConfigurada(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.GEMINI_API_KEY);
}

/**
 * Lee la respuesta de un proveedor.
 *
 * Devuelve null si no hay con qué leerla o si falla: el correo se marca igual
 * como contestado —eso lo sabemos por el hilo— y se queda sin resumen, y el
 * cron lo reintenta en la siguiente pasada. Que falle la IA no puede dejar una
 * respuesta sin detectar.
 */
export async function leerRespuesta(input: {
  proveedor: string;
  pedidos: string[];
  asunto: string;
  cuerpo: string;
  hoy: string;
}): Promise<LecturaDeRespuesta | null> {
  const pregunta = construirPregunta(input);

  if (process.env.ANTHROPIC_API_KEY) {
    const porClaude = await conClaude(pregunta, input.proveedor);
    if (porClaude) return porClaude;
  }

  const geminiKey = process.env.GEMINI_API_KEY?.trim();
  if (!geminiKey) return null;
  const resultado = await generateJsonWithGemini({
    apiKey: geminiKey,
    label: `la respuesta de ${input.proveedor}`,
    timeBudgetMs: 45_000,
    responseSchema: ESQUEMA,
    parts: [{ text: pregunta }],
  });
  return resultado.ok ? interpretar(resultado.raw) : null;
}

async function conClaude(pregunta: string, proveedor: string): Promise<LecturaDeRespuesta | null> {
  try {
    const anthropic = new Anthropic();
    const respuesta = await anthropic.messages.parse({
      model: MODELO,
      max_tokens: 16000,
      // Esfuerzo bajo: es una extracción corta de un texto que ya viene
      // acotado, no hay nada que razonar largo y rato.
      output_config: { format: zodOutputFormat(Lectura), effort: "low" },
      messages: [{ role: "user", content: pregunta }],
    });
    if (respuesta.stop_reason === "refusal") {
      console.error(`Compras: Claude declinó leer la respuesta de ${proveedor}`, respuesta.stop_details);
      return null;
    }
    return respuesta.parsed_output ?? null;
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) console.error("Compras: Anthropic va saturado; se intenta con Gemini.");
    else if (error instanceof Anthropic.AuthenticationError) console.error("Compras: la clave de Anthropic no vale.");
    else if (error instanceof Anthropic.APIError) console.error(`Compras: Anthropic respondió ${error.status}`, error.message);
    else console.error("Compras: no se pudo leer la respuesta con Claude", error);
    return null;
  }
}
