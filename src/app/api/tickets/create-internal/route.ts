import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isEmailConfigured, sendEmail } from "@/lib/email";
import { buildTicketCreatedEmail } from "@/lib/tickets/email-templates";
import { TICKET_MANAGER_ROLES } from "@/lib/tickets/constants";
import { internalTicketSchema } from "@/lib/tickets/validation";
import { hasAnyRole } from "@/lib/constants";
import type { AppRole } from "@/lib/types";

const DEFAULT_BLOCKING_LEVEL = "hindered";
const DEFAULT_PRIORITY = "medium";

export async function POST(request: Request) {
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase no está configurado." }, { status: 503 });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("roles, is_active").eq("id", user.id).maybeSingle();
  if (!profile || !profile.is_active || !hasAnyRole(profile.roles as AppRole[], TICKET_MANAGER_ROLES)) {
    return NextResponse.json({ error: "No tienes permiso para crear tickets." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "No se pudo leer la solicitud." }, { status: 400 });
  }

  const parsed = internalTicketSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Revisa los datos del formulario." }, { status: 400 });
  }
  const data = parsed.data;
  const description = data.description ?? "";

  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "El sistema no está disponible en este momento." }, { status: 503 });

  const { data: ticket, error: insertError } = await admin
    .from("tickets")
    .insert({
      reporter_name: data.reporterName,
      reporter_phone: "—",
      reporter_email: null,
      department: "Interno",
      title: data.title,
      category: data.category,
      description,
      blocking_level: DEFAULT_BLOCKING_LEVEL,
      priority: DEFAULT_PRIORITY,
      created_at: new Date(`${data.occurredOn}T09:00:00`).toISOString(),
    })
    .select("id, ticket_number")
    .single();

  if (insertError || !ticket) {
    console.error("Error al crear ticket manual:", insertError);
    return NextResponse.json({ error: "No se pudo crear el ticket. Inténtalo de nuevo." }, { status: 500 });
  }

  await admin.from("ticket_events").insert({ ticket_id: ticket.id, actor_id: user.id, event_type: "created", new_value: "new" });

  if (isEmailConfigured()) {
    const { data: itStaff } = await admin
      .from("profiles")
      .select("email")
      .overlaps("roles", ["admin", "it"])
      .eq("is_active", true)
      .not("email", "is", null);
    const recipients = new Set((itStaff ?? []).map((row) => row.email as string));
    const adminEmail = process.env.ADMIN_EMAIL;
    if (adminEmail) recipients.add(adminEmail);

    if (recipients.size > 0) {
      const origin = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
      const sent = await sendEmail({
        to: Array.from(recipients),
        ...buildTicketCreatedEmail({
          ticketNumber: ticket.ticket_number,
          ticketUrl: `${origin}/tickets/${ticket.id}`,
          title: data.title,
          reporterName: data.reporterName,
          reporterPhone: "—",
          reporterEmail: null,
          department: "Interno",
          category: data.category,
          priority: DEFAULT_PRIORITY,
          blockingLevel: DEFAULT_BLOCKING_LEVEL,
          description: description || "(Sin descripción)",
        }),
      });
      if (!sent) console.error("No se pudo enviar el email de nuevo ticket manual vía Resend.");
    }
  }

  return NextResponse.json({ ok: true, ticketNumber: ticket.ticket_number });
}
