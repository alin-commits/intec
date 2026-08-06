import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isEmailConfigured, sendEmail } from "@/lib/email";
import { buildTicketCreatedEmail } from "@/lib/tickets/email-templates";
import { priorityFromBlockingLevel } from "@/lib/tickets/constants";
import { ticketSubmissionSchema } from "@/lib/tickets/validation";

const ALLOWED_MIME_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "application/pdf": "pdf",
};
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_ATTACHMENTS = 5;
const RATE_LIMIT_WINDOW_MINUTES = 10;
const RATE_LIMIT_MAX_SUBMISSIONS = 5;

function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return request.headers.get("x-real-ip") ?? "unknown";
}

export async function POST(request: Request) {
  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "El sistema no está disponible en este momento." }, { status: 503 });
  }

  const ip = getClientIp(request);
  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60 * 1000).toISOString();
  const { count: recentCount } = await admin
    .from("ticket_submission_log")
    .select("id", { count: "exact", head: true })
    .eq("ip", ip)
    .gte("created_at", windowStart);
  if ((recentCount ?? 0) >= RATE_LIMIT_MAX_SUBMISSIONS) {
    return NextResponse.json({ error: "Has enviado demasiadas incidencias en poco tiempo. Inténtalo de nuevo más tarde." }, { status: 429 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "No se pudo leer el formulario." }, { status: 400 });
  }

  const parsed = ticketSubmissionSchema.safeParse({
    reporterName: formData.get("reporterName"),
    reporterPhone: formData.get("reporterPhone"),
    reporterEmail: formData.get("reporterEmail"),
    department: formData.get("department"),
    title: formData.get("title"),
    category: formData.get("category"),
    description: formData.get("description"),
    startedAt: formData.get("startedAt"),
    blockingLevel: formData.get("blockingLevel"),
    restarted: formData.get("restarted"),
    hasErrorMessage: formData.get("hasErrorMessage"),
    errorMessage: formData.get("errorMessage"),
    honeypot: formData.get("honeypot"),
  });

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Revisa los datos del formulario." }, { status: 400 });
  }
  const data = parsed.data;

  const files = formData.getAll("attachments").filter((entry): entry is File => entry instanceof File && entry.size > 0);
  if (files.length > MAX_ATTACHMENTS) {
    return NextResponse.json({ error: `Puedes adjuntar como máximo ${MAX_ATTACHMENTS} archivos.` }, { status: 400 });
  }
  for (const file of files) {
    if (!ALLOWED_MIME_TYPES[file.type]) {
      return NextResponse.json({ error: "Los archivos deben ser JPG, PNG o PDF." }, { status: 400 });
    }
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: "Cada archivo debe pesar como máximo 5 MB." }, { status: 400 });
    }
  }

  const attachmentPaths: string[] = [];
  for (const file of files) {
    const extension = ALLOWED_MIME_TYPES[file.type];
    const path = `${crypto.randomUUID()}.${extension}`;
    const { error: uploadError } = await admin.storage.from("ticket-attachments").upload(path, file, { contentType: file.type });
    if (uploadError) {
      console.error("Error al subir adjunto de ticket:", uploadError);
      return NextResponse.json({ error: "No se pudo subir uno de los archivos adjuntos." }, { status: 500 });
    }
    attachmentPaths.push(path);
  }

  const priority = priorityFromBlockingLevel(data.blockingLevel);

  const { data: ticket, error: insertError } = await admin
    .from("tickets")
    .insert({
      reporter_name: data.reporterName,
      reporter_phone: data.reporterPhone,
      reporter_email: data.reporterEmail,
      department: data.department,
      title: data.title,
      category: data.category,
      description: data.description,
      started_at: data.startedAt,
      blocking_level: data.blockingLevel,
      restarted: data.restarted,
      has_error_message: data.hasErrorMessage,
      error_message: data.errorMessage,
      priority,
    })
    .select("id, ticket_number")
    .single();

  if (insertError || !ticket) {
    console.error("Error al crear ticket:", insertError);
    return NextResponse.json({ error: "No se pudo registrar la incidencia. Inténtalo de nuevo." }, { status: 500 });
  }

  if (attachmentPaths.length > 0) {
    await admin.from("ticket_attachments").insert(attachmentPaths.map((path) => ({ ticket_id: ticket.id, path })));
  }
  await admin.from("ticket_events").insert({ ticket_id: ticket.id, actor_id: null, event_type: "created", new_value: "new" });
  await admin.from("ticket_submission_log").insert({ ip });

  if (isEmailConfigured()) {
    const adminEmail = process.env.ADMIN_EMAIL;
    if (adminEmail) {
      const origin = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
      const sent = await sendEmail({
        to: adminEmail,
        ...buildTicketCreatedEmail({
          ticketNumber: ticket.ticket_number,
          ticketUrl: `${origin}/tickets/${ticket.id}`,
          title: data.title,
          reporterName: data.reporterName,
          reporterPhone: data.reporterPhone,
          reporterEmail: data.reporterEmail,
          department: data.department,
          category: data.category,
          priority,
          blockingLevel: data.blockingLevel,
          description: data.description,
        }),
      });
      if (!sent) console.error("No se pudo enviar el email de nuevo ticket vía Resend.");
    } else {
      console.error("ADMIN_EMAIL no está configurado; no se envió notificación de nuevo ticket.");
    }
  }

  return NextResponse.json({ ok: true, ticketNumber: ticket.ticket_number });
}
