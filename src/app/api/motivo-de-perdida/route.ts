import { NextResponse } from "next/server";
import { z } from "zod";
import { CONSULTAS_EDIT_ROLES, hasAnyRole } from "@/lib/constants";
import { motivoIaConfigurado, proponerMotivo } from "@/lib/motivo-ia";
import { createClient } from "@/lib/supabase/server";
import type { AppRole } from "@/lib/types";

/*
  Proponer con IA por qué se perdió un lead o una consulta.

  La llama el desplegable del motivo cuando el comercial ha contado con sus
  palabras qué pasó y pulsa «Que lo elija la IA». No guarda nada: devuelve un
  motivo y por qué, y el comercial decide si se lo queda.
*/

export const maxDuration = 30;

/** Quién puede marcar algo como perdido: en leads, también marketing. */
const ROLES_POR_TIPO: Record<"lead" | "consulta", AppRole[]> = {
  lead: ["admin", "commercial", "marketing"],
  consulta: CONSULTAS_EDIT_ROLES,
};

const cuerpo = z.object({
  tipo: z.enum(["lead", "consulta"]),
  // Lo que se guarda como detalle admite 300; se deja un poco más por si
  // pegan lo que dijo el cliente entero, que la IA lo resume igual.
  texto: z.string().trim().min(8, "Cuenta un poco más qué ha pasado: con tan poco no hay de dónde elegir.").max(1200),
  interes: z.string().trim().max(300).nullish(),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase no está configurado." }, { status: 503 });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  let datos: z.infer<typeof cuerpo>;
  try {
    datos = cuerpo.parse(await request.json());
  } catch (error) {
    const detalle = error instanceof z.ZodError ? error.issues[0]?.message ?? "Datos no válidos." : "Datos no válidos.";
    return NextResponse.json({ error: detalle }, { status: 400 });
  }

  const { data: perfil } = await supabase.from("profiles").select("roles, is_active").eq("id", user.id).maybeSingle();
  if (!perfil?.is_active || !hasAnyRole(perfil.roles as AppRole[], ROLES_POR_TIPO[datos.tipo])) {
    return NextResponse.json({ error: "No tienes permiso para marcar esto como perdido." }, { status: 403 });
  }
  if (!motivoIaConfigurado()) return NextResponse.json({ error: "La IA no está configurada en el servidor." }, { status: 503 });

  const propuesta = await proponerMotivo({ tipo: datos.tipo, texto: datos.texto, interes: datos.interes ?? null });
  if (!propuesta.ok) return NextResponse.json({ error: propuesta.error }, { status: 502 });
  return NextResponse.json({ motivo: propuesta.motivo, porque: propuesta.porque }, { headers: { "Cache-Control": "no-store" } });
}
