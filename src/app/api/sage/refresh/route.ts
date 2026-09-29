import { NextResponse } from "next/server";
import { z } from "zod";
import { hasAnyRole, SALES_ROLES } from "@/lib/constants";
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
const bodySchema = z.object({ days: z.number().int().min(1).max(90).default(2) });

async function allowedClient() {
  const supabase = await createClient();
  if (!supabase) return { error: NextResponse.json({ error: "Supabase no está configurado." }, { status: 503 }) };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "No autorizado." }, { status: 401 }) };
  const { data: profile } = await supabase.from("profiles").select("roles, is_active").eq("id", user.id).maybeSingle();
  if (!profile?.is_active || !hasAnyRole(profile.roles as AppRole[], SALES_ROLES)) {
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

export async function GET() {
  const access = await allowedClient();
  if ("error" in access) return access.error;
  const { supabase } = access;
  await expireForgottenRequests();
  const [latest, agent] = await Promise.all([
    supabase.from("sage_refresh_requests").select(COLUMNS).order("requested_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("sage_agent_status").select("last_poll_at").eq("id", 1).maybeSingle(),
  ]);
  if (latest.error || agent.error) return NextResponse.json({ error: "No se pudo consultar la lectura de Sage." }, { status: 500 });
  return NextResponse.json(
    { request: latest.data ?? null, agentLastPoll: agent.data?.last_poll_at ?? null },
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
