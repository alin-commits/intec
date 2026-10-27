import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isEmailConfigured, sendEmail } from "@/lib/email";
import { buildInviteEmail } from "@/lib/email-templates";
import { appOrigin } from "@/lib/app-origin";
import { USER_MANAGER_ROLES, hasAnyRole } from "@/lib/constants";
import type { AppRole } from "@/lib/types";

/*
  Los roles que se pueden dar en una invitación son los mismos que ofrece la
  pantalla de Usuarios, y se traen de allí en vez de volver a escribirlos.

  Estaban escritos a mano, y por eso invitar a alguien como «Agencia» —o como
  «Compras»— fallaba con «selecciona al menos un rol válido»: la pantalla los
  ofrecía y esta lista, hecha antes de que esos roles existieran, no los
  conocía. Así un rol nuevo entra solo, y los que no se reparten desde aquí
  —el propietario y los del gestor de contraseñas— siguen fuera, porque
  USER_MANAGER_ROLES se construye quitándolos.
*/
const allowedRoles = new Set<AppRole>(USER_MANAGER_ROLES);

function normalizeRoles(input: unknown): AppRole[] | null {
  if (!Array.isArray(input) || input.length === 0) return null;
  const roles = input as AppRole[];
  if (!roles.every((role) => allowedRoles.has(role))) return null;
  return Array.from(new Set(roles));
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    if (!supabase) return NextResponse.json({ error: "Supabase no está configurado." }, { status: 503 });

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

    const { data: currentProfile } = await supabase.from("profiles").select("roles, is_active").eq("id", user.id).maybeSingle();
    /*
      Con hasAnyRole y no con includes("admin"): el propietario pasa por todas
      partes, igual que hace current_user_has_any_role() en la base. Preguntado
      a mano, esta puerta se le quedaba cerrada.
    */
    if (!currentProfile || !currentProfile.is_active || !hasAnyRole(currentProfile.roles as AppRole[], ["admin"])) {
      return NextResponse.json({ error: "Solo un administrador puede invitar usuarios." }, { status: 403 });
    }

    const body = await request.json() as { email?: string; fullName?: string; roles?: unknown };
    const email = body.email?.trim().toLowerCase();
    const fullName = body.fullName?.trim();
    if (!email || !fullName) {
      return NextResponse.json({ error: "Nombre y email son obligatorios." }, { status: 400 });
    }
    let roles: AppRole[] = ["viewer"];
    if (body.roles !== undefined) {
      const normalized = normalizeRoles(body.roles);
      if (!normalized) {
        return NextResponse.json({ error: "Selecciona al menos un rol válido." }, { status: 400 });
      }
      roles = normalized;
    }

    const admin = createAdminClient();
    if (!admin) {
      return NextResponse.json({ error: "Falta SUPABASE_SERVICE_ROLE_KEY en Vercel." }, { status: 503 });
    }

    const origin = appOrigin(request);

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
        await admin.from("profiles").update({ full_name: fullName, email, roles, is_active: true }).eq("id", data.user.id);
      }
      // Supabase's own action_link redirects with the session in a URL hash
      // fragment, which the browser client (forced into PKCE flow by
      // @supabase/ssr) never picks up. Send our own link with token_hash
      // instead, verified explicitly via supabase.auth.verifyOtp() client-side.
      if (data.properties?.hashed_token) {
        const actionLink = `${origin}/invitacion?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=invite`;
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
      await admin.from("profiles").update({ full_name: fullName, email, roles, is_active: true }).eq("id", data.user.id);
    }
    return NextResponse.json({ ok: true });
  } catch (cause) {
    console.error("Error inesperado en /api/users/invite:", cause);
    return NextResponse.json({ error: "No se pudo invitar al usuario. Inténtalo de nuevo." }, { status: 500 });
  }
}
