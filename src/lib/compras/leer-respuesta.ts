import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

/*
  Entender qué ha contestado un proveedor.

  Esto no decide nada: lee un correo y devuelve lo que ha entendido. Quién ha
  contestado y sobre qué pedido ya lo sabemos sin IA —la respuesta llega en el
  hilo de la reclamación—, así que aquí solo queda lo que una máquina no puede
  sacar de un identificador: si es una persona o un contestador automático, si
  han dado fecha, y qué han dicho en una línea.

  La fecha sale como PROPUESTA, nunca como hecho. Un correo de proveedor dice
  cosas como "sobre el 15, si nos llega el material de Italia", y de eso no se
  saca una fecha fiable. Por eso `fechaSegura`: si no está dicha claramente,
  alguien la mira antes de darla por buena.
*/

const Lectura = z.object({
  /** Si el correo es una respuesta de una persona del proveedor. */
  esDelProveedor: z.boolean(),
  /** Fuera de la oficina, acuse de recibo, "no responder a este correo"… */
  esAutomatico: z.boolean(),
  /** La fecha de entrega que dan, en formato yyyy-mm-dd, o null si no dan ninguna. */
  fechaPrevista: z.string().nullable(),
  /** Si esa fecha está dicha claramente y no es una conjetura ni va condicionada. */
  fechaSegura: z.boolean(),
  /** Qué han dicho, en una línea, en español y sin adornos. */
  resumen: z.string(),
});

export type LecturaDeRespuesta = z.infer<typeof Lectura>;

export function iaConfigurada(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const INSTRUCCIONES = `Lees correos que llegan al buzón de compras de una empresa de suministro industrial, en respuesta a una reclamación de fecha de entrega de un pedido a proveedor.

Tu trabajo es solo entender el correo. No decides nada.

Reglas:
- "esAutomatico" es verdadero para respuestas de máquina: fuera de la oficina, vacaciones, acuses de recibo, avisos de que el buzón no se lee. Estos no cuentan como respuesta aunque vengan del proveedor.
- "fechaPrevista" es la fecha en la que dicen que llegará o saldrá el material, en formato yyyy-mm-dd. Si dan varias fechas para líneas distintas, pon la más tardía, que es cuando el pedido estará completo. Si no dan ninguna, null.
- "fechaSegura" es verdadero solo si la fecha está dicha sin condiciones ("sale el 4 de noviembre"). Es falso si va condicionada o es aproximada ("sobre el 15", "si nos llega el material", "la semana que viene"), aunque hayas podido convertirla a una fecha concreta.
- "resumen" es una línea corta en español que valga para que alguien de compras entienda el correo sin abrirlo. Nada de "el proveedor dice que": ve al grano. Si avisan de algo que importa —que falta material, que suben el precio, que han enviado parte— dilo.

Escribe el resumen en español de España, en tono llano.`;

/**
 * Lee la respuesta de un proveedor.
 *
 * Devuelve null si la IA no está configurada o si la llamada falla: el correo
 * se marca igual como contestado —eso lo sabemos por el hilo— y simplemente se
 * queda sin resumen. Que falle Anthropic no puede dejar una reclamación sin
 * detectar.
 */
export async function leerRespuesta(input: {
  proveedor: string;
  pedidos: string[];
  asunto: string;
  cuerpo: string;
  /** La fecha de hoy, para que pueda resolver "la semana que viene". */
  hoy: string;
}): Promise<LecturaDeRespuesta | null> {
  if (!iaConfigurada()) return null;

  // El cuerpo llega con el hilo citado debajo: con el principio basta y evita
  // que se lea a sí misma la reclamación que mandamos nosotros.
  const cuerpo = input.cuerpo.slice(0, 6000);

  try {
    const anthropic = new Anthropic();
    const respuesta = await anthropic.messages.parse({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      output_config: { format: zodOutputFormat(Lectura), effort: "low" },
      system: INSTRUCCIONES,
      messages: [{
        role: "user",
        content: `Hoy es ${input.hoy}.
Proveedor: ${input.proveedor}
Pedidos por los que se le reclamó: ${input.pedidos.join(", ")}
Asunto: ${input.asunto}

Correo:
${cuerpo}`,
      }],
    });
    return respuesta.parsed_output ?? null;
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) console.error("Compras: Anthropic va saturado, se reintentará mañana.");
    else if (error instanceof Anthropic.AuthenticationError) console.error("Compras: la clave de Anthropic no vale.");
    else if (error instanceof Anthropic.APIError) console.error(`Compras: Anthropic respondió ${error.status}`, error.message);
    else console.error("Compras: no se pudo leer la respuesta con IA", error);
    return null;
  }
}
