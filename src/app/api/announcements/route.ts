import { NextResponse } from "next/server";
import { z } from "zod";
import { appOrigin } from "@/lib/app-origin";
import { ANNOUNCEMENT_SENDER_ROLES, hasAnyRole } from "@/lib/constants";
import { isEmailConfigured, sendEmail } from "@/lib/email";
import { buildAnnouncementEmail } from "@/lib/notification-emails";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { AppRole } from "@/lib/types";

const announcementSchema = z.object({
  title: z.string().trim().min(1, "Escribe un título.").max(120, "El título es demasiado largo."),
  body: z.string().trim().min(1, "Escribe el mensaje.").max(2000, "El mensaje es demasiado largo (máximo 2000 caracteres)."),
  recipientIds: z.array(z.string().uuid()).min(1, "Elige al menos un destinatario.").max(500),
  sendEmail: z.boolean().default(false),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase no está configurado." }, { status: 503 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const { data: sender } = await supabase.from("profiles").select("full_name, roles, is_active").eq("id", user.id).maybeSingle();
  if (!sender?.is_active || !hasAnyRole(sender.roles as AppRole[], ANNOUNCEMENT_SENDER_ROLES)) {
    return NextResponse.json({ error: "No tienes permiso para enviar avisos." }, { status: 403 });
  }

  let input: z.infer<typeof announcementSchema>;
  try {
    const parsed = announcementSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Revisa el aviso." }, { status: 400 });
    input = parsed.data;
  } catch {
    return NextResponse.json({ error: "No se pudo leer la solicitud." }, { status: 400 });
  }

  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "El sistema no está disponible." }, { status: 503 });

  // Only active users can receive notices; unknown or inactive ids are dropped.
  const { data: recipients, error: recipientsError } = await admin.from("profiles").select("id, email").in("id", Array.from(new Set(input.recipientIds))).eq("is_active", true);
  if (recipientsError) return NextResponse.json({ error: "No se pudieron comprobar los destinatarios." }, { status: 500 });
  if (!recipients?.length) return NextResponse.json({ error: "Ninguno de los destinatarios está activo." }, { status: 400 });

  const senderName = sender.full_name || user.email || "Administración";
  const { data: announcement, error: insertError } = await admin
    .from("announcements")
    .insert({ sender_id: user.id, sender_name: senderName, title: input.title, body: input.body })
    .select("id")
    .single();
  if (insertError || !announcement) {
    console.error("No se pudo guardar el aviso:", insertError);
    return NextResponse.json({ error: "No se pudo enviar el aviso." }, { status: 500 });
  }
  const { error: linkError } = await admin.from("announcement_recipients").insert(recipients.map((recipient) => ({ announcement_id: announcement.id, recipient_id: recipient.id })));
  if (linkError) {
    await admin.from("announcements").delete().eq("id", announcement.id);
    console.error("No se pudieron guardar los destinatarios del aviso:", linkError);
    return NextResponse.json({ error: "No se pudo enviar el aviso." }, { status: 500 });
  }

  // One email per person so nobody sees the rest of the recipient list.
  let emailed = 0;
  if (input.sendEmail && isEmailConfigured()) {
    const email = buildAnnouncementEmail({ senderName, title: input.title, body: input.body, url: `${appOrigin(request)}/dashboard` });
    for (const recipient of recipients) {
      if (recipient.email && (await sendEmail({ to: recipient.email as string, ...email }))) emailed++;
    }
  }

  return NextResponse.json({ ok: true, recipients: recipients.length, emailed });
}
