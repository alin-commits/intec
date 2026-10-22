import { NextResponse } from "next/server";
import { hasAnyRole, COMPRAS_ROLES } from "@/lib/constants";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { buzonListo, leerRespuestasDeProveedores } from "@/lib/compras/leer-respuestas";
import type { AppRole } from "@/lib/types";

/*
  Buscar respuestas ahora, desde la pantalla.

  El cron solo pasa una vez al día —es lo que deja el plan gratuito—, así que
  una respuesta de media mañana no se vería hasta el día siguiente. Esto deja
  pedirla a quien lleva compras.

  Solo lee: pide correos, se los pasa a Claude y apunta lo que entiende. No
  manda nada a ningún proveedor, así que no hace falta confirmar nada.
*/

export async function POST() {
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase no está configurado." }, { status: 503 });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const { data: perfil } = await supabase.from("profiles").select("roles, is_active").eq("id", user.id).maybeSingle();
  if (!perfil || !perfil.is_active || !hasAnyRole(perfil.roles as AppRole[], COMPRAS_ROLES)) {
    return NextResponse.json({ error: "No tienes permiso." }, { status: 403 });
  }

  if (!buzonListo()) return NextResponse.json({ error: "El buzón de compras no está configurado." }, { status: 503 });
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "Falta la clave de servicio." }, { status: 503 });

  const resultado = await leerRespuestasDeProveedores(admin);
  if ("error" in resultado) return NextResponse.json({ error: resultado.error }, { status: resultado.estado });
  return NextResponse.json(resultado);
}
