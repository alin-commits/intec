import { NextResponse } from "next/server";
import { createClient as createPlainClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { AppRole } from "@/lib/types";

/**
 * Entrega la sesión de una cuenta de prueba, para mirar la aplicación como ese
 * rol sin saberse su contraseña.
 *
 * Es la ruta más delicada de la aplicación —reparte sesiones— así que tiene dos
 * cierres independientes, y los dos se comprueban aquí, en el servidor:
 *
 *   1. Quien llama tiene que ser dueño o admin, según su propia sesión. No se
 *      mira nada que venga en la petición para decidirlo.
 *   2. La cuenta pedida tiene que estar marcada como de prueba. El filtro va en
 *      la consulta, no en un "if" posterior: si alguien pide la cuenta de una
 *      persona real, no se encuentra y no hay nada que devolver.
 *
 * La sesión se saca con un enlace de un solo uso que se canjea aquí mismo. Ese
 * enlace no se envía por correo ni se guarda: nace y se gasta en esta función.
 */
export async function POST(request: Request) {
  const noStore = { headers: { "Cache-Control": "no-store" } };

  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase no está configurado." }, { status: 503, ...noStore });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado." }, { status: 401, ...noStore });

  const { data: quienLlama } = await supabase.from("profiles").select("roles, is_active, is_preview").eq("id", user.id).maybeSingle();
  if (!quienLlama?.is_active) return NextResponse.json({ error: "Tu cuenta está desactivada." }, { status: 403, ...noStore });
  const roles = (quienLlama.roles ?? []) as AppRole[];
  // Desde una cuenta de prueba no se salta a otra: para volver está la sesión
  // guardada en el navegador, que es de quien empezó.
  if (quienLlama.is_preview || !roles.some((role) => role === "owner" || role === "admin")) {
    return NextResponse.json({ error: "No tienes permiso para cambiar de cuenta." }, { status: 403, ...noStore });
  }

  let userId: unknown;
  try {
    ({ userId } = (await request.json()) as { userId?: unknown });
  } catch {
    return NextResponse.json({ error: "Petición mal formada." }, { status: 400, ...noStore });
  }
  if (typeof userId !== "string" || userId.length === 0) {
    return NextResponse.json({ error: "Falta la cuenta." }, { status: 400, ...noStore });
  }

  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "El sistema no está disponible." }, { status: 503, ...noStore });

  const { data: destino } = await admin
    .from("profiles")
    .select("id, email, full_name")
    .eq("id", userId)
    .eq("is_preview", true)
    .eq("is_active", true)
    .maybeSingle();
  if (!destino?.email) {
    return NextResponse.json({ error: "Esa no es una cuenta de prueba." }, { status: 404, ...noStore });
  }

  const { data: enlace, error: errorEnlace } = await admin.auth.admin.generateLink({ type: "magiclink", email: destino.email });
  if (errorEnlace || !enlace?.properties?.hashed_token) {
    return NextResponse.json({ error: "No se pudo preparar la sesión de prueba." }, { status: 502, ...noStore });
  }

  // Un cliente aparte y sin memoria: canjear el enlace con el de la petición
  // pisaría la sesión de quien está llamando.
  const canjeador = createPlainClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: canje, error: errorCanje } = await canjeador.auth.verifyOtp({
    token_hash: enlace.properties.hashed_token,
    type: "magiclink",
  });
  if (errorCanje || !canje?.session) {
    return NextResponse.json({ error: "No se pudo abrir la sesión de prueba." }, { status: 502, ...noStore });
  }

  return NextResponse.json({
    accessToken: canje.session.access_token,
    refreshToken: canje.session.refresh_token,
    fullName: destino.full_name,
  }, noStore);
}
