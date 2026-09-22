import { NextResponse } from "next/server";
import { z } from "zod";
import { EXPENSES_EDIT_ROLES, hasAnyRole } from "@/lib/constants";
import { INVOICE_BUCKET, INVOICE_MAX_BYTES, INVOICE_PATH_PATTERN, type InvoiceExtraction } from "@/lib/invoices";
import { createClient } from "@/lib/supabase/server";
import type { AppRole } from "@/lib/types";

// Reading a PDF with the model can take a while.
export const maxDuration = 60;

const DEFAULT_MODEL = "gemini-3.8-flash";
const CATEGORIES = ["software", "advertising", "design", "events", "print", "services", "other"] as const;

const requestSchema = z.object({ path: z.string().regex(INVOICE_PATH_PATTERN) });

const PROMPT = `Eres un asistente de contabilidad. Lee esta factura (normalmente española) y devuelve SOLO los datos pedidos.
- supplier: nombre comercial del proveedor que EMITE la factura (no el cliente).
- invoice_number: número de factura tal cual aparece, o null.
- invoice_date: fecha de emisión en formato YYYY-MM-DD, o null si no aparece.
- concept: resumen breve (máx. 80 caracteres) de lo facturado.
- base_amount: base imponible total en euros (sin IVA). vat_amount: cuota total de IVA en euros (0 si no hay). total_amount: total a pagar en euros.
- category: software (apps, hosting, dominios, SaaS), advertising (anuncios, patrocinios), design (diseño, fotografía, vídeo, contenidos), events (ferias, eventos, stands), print (imprenta, merchandising), services (agencias, consultoría, otros servicios profesionales) u other.
Usa punto decimal. Si un dato no está claro, devuelve null en vez de inventarlo.`;

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    supplier: { type: "STRING" },
    invoice_number: { type: "STRING", nullable: true },
    invoice_date: { type: "STRING", nullable: true },
    concept: { type: "STRING", nullable: true },
    base_amount: { type: "NUMBER", nullable: true },
    vat_amount: { type: "NUMBER", nullable: true },
    total_amount: { type: "NUMBER", nullable: true },
    category: { type: "STRING", enum: [...CATEGORIES] },
  },
  required: ["supplier", "invoice_number", "invoice_date", "concept", "base_amount", "vat_amount", "total_amount", "category"],
};

const amount = z.number().finite().nonnegative().nullable().transform((value) => (value === null ? null : Math.round(value * 100) / 100));
const extractionSchema = z.object({
  supplier: z.string().trim().max(160),
  invoice_number: z.string().trim().max(80).nullable(),
  invoice_date: z.string().nullable().transform((value) => (value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) ? value : null)),
  concept: z.string().trim().nullable().transform((value) => (value ? value.slice(0, 200) : null)),
  base_amount: amount,
  vat_amount: amount,
  total_amount: amount,
  category: z.enum(CATEGORIES).catch("other"),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase no está configurado." }, { status: 503 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("roles, is_active").eq("id", user.id).maybeSingle();
  if (!profile?.is_active || !hasAnyRole(profile.roles as AppRole[], EXPENSES_EDIT_ROLES)) {
    return NextResponse.json({ error: "No tienes permiso para subir facturas." }, { status: 403 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "La lectura automática no está configurada. Rellena los datos a mano." }, { status: 503 });

  let path: string;
  try {
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Archivo no válido." }, { status: 400 });
    path = parsed.data.path;
  } catch {
    return NextResponse.json({ error: "No se pudo leer la solicitud." }, { status: 400 });
  }

  // Downloaded with the user's own session, so storage RLS still applies.
  const { data: file, error: downloadError } = await supabase.storage.from(INVOICE_BUCKET).download(path);
  if (downloadError || !file) return NextResponse.json({ error: "No se encontró la factura subida." }, { status: 404 });
  if (file.size > INVOICE_MAX_BYTES) return NextResponse.json({ error: "La factura supera los 10 MB." }, { status: 413 });
  const pdf = Buffer.from(await file.arrayBuffer());
  if (pdf.subarray(0, 5).toString("latin1") !== "%PDF-") return NextResponse.json({ error: "El archivo no es un PDF válido." }, { status: 400 });

  const model = process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
  let raw: unknown;
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ inline_data: { mime_type: "application/pdf", data: pdf.toString("base64") } }, { text: PROMPT }] }],
        generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: RESPONSE_SCHEMA },
      }),
      signal: AbortSignal.timeout(50_000),
    });
    if (!response.ok) {
      console.error("Gemini respondió con error:", response.status, (await response.text()).slice(0, 500));
      const message = response.status === 429 ? "Se ha alcanzado el límite de la IA. Prueba en un minuto o rellénalo a mano." : "La IA no pudo leer la factura. Rellena los datos a mano.";
      return NextResponse.json({ error: message }, { status: 502 });
    }
    const payload = (await response.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
    raw = JSON.parse(text);
  } catch (cause) {
    console.error("No se pudo leer la factura con Gemini:", cause);
    return NextResponse.json({ error: "La IA no pudo leer la factura. Rellena los datos a mano." }, { status: 502 });
  }

  const parsed = extractionSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "La IA devolvió datos incompletos. Rellena los datos a mano." }, { status: 502 });
  const data = parsed.data;
  const extraction: InvoiceExtraction = {
    supplier: data.supplier,
    invoiceNumber: data.invoice_number || null,
    concept: data.concept,
    invoiceDate: data.invoice_date,
    baseAmount: data.base_amount,
    vatAmount: data.vat_amount,
    totalAmount: data.total_amount,
    category: data.category,
  };
  return NextResponse.json({ extraction });
}
