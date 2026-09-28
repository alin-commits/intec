import "server-only";
import { timingSafeEqual } from "node:crypto";

/**
 * Las rutas que llama el agente de Sage no tienen sesión: quien llama es un
 * programa en el servidor de la oficina, que se identifica con una clave
 * compartida (SAGE_INGEST_TOKEN).
 */
export function isSageAgent(request: Request): boolean {
  // Con trim: al pegar la clave en Vercel es fácil llevarse un salto de línea
  // o un espacio detrás, y eso bastaba para rechazar al agente sin más pista
  // que un 401.
  const secret = process.env.SAGE_INGEST_TOKEN?.trim();
  if (!secret) return false;
  const received = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return received.length === expected.length && timingSafeEqual(received, expected);
}
