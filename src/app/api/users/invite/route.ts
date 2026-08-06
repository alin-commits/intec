import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isEmailConfigured, sendEmail } from "@/lib/email";
import { buildInviteEmail } from "@/lib/email-templates";
import type { AppRole } from "@/lib/types";

const allowedRoles = new Set<AppRole>(["admin", "commercial", "viewer", "it", "marketing", "direction"]);

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    if (!supabase) return NextResponse.json({ error: "Supabase no está configurado." }, { status: 503 });

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

    const { data: currentProfile } = await supabase.from("profiles").select("role, is_active").eq("id", user.id).maybeSingle();
    if (!currentProfile || currentProfile.role !== "admin" || !currentProfile.is_active) {
      return NextResponse.json({ error: "Solo un administrador puede invitar usuarios." }, { status: 403 });
    }

    const body = await request.json() as { email?: string; fullName?: string; role?: AppRole };
    const email = body.email?.trim().toLowerCase();
    const fullName = body.fullName?.trim();
    const role = body.role ?? "viewer";
    if (!email || !fullName || !allowedRoles.has(role)) {
      return NextResponse.json({ error: "Nombre, email y rol son obligatorios." }, { status: 400 });
    }

    const admin = createAdminClient();
    if (!admin) {
      return NextResponse.json({ error: "Falta SUPABASE_SERVICE_ROLE_KEY en Vercel." }, { status: 503 });
    }

    const origin = new URL(request.url).origin;

    if (isEmailConfigured()) {
      const { data, error } = await admin.auth.admin.generateLink({
        type: "invite",
        email,
        options: { data: { full_name: fullName }, redirectTo: `${origin}/invitacion` },
      });
      if (error) {
        console.error("Error al invitar usuario:", error);
        return NextResponse.json({ error: "No se pudo invitar al usuario. Comprueba que el email no esté ya registrado." }, { status: 400 });
      }
      if (data.user) {
        await admin.from("profiles").update({ full_name: fullName, email, role, is_active: true }).eq("id", data.user.id);
      }
      const actionLink = data.properties?.action_link;
      if (actionLink) {
        const sent = await sendEmail({ to: email, ...buildInviteEmail(fullName, actionLink) });
        if (!sent) console.error("No se pudo enviar el email de invitación vía Resend a", email);
      }
      return NextResponse.json({ ok: true });
    }

    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { full_name: fullName },
      redirectTo: `${origin}/invitacion`,
    });
    if (error) {
      console.error("Error al invitar usuario:", error);
      return NextResponse.json({ error: "No se pudo invitar al usuario. Comprueba que el email no esté ya registrado." }, { status: 400 });
    }
    if (data.user) {
      await admin.from("profiles").update({ full_name: fullName, email, role, is_active: true }).eq("id", data.user.id);
    }
    return NextResponse.json({ ok: true });
  } catch (cause) {
    console.error("Error inesperado en /api/users/invite:", cause);
    return NextResponse.json({ error: "No se pudo invitar al usuario. Inténtalo de nuevo." }, { status: 500 });
  }
}
