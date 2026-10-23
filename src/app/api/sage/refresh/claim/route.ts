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

  /*
    El agente no puede leer Sage dos veces a la vez. Cuando la tarea de cada
    minuto se encuentra con una lectura larga en marcha, se sale sin recoger
    nada —si recogiera la petición, la dejaría a medias—, pero pasa por aquí a
    decir que sigue vivo y ocupado. Sin esto, el panel no distinguía un
    servidor trabajando de uno apagado y mandaba a revisar una tarea que
    estaba perfectamente.
  */
  const cuerpo = (await request.json().catch(() => ({}))) as { ocupado?: boolean };
  if (cuerpo?.ocupado === true) {
    const ahora = new Date().toISOString();
    const { data: antes } = await admin.from("sage_agent_status").select("busy_since").eq("id", 1).maybeSingle();
    await admin.from("sage_agent_status")
      .update({ last_poll_at: ahora, busy_since: (antes?.busy_since as string | null) ?? ahora })
      .eq("id", 1);
    return NextResponse.json({ request: null, ocupado: true }, { headers: { "Cache-Control": "no-store" } });
  }

  const { data, error } = await admin.rpc("sage_claim_refresh");
  if (error) {
    console.error("Sage: no se pudo recoger la petición de lectura:", error.message);
    return NextResponse.json({ error: "No se pudo recoger la petición." }, { status: 500 });
  }
  // Si ha podido preguntar, es que ya no está ocupado.
  await admin.from("sage_agent_status").update({ busy_since: null }).eq("id", 1).not("busy_since", "is", null);
  const claimed = (Array.isArray(data) ? data[0] : data) as { id: string; days: number } | undefined;
  return NextResponse.json({ request: claimed ?? null }, { headers: { "Cache-Control": "no-store" } });
}
