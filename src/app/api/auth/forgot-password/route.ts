import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isEmailConfigured, sendEmail } from "@/lib/email";
import { buildResetPasswordEmail } from "@/lib/email-templates";
import { appOrigin } from "@/lib/app-origin";

const RATE_LIMIT_WINDOW_MINUTES = 60;
const MAX_PER_EMAIL = 3;
const MAX_PER_IP = 10;

function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return request.headers.get("x-real-ip") ?? "unknown";
}

function genericResponse() {
  return NextResponse.json({
    ok: true,
    message: "Si el email existe, te hemos enviado un enlace para restablecer tu contraseña.",
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { email?: string };
    const email = body.email?.trim().toLowerCase();
    if (!email) {
      return NextResponse.json({ error: "El email es obligatorio." }, { status: 400 });
    }

    if (!isEmailConfigured()) {
      return NextResponse.json(
        { error: "El envío de correos no está configurado todavía. Contacta con un administrador." },
        { status: 503 },
      );
    }

    const admin = createAdminClient();
    if (!admin) return genericResponse();

    // Stop anyone from flooding an inbox (or the Resend quota) with reset
    // emails. Over the limit we still answer the generic message, so the
    // response never reveals whether an address exists.
    const ip = getClientIp(request);
    const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60 * 1000).toISOString();
    const [{ count: emailCount }, { count: ipCount }] = await Promise.all([
      admin.from("password_reset_log").select("id", { count: "exact", head: true }).eq("email", email).gte("created_at", windowStart),
      admin.from("password_reset_log").select("id", { count: "exact", head: true }).eq("ip", ip).gte("created_at", windowStart),
    ]);
    if ((emailCount ?? 0) >= MAX_PER_EMAIL || (ipCount ?? 0) >= MAX_PER_IP) return genericResponse();
    await admin.from("password_reset_log").insert({ email, ip });

    const origin = appOrigin(request);
    const { data, error } = await admin.auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo: `${origin}/reset-password` },
    });

    if (error || !data.properties?.hashed_token) {
      return genericResponse();
    }

    // Supabase's own action_link redirects with the session in a URL hash
    // fragment, which the browser client (forced into PKCE flow by
    // @supabase/ssr) never picks up. Send our own link with token_hash
    // instead, verified explicitly via supabase.auth.verifyOtp() client-side.
    const actionLink = `${origin}/reset-password?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=recovery`;
    const sent = await sendEmail({ to: email, ...buildResetPasswordEmail(actionLink) });
    if (!sent) console.error("No se pudo enviar el email de restablecimiento vía Resend a", email);

    return genericResponse();
  } catch (cause) {
    console.error("Error inesperado en /api/auth/forgot-password:", cause);
    return NextResponse.json({ error: "No se pudo enviar el correo. Inténtalo de nuevo." }, { status: 500 });
  }
}
