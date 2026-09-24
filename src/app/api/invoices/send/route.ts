import { NextResponse } from "next/server";
import { z } from "zod";
import { EXPENSES_EDIT_ROLES, hasAnyRole } from "@/lib/constants";
import { buildInvoiceEmail } from "@/lib/email-templates";
import { isEmailConfigured, sendEmail } from "@/lib/email";
import { expenseCategoryLabels, type ExpenseCategory } from "@/lib/expenses";
import { currencyFormatter, formatDate } from "@/lib/format";
import { INVOICE_BUCKET, INVOICE_MAX_BYTES, INVOICE_PATH_PATTERN } from "@/lib/invoices";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { AppRole } from "@/lib/types";

// Manda una factura ya guardada a contabilidad, con el PDF adjunto. Siempre a
// la dirección configurada: nunca a una que venga en la petición, para que
// esto no pueda usarse para enviar documentos a donde sea.
const DEFAULT_RECIPIENT = "alin@suministrointec.com";

const requestSchema = z.object({ id: z.string().uuid() });

/** El nombre unido llega como objeto o como lista de uno, según la consulta. */
function authorName(value: unknown): string | null {
  const one = Array.isArray(value) ? value[0] : value;
  const name = (one as { full_name?: unknown } | null)?.full_name;
  return typeof name === "string" && name.trim() ? name : null;
}

function recipient(): string {
  return process.env.INVOICE_EMAIL_TO?.trim() || DEFAULT_RECIPIENT;
}

/**
 * Outlook manda a "Otros" casi todo lo que viene de un no-reply, así que estos
 * correos pueden salir desde una dirección de verdad. Cualquiera del dominio
 * verificado vale; sin configurar nada se usa el remitente general.
 */
function sender(): string | undefined {
  return process.env.INVOICE_EMAIL_FROM?.trim() || undefined;
}

/**
 * Para que la pantalla pueda decir a dónde va la factura antes de mandarla y,
 * con `?id=`, cuántas veces ha salido ya.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase no está configurado." }, { status: 503 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("roles, is_active").eq("id", user.id).maybeSingle();
  if (!profile?.is_active || !hasAnyRole(profile.roles as AppRole[], EXPENSES_EDIT_ROLES)) {
    return NextResponse.json({ error: "No tienes permiso." }, { status: 403 });
  }
  const id = new URL(request.url).searchParams.get("id");
  let sends: { at: string; by: string | null; to: string }[] = [];
  if (id && z.string().uuid().safeParse(id).success) {
    const { data } = await supabase
      .from("marketing_invoice_sends")
      .select("created_at, sent_to, profiles:sent_by (full_name)")
      .eq("invoice_id", id)
      .order("created_at", { ascending: false });
    sends = (data ?? []).map((row) => ({
      at: String(row.created_at),
      by: authorName(row.profiles),
      to: String(row.sent_to),
    }));
  }
  return NextResponse.json({ to: recipient(), configured: isEmailConfigured(), sends }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase no está configurado." }, { status: 503 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("full_name, roles, is_active").eq("id", user.id).maybeSingle();
  if (!profile?.is_active || !hasAnyRole(profile.roles as AppRole[], EXPENSES_EDIT_ROLES)) {
    return NextResponse.json({ error: "No tienes permiso para enviar facturas." }, { status: 403 });
  }
  if (!isEmailConfigured()) {
    return NextResponse.json({ error: "El envío de correo no está configurado. Avisa al administrador." }, { status: 503 });
  }

  let id: string;
  try {
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Factura no válida." }, { status: 400 });
    id = parsed.data.id;
  } catch {
    return NextResponse.json({ error: "No se pudo leer la solicitud." }, { status: 400 });
  }

  // Se lee con la sesión de quien envía: si no puede ver la factura, no la manda.
  const { data: invoice } = await supabase
    .from("marketing_invoices")
    .select("supplier, invoice_number, concept, invoice_date, base_amount, vat_amount, total_amount, category, business_unit_id, notes, file_path, file_name")
    .eq("id", id)
    .maybeSingle();
  if (!invoice) return NextResponse.json({ error: "Esa factura no existe." }, { status: 404 });
  if (!invoice.file_path || !INVOICE_PATH_PATTERN.test(String(invoice.file_path))) {
    return NextResponse.json({ error: "Esa factura no tiene PDF que adjuntar." }, { status: 400 });
  }

  const { data: file, error: downloadError } = await supabase.storage.from(INVOICE_BUCKET).download(String(invoice.file_path));
  if (downloadError || !file) return NextResponse.json({ error: "No se encontró el PDF de la factura." }, { status: 404 });
  if (file.size > INVOICE_MAX_BYTES) return NextResponse.json({ error: "El PDF supera los 10 MB y no se puede enviar por correo." }, { status: 413 });

  let unitName: string | null = null;
  if (invoice.business_unit_id) {
    const { data: unit } = await supabase.from("business_units").select("name").eq("id", invoice.business_unit_id).maybeSingle();
    unitName = (unit?.name as string | null) ?? null;
  }

  const fileName = String(invoice.file_name ?? "factura.pdf");
  const { subject, html } = buildInvoiceEmail({
    supplier: String(invoice.supplier),
    invoiceNumber: (invoice.invoice_number as string | null) ?? null,
    concept: (invoice.concept as string | null) ?? null,
    invoiceDate: formatDate(String(invoice.invoice_date)),
    baseAmount: currencyFormatter.format(Number(invoice.base_amount ?? 0)),
    vatAmount: currencyFormatter.format(Number(invoice.vat_amount ?? 0)),
    totalAmount: currencyFormatter.format(Number(invoice.total_amount ?? 0)),
    category: expenseCategoryLabels[invoice.category as ExpenseCategory] ?? String(invoice.category),
    businessUnit: unitName,
    notes: (invoice.notes as string | null) ?? null,
    uploadedBy: (profile.full_name as string | null) ?? user.email ?? "alguien del equipo",
    fileName,
  });

  const to = recipient();
  const sent = await sendEmail({
    to,
    from: sender(),
    subject,
    html,
    attachments: [{ filename: fileName, content: Buffer.from(await file.arrayBuffer()) }],
  });
  if (!sent) return NextResponse.json({ error: "No se pudo enviar el correo. Inténtalo de nuevo." }, { status: 502 });

  // Solo se apunta cuando el correo ha salido de verdad. Si esto fallara, el
  // envío ya está hecho: se avisa por consola y no se echa atrás.
  // Se escribe con el rol de servicio: la tabla no admite escrituras desde el
  // navegador, para que el registro solo lo ponga un envío real.
  const admin = createAdminClient();
  const { error: logError } = admin
    ? await admin.from("marketing_invoice_sends").insert({ invoice_id: id, sent_to: to, sent_by: user.id })
    : { error: new Error("Supabase no está configurado.") };
  if (logError) console.error("No se pudo registrar el envío de la factura:", logError.message);

  return NextResponse.json({ ok: true, to });
}
