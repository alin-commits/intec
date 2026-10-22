import "server-only";
import { generateJsonWithGemini } from "@/lib/gemini";
import { ESQUEMA, construirPregunta, interpretar, type LecturaDeRespuesta } from "@/lib/compras/leer-respuesta-prompt";

/*
  Entender qué ha contestado un proveedor.

  Va por el mismo Gemini que lee las facturas y las notas de informática: misma
  clave, mismos reintentos, mismos modelos de reserva. No tiene sentido meter
  un segundo proveedor de IA en la casa para leer cuatro líneas de un correo.

  Esto no decide nada: lee un correo y devuelve lo que ha entendido. Quién ha
  contestado y sobre qué pedido ya lo sabemos sin IA —la respuesta llega en el
  hilo de la reclamación—, así que aquí solo queda lo que un identificador no
  puede decir. El texto y el esquema están en leer-respuesta-prompt.ts, que se
  puede ejecutar suelto contra correos de verdad.
*/

export type { LecturaDeRespuesta };

export function iaConfigurada(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

/**
 * Lee la respuesta de un proveedor.
 *
 * Devuelve null si no hay clave o si Gemini falla: el correo se marca igual
 * como contestado —eso lo sabemos por el hilo— y se queda sin resumen. Que
 * falle la IA no puede dejar una respuesta sin detectar.
 */
export async function leerRespuesta(input: {
  proveedor: string;
  pedidos: string[];
  asunto: string;
  cuerpo: string;
  hoy: string;
}): Promise<LecturaDeRespuesta | null> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;

  const resultado = await generateJsonWithGemini({
    apiKey,
    label: `la respuesta de ${input.proveedor}`,
    timeBudgetMs: 45_000,
    responseSchema: ESQUEMA,
    parts: [{ text: construirPregunta(input) }],
  });
  if (!resultado.ok) return null;
  return interpretar(resultado.raw);
}
