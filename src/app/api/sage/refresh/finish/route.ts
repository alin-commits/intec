import { NextResponse } from "next/server";
import { z } from "zod";
import { isSageAgent } from "@/lib/sage-agent-auth";
import { createAdminClient } from "@/lib/supabase/admin";

/* El agente avisa aquí de que ha terminado la lectura pedida con el botón. */

const bodySchema = z.object({
  id: z.string().uuid(),
  ok: z.boolean(),
  message: z.string().trim().max(500).optional(),
});

export async function POST(request: Request) {
  if (!isSageAgent(request)) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "Supabase no está configurado." }, { status: 503 });

  let body: z.infer<typeof bodySchema>;
  try {
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Datos no válidos." }, { status: 400 });
    body = parsed.data;
  } catch {
    return NextResponse.json({ error: "No se pudo leer la solicitud." }, { status: 400 });
  }

  // Solo se cierra si seguía leyéndose: una petición que ya se dio por
  // caducada o fallida no vuelve a abrirse.
  const { error } = await admin
    .from("sage_refresh_requests")
    .update({ status: body.ok ? "hecho" : "error", finished_at: new Date().toISOString(), message: body.message ?? null })
    .eq("id", body.id)
    .eq("status", "leyendo");
  if (error) {
    console.error("Sage: no se pudo cerrar la petición de lectura:", error.message);
    return NextResponse.json({ error: "No se pudo cerrar la petición." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
