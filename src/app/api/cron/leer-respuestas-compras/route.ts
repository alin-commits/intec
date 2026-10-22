import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { buzonListo, leerRespuestasDeProveedores } from "@/lib/compras/leer-respuestas";

/*
  La pasada de la mañana: lee lo que han contestado los proveedores.

  Corre a las ocho, diez minutos antes de que salgan las reclamaciones del día,
  para no reclamarle a alguien que contestó ayer por la tarde. Una vez al día,
  que es lo que deja el plan gratuito de Vercel; durante la jornada se pide
  desde el botón de la pantalla de Compras.

  Lo que hace está en leerRespuestasDeProveedores(), que es lo que comparten
  los dos sitios.
*/

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  if (!buzonListo()) return NextResponse.json({ skipped: "El buzón de compras no está configurado." });
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "Falta SUPABASE_SERVICE_ROLE_KEY." }, { status: 503 });

  const resultado = await leerRespuestasDeProveedores(admin);
  if ("error" in resultado) return NextResponse.json({ error: resultado.error }, { status: resultado.estado });
  return NextResponse.json(resultado);
}
