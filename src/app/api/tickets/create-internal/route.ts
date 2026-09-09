import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { TICKET_MANAGER_ROLES } from "@/lib/tickets/constants";
import { internalTicketSchema } from "@/lib/tickets/validation";
import { hasAnyRole } from "@/lib/constants";
import type { AppRole } from "@/lib/types";
import type { TicketBlockingLevel, TicketPriority } from "@/lib/tickets/types";

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
  const blockingLevel = blockingLevelForPriority[data.priority];

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
      blocking_level: blockingLevel,
      priority: data.priority,
      created_at: new Date(`${data.occurredOn}T09:00:00`).toISOString(),
    })
    .select("id, ticket_number")
    .single();

  if (insertError || !ticket) {
    console.error("Error al crear ticket manual:", insertError);
    return NextResponse.json({ error: "No se pudo crear el ticket. Inténtalo de nuevo." }, { status: 500 });
  }

  await admin.from("ticket_events").insert({ ticket_id: ticket.id, actor_id: user.id, event_type: "created", new_value: "new" });

  // Sin aviso por email: quien crea el ticket manualmente (admin/IT) ya sabe que existe.

  return NextResponse.json({ ok: true, ticketNumber: ticket.ticket_number });
}
