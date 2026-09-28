import { NextResponse } from "next/server";
import { isSageAgent } from "@/lib/sage-agent-auth";
import { createAdminClient } from "@/lib/supabase/admin";

/*
  El agente del servidor de Sage pregunta aquí cada minuto si alguien ha
  pulsado "Actualizar desde Sage". Si hay una petición, se la queda (pasa a
  "leyendo") y la lee; si no, no hace nada más. Cada pregunta deja constancia de
  que el agente sigue vivo.
*/

export async function POST(request: Request) {
  if (!isSageAgent(request)) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "Supabase no está configurado." }, { status: 503 });

  const { data, error } = await admin.rpc("sage_claim_refresh");
  if (error) {
    console.error("Sage: no se pudo recoger la petición de lectura:", error.message);
    return NextResponse.json({ error: "No se pudo recoger la petición." }, { status: 500 });
  }
  const claimed = (Array.isArray(data) ? data[0] : data) as { id: string; days: number } | undefined;
  return NextResponse.json({ request: claimed ?? null }, { headers: { "Cache-Control": "no-store" } });
}
