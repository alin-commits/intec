import { NextResponse } from "next/server";
import { z } from "zod";
import { appOrigin } from "@/lib/app-origin";
import { isEmailConfigured, sendEmail } from "@/lib/email";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { buildTicketCreatedEmail } from "@/lib/tickets/email-templates";
import type { TicketBlockingLevel, TicketPriority } from "@/lib/tickets/types";

// A signed-in worker reporting their own incident: the reporter is taken from
// their profile, never from the form, so nobody can file a ticket as somebody else.
const schema = z.object({
  title: z.string().trim().min(3, "Indica un título breve.").max(150),
  description: z.string().trim().max(4000).optional(),
  category: z.enum(["erp_apps", "equipment", "accounts_access", "network"], "Selecciona una categoría."),
  priority: z.enum(["high", "medium", "low"], "Selecciona una prioridad."),
});

const blockingLevelForPriority: Record<TicketPriority, TicketBlockingLevel> = {
  high: "blocked",
  medium: "hindered",
  low: "not_blocked",
};

export async function POST(request: Request) {
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase no está configurado." }, { status: 503 });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("full_name, email, is_active").eq("id", user.id).maybeSingle();
  if (!profile?.is_active) return NextResponse.json({ error: "Tu cuenta está desactivada." }, { status: 403 });

  let input: z.infer<typeof schema>;
  try {
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Revisa los datos." }, { status: 400 });
    input = parsed.data;
  } catch {
    return NextResponse.json({ error: "No se pudo leer la solicitud." }, { status: 400 });
  }

  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "El sistema no está disponible." }, { status: 503 });

  const reporterName = profile.full_name || user.email || "Empleado";
  const reporterEmail = (profile.email as string | null) ?? user.email ?? null;
  const { data: ticket, error } = await admin
    .from("tickets")
    .insert({
      reporter_name: reporterName,
      reporter_phone: "—",
      reporter_email: reporterEmail,
      department: "Interno",
      title: input.title,
      category: input.category,
      description: input.description ?? "",
      blocking_level: blockingLevelForPriority[input.priority],
      priority: input.priority,
    })
    .select("id, ticket_number")
    .single();
  if (error || !ticket) {
    console.error("Error al crear la incidencia del empleado:", error);
    return NextResponse.json({ error: "No se pudo crear la incidencia. Inténtalo de nuevo." }, { status: 500 });
  }
  await admin.from("ticket_events").insert({ ticket_id: ticket.id, actor_id: user.id, event_type: "created", new_value: "new" });

  if (isEmailConfigured()) {
    const { data: itStaff } = await admin.from("profiles").select("email").overlaps("roles", ["admin", "it"]).eq("is_active", true).not("email", "is", null);
    const recipients = new Set((itStaff ?? []).map((row) => row.email as string));
    if (process.env.ADMIN_EMAIL) recipients.add(process.env.ADMIN_EMAIL);
    if (recipients.size > 0) {
      await sendEmail({
        to: Array.from(recipients),
        ...buildTicketCreatedEmail({
          ticketNumber: ticket.ticket_number,
          ticketUrl: `${appOrigin(request)}/tickets/${ticket.id}`,
          title: input.title,
          reporterName,
          reporterPhone: "—",
          reporterEmail,
          department: "Interno",
          category: input.category,
          priority: input.priority,
          blockingLevel: blockingLevelForPriority[input.priority],
          description: input.description ?? "",
        }),
      });
    }
  }

  return NextResponse.json({ ok: true, ticketNumber: ticket.ticket_number });
}
