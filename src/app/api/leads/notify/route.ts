import { NextResponse } from "next/server";
import { appOrigin } from "@/lib/app-origin";
import { hasAnyRole } from "@/lib/constants";
import { notifyNewLead } from "@/lib/lead-notify";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { AppRole } from "@/lib/types";

const LEAD_EDIT_ROLES: AppRole[] = ["admin", "commercial", "marketing"];

/**
 * Aviso de lead nuevo, llamado por la página de Leads justo después de crearlo
 * o de añadirle responsables. El envío en sí está en lib/lead-notify, que usa
 * también la entrada de los formularios de Meta.
 *
 * Que falle un correo no puede tumbar el guardado, así que la página lo llama
 * sin esperar la respuesta y aquí nunca se devuelve un error que asuste.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase no está configurado." }, { status: 503 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("full_name, roles, is_active").eq("id", user.id).maybeSingle();
  if (!profile?.is_active || !hasAnyRole(profile.roles as AppRole[], LEAD_EDIT_ROLES)) {
    return NextResponse.json({ error: "No tienes permiso." }, { status: 403 });
  }

  let leadId: string | undefined;
  let avisarA: string[] = [];
  try {
    const body = (await request.json()) as { leadId?: string; avisarA?: unknown };
    leadId = body.leadId;
    if (Array.isArray(body.avisarA)) avisarA = body.avisarA.filter((id): id is string => typeof id === "string");
  } catch {
    return NextResponse.json({ error: "No se pudo leer la solicitud." }, { status: 400 });
  }
  if (!leadId) return NextResponse.json({ error: "Falta el lead." }, { status: 400 });

  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "El sistema no está disponible." }, { status: 503 });

  const result = await notifyNewLead(admin, {
    leadId,
    avisarA,
    createdByName: (profile.full_name as string | null) ?? null,
    origin: appOrigin(request),
  });
  if ("error" in result) return NextResponse.json(result, { status: 404 });
  return NextResponse.json(result);
}
