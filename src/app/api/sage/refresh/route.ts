import { NextResponse } from "next/server";
import { z } from "zod";
import { hasAnyRole, SAGE_REFRESH_ROLES } from "@/lib/constants";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { AppRole } from "@/lib/types";

/*
  El botón "Actualizar desde Sage".

  POST deja una petición de lectura; GET dice cómo va la última y cuándo
  preguntó por última vez el agente del servidor de Sage (si deja de preguntar,
  el botón lo avisa en vez de esperar para siempre).

  Va con la sesión de quien pulsa: las reglas de la base de datos solo dejan a
  dirección y administración, las mismas personas que ven las ventas.
*/

const COLUMNS = "id, status, days, requested_at, started_at, finished_at, message";

/**
 * Una lectura a petición por hora, para toda la casa. Leer Sage no es gratis:
 * el agente entra en la base de la oficina y la recorre entera, así que un
 * botón que se puede pulsar sin parar es una forma de tumbar el servidor sin
 * querer. Las lecturas programadas siguen igual; esto solo limita el botón.
 */
const ESPERA_MS = 60 * 60 * 1000;
const bodySchema = z.object({ days: z.number().int().min(1).max(90).default(2) });

async function allowedClient() {
  const supabase = await createClient();
  if (!supabase) return { error: NextResponse.json({ error: "Supabase no está configurado." }, { status: 503 }) };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "No autorizado." }, { status: 401 }) };
  const { data: profile } = await supabase.from("profiles").select("roles, is_active").eq("id", user.id).maybeSingle();
  if (!profile?.is_active || !hasAnyRole(profile.roles as AppRole[], SAGE_REFRESH_ROLES)) {
    return { error: NextResponse.json({ error: "No tienes permiso para leer Sage." }, { status: 403 }) };
  }
  return { supabase, userId: user.id };
}

/**
 * Da por caducadas las peticiones que nadie recoge. Lo hacía solo el agente al
 * preguntar, y con el servidor de Sage apagado nadie preguntaba: la petición se
 * quedaba "esperando" para siempre y bloqueaba el botón.
 */
async function expireForgottenRequests() {
  const admin = createAdminClient();
  if (!admin) return;
  const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  await admin
    .from("sage_refresh_requests")
    .update({ status: "caducada", finished_at: new Date().toISOString(), message: "El servidor de Sage no recogió la petición a tiempo." })
    .eq("status", "pendiente")
    .lt("requested_at", cutoff);
}

/**
 * Hasta cuándo hay que esperar para volver a pedir, o null si se puede ya.
 *
 * Cuenta cualquier petición de la última hora, saliera bien o no. Se pensó en
 * perdonar las que caducaron (el servidor apagado no lee nada y no le cuesta
 * nada a nadie), pero eso deja una rendija: una regla con excepciones invita a
 * pulsar a ver si cuela. Una por hora, sin más.
 */
async function siguienteLecturaPermitida(supabase: NonNullable<Awaited<ReturnType<typeof createClient>>>): Promise<string | null> {
  const desde = new Date(Date.now() - ESPERA_MS).toISOString();
  const { data } = await supabase
    .from("sage_refresh_requests")
    .select("requested_at")
    .gte("requested_at", desde)
    .order("requested_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return new Date(new Date(data.requested_at as string).getTime() + ESPERA_MS).toISOString();
}

export async function GET() {
  const access = await allowedClient();
  if ("error" in access) return access.error;
  const { supabase } = access;
  await expireForgottenRequests();
  const [latest, agent, nextAllowedAt] = await Promise.all([
    supabase.from("sage_refresh_requests").select(COLUMNS).order("requested_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("sage_agent_status").select("last_poll_at").eq("id", 1).maybeSingle(),
    siguienteLecturaPermitida(supabase),
  ]);
  if (latest.error || agent.error) return NextResponse.json({ error: "No se pudo consultar la lectura de Sage." }, { status: 500 });
  return NextResponse.json(
    { request: latest.data ?? null, agentLastPoll: agent.data?.last_poll_at ?? null, nextAllowedAt },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const access = await allowedClient();
  if ("error" in access) return access.error;
  const { supabase, userId } = access;
  await expireForgottenRequests();

  let days = 2;
  try {
    const text = await request.text();
    const parsed = bodySchema.safeParse(text ? JSON.parse(text) : {});
    if (!parsed.success) return NextResponse.json({ error: "Petición no válida." }, { status: 400 });
    days = parsed.data.days;
  } catch {
    return NextResponse.json({ error: "Petición no válida." }, { status: 400 });
  }

  // El límite se comprueba aquí y no solo en el botón: recargar la página no
  // puede servir para saltárselo.
  const nextAllowedAt = await siguienteLecturaPermitida(supabase);
  if (nextAllowedAt) {
    return NextResponse.json(
      { error: "Sage ya se ha leído hace menos de una hora. Inténtalo más tarde.", nextAllowedAt },
      { status: 429 },
    );
  }

  const { data, error } = await supabase
    .from("sage_refresh_requests")
    .insert({ requested_by: userId, days, status: "pendiente" })
    .select(COLUMNS)
    .single();

  if (error) {
    // Ya hay una esperando o leyéndose: se enseña esa en vez de apilar otra.
    if (error.code === "23505") {
      const { data: active } = await supabase
        .from("sage_refresh_requests")
        .select(COLUMNS)
        .in("status", ["pendiente", "leyendo"])
        .order("requested_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return NextResponse.json({ request: active ?? null, alreadyRunning: true });
    }
    console.error("No se pudo pedir la lectura de Sage:", error.message);
    return NextResponse.json({ error: "No se pudo pedir la lectura de Sage." }, { status: 500 });
  }
  return NextResponse.json({ request: data, alreadyRunning: false }, { status: 202 });
}
