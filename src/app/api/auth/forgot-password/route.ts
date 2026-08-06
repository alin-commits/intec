import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isEmailConfigured, sendEmail } from "@/lib/email";
import { buildResetPasswordEmail } from "@/lib/email-templates";

const genericResponse = NextResponse.json({
  ok: true,
  message: "Si el email existe, te hemos enviado un enlace para restablecer tu contraseña.",
});

export async function POST(request: Request) {
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
  if (!admin) return genericResponse;

  const origin = new URL(request.url).origin;
  const { data, error } = await admin.auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo: `${origin}/reset-password` },
  });

  if (error || !data.properties?.action_link) {
    return genericResponse;
  }

  const sent = await sendEmail({ to: email, ...buildResetPasswordEmail(data.properties.action_link) });
  if (!sent) console.error("No se pudo enviar el email de restablecimiento vía Resend a", email);

  return genericResponse;
}
