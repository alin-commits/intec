import { NextResponse } from "next/server";
import { isSageAgent } from "@/lib/sage-agent-auth";
import { describeIngest, sageIngestSchema, toDatabasePayload, type SageIngestBody } from "@/lib/sage-ingest";
import { createAdminClient } from "@/lib/supabase/admin";

/*
  Por aquí entran las cifras de Sage.

  Quien llama no es una persona sino el agente que corre en el servidor de Sage,
  así que no hay sesión: se identifica con una clave compartida. Y no manda
  documentos ni clientes con nombre, solo totales, que es lo único que necesita
  el panel.

  Todo el envío se guarda de una vez en la base de datos (`sage_ingest`): o entra
  entero o no se toca nada. Antes se borraban los días y se escribían por trozos,
  y un envío cortado a mitad dejaba días vacíos hasta la siguiente lectura.

  La escritura va con el rol de servicio a propósito: estas tablas no admiten
  escrituras desde el navegador, ni siquiera de un administrador.
*/

export const maxDuration = 150;

/**
 * La base de datos guarda un bloque en menos de un segundo. Lo que falla, a
 * ratos, es el camino hasta ella: la llamada tarda medio minuto o se queda
 * colgada sin llegar nunca (el 25/09 y el 29/09, con bloques de 55 filas y de
 * 600 KB). La función esperaba hasta que Vercel la cortaba y la lectura se
 * quedaba a medias sin decir por qué. Ahora cada intento tiene su tiempo y,
 * si no contesta, se repite. Repetir no duplica nada: el bloque entra entero
 * o no entra.
 */
const ATTEMPT_MS = 40_000;
const ATTEMPTS = 3;

async function saveBlock(admin: NonNullable<ReturnType<typeof createAdminClient>>, payload: Record<string, unknown>) {
  let result = await admin.rpc("sage_ingest", { p: payload }).abortSignal(AbortSignal.timeout(ATTEMPT_MS));
  for (let attempt = 2; attempt <= ATTEMPTS; attempt += 1) {
    // Solo se repite lo que no llegó a contestar (status 0) o lo que cortó la
    // pasarela. Un error de la propia base de datos daría lo mismo otra vez.
    if (!result.error || (result.status !== 0 && result.status < 502)) break;
    console.warn(`Sage: el intento ${attempt - 1} de guardar no contestó (${result.error.message}); se repite.`);
    result = await admin.rpc("sage_ingest", { p: payload }).abortSignal(AbortSignal.timeout(ATTEMPT_MS));
  }
  return result;
}

export async function POST(request: Request) {
  if (!isSageAgent(request)) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "Supabase no está configurado." }, { status: 503 });

  let body: SageIngestBody;
  try {
    const parsed = sageIngestSchema.safeParse(await request.json());
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return NextResponse.json({ error: "Datos no válidos.", detail: issue ? `${issue.path.join(".")}: ${issue.message}` : undefined }, { status: 400 });
    }
    body = parsed.data;
  } catch {
    return NextResponse.json({ error: "No se pudo leer la solicitud." }, { status: 400 });
  }
  if (body.coveredTo < body.coveredFrom) {
    return NextResponse.json({ error: "La ventana de fechas está al revés." }, { status: 400 });
  }

  // El envío queda apuntado antes de escribir nada: si algo falla, se sabe que
  // hubo un intento y por qué no terminó.
  const { data: run } = await admin
    .from("sage_sync_runs")
    .insert({ covered_from: body.coveredFrom, covered_to: body.coveredTo })
    .select("id")
    .single();
  const runId = run?.id as string | undefined;

  const { data, error, status } = await saveBlock(admin, toDatabasePayload(body));
  if (error) {
    const message = `No se guardó nada de este envío: ${error.message}`;
    if (runId) await admin.from("sage_sync_runs").update({ finished_at: new Date().toISOString(), ok: false, message: message.slice(0, 2000) }).eq("id", runId);
    console.error("Sage:", message);
    // 503 cuando la base de datos no contestó: el agente sabe que puede reintentar.
    return NextResponse.json({ error: message }, { status: status === 0 || status >= 502 ? 503 : 500 });
  }

  const counts = (data ?? {}) as Record<string, number>;
  if (runId) {
    await admin.from("sage_sync_runs").update({
      finished_at: new Date().toISOString(),
      rows_written: counts.sales ?? 0,
      ok: true,
      message: describeIngest(body, counts),
    }).eq("id", runId);
  }

  // `rowsWritten` es lo que apunta en su registro el agente antiguo.
  return NextResponse.json({ ok: true, rowsWritten: counts.sales ?? 0, written: counts });
}
