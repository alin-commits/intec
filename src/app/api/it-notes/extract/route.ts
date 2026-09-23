import { NextResponse } from "next/server";
import { z } from "zod";
import { hasAnyRole } from "@/lib/constants";
import { deleteGeminiFile, generateJsonWithGemini, uploadGeminiFile, type GeminiFailure, type GeminiPart } from "@/lib/gemini";
import { TICKET_MANAGER_ROLES } from "@/lib/tickets/constants";
import { cleanNoteContent, IT_NOTE_FILE_MAX_BYTES, IT_NOTE_PDF_PATH_PATTERN, IT_NOTES_BUCKET, itNoteCategoryOrder, parseNoteContent, type NoteExtraction } from "@/lib/tickets/notes";
import { createClient } from "@/lib/supabase/server";
import type { AppRole } from "@/lib/types";

// Reading a long manual with the model can take a while.
export const maxDuration = 60;

const TIME_BUDGET_MS = 52_000;
// Inline PDFs travel base64-encoded inside the request (capped at ~20 MB); bigger ones go through the Files API.
const INLINE_MAX_BYTES = 14 * 1024 * 1024;
const MAX_BLOCKS = 60;
const BLOCK_TYPES = ["heading", "text", "steps", "checklist", "table", "code"] as const;

const requestSchema = z.object({ path: z.string().regex(IT_NOTE_PDF_PATH_PATTERN), fileName: z.string().max(200).optional() });

const PROMPT = `Eres técnico de informática de una empresa y mantienes la base de conocimiento interna del departamento.
A partir de este documento (normalmente un manual de un equipo, programa o servicio) crea UNA nota práctica en español, aunque el documento esté en otro idioma.
La nota debe servir para resolver incidencias y hacer tareas rápido, no para copiar el manual entero:
- title: título corto y claro (máx. 90 caracteres), p. ej. "Impresora Brother HL-L2350: instalación y atascos".
- category: "manual" si resume un manual de producto; "procedure" si es sobre todo un procedimiento paso a paso; "solution" si trata de resolver un problema concreto; "reference" si son sobre todo datos de consulta (especificaciones, códigos, tablas); "other" en otro caso.
- blocks: el contenido, en orden, usando estos tipos:
  - "heading" (text): título de sección, p. ej. "Para qué sirve", "Instalación", "Solución de problemas".
  - "text" (text): párrafos breves; empieza con un resumen de 2-3 frases de qué es y para qué sirve.
  - "steps" (items): pasos numerados, uno por elemento, en imperativo ("Pulsa…", "Abre…").
  - "checklist" (items): comprobaciones o requisitos previos.
  - "table" (rows): datos tabulares; la primera fila es la cabecera. Úsala para códigos de error y su solución, luces/indicadores, especificaciones, puertos, credenciales por defecto de fábrica, etc.
  - "code" (text): comandos, rutas, direcciones o configuraciones exactas que haya que escribir.
Prioriza: instalación/configuración, uso habitual, mantenimiento y, sobre todo, solución de problemas y códigos de error.
Usa solo información del documento, sin inventar. Máximo ${MAX_BLOCKS} bloques. Deja vacíos (null) los campos que no correspondan al tipo de bloque.`;

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    title: { type: "STRING" },
    category: { type: "STRING", enum: [...itNoteCategoryOrder] },
    blocks: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          type: { type: "STRING", enum: [...BLOCK_TYPES] },
          text: { type: "STRING", nullable: true },
          items: { type: "ARRAY", items: { type: "STRING" }, nullable: true },
          rows: { type: "ARRAY", items: { type: "ARRAY", items: { type: "STRING" } }, nullable: true },
        },
        required: ["type"],
      },
    },
  },
  required: ["title", "category", "blocks"],
};

const extractionSchema = z.object({
  title: z.string().trim().transform((value) => value.slice(0, 200)),
  category: z.enum(itNoteCategoryOrder as [string, ...string[]]).catch("manual"),
  blocks: z.array(z.object({
    type: z.enum(BLOCK_TYPES),
    text: z.string().nullish(),
    items: z.array(z.string()).nullish(),
    rows: z.array(z.array(z.string())).nullish(),
  })).catch([]),
});

const FAILURE_MESSAGES: Record<GeminiFailure, string> = {
  auth: "La clave de la IA no es válida o no tiene permiso. Avisa al administrador.",
  unreadable: "La IA no pudo leer el manual. Prueba con otro PDF o rellena la nota a mano.",
  rate_limit: "Se ha alcanzado el límite de la IA. Prueba en un minuto.",
  busy: "La IA de Google está saturada ahora mismo. Prueba de nuevo en unos minutos.",
};

export async function POST(request: Request) {
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase no está configurado." }, { status: 503 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("roles, is_active").eq("id", user.id).maybeSingle();
  if (!profile?.is_active || !hasAnyRole(profile.roles as AppRole[], TICKET_MANAGER_ROLES)) {
    return NextResponse.json({ error: "No tienes permiso para crear notas." }, { status: 403 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "La lectura automática no está configurada (falta la clave de la IA)." }, { status: 503 });

  let path: string;
  let fileName: string;
  try {
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Archivo no válido. Solo se pueden leer PDFs." }, { status: 400 });
    path = parsed.data.path;
    fileName = parsed.data.fileName || "manual.pdf";
  } catch {
    return NextResponse.json({ error: "No se pudo leer la solicitud." }, { status: 400 });
  }

  const deadline = Date.now() + TIME_BUDGET_MS;

  // Downloaded with the user's own session, so storage RLS still applies.
  const { data: file, error: downloadError } = await supabase.storage.from(IT_NOTES_BUCKET).download(path);
  if (downloadError || !file) return NextResponse.json({ error: "No se encontró el PDF subido." }, { status: 404 });
  if (file.size > IT_NOTE_FILE_MAX_BYTES) return NextResponse.json({ error: "El PDF supera los 25 MB." }, { status: 413 });
  const pdf = Buffer.from(await file.arrayBuffer());
  if (pdf.subarray(0, 5).toString("latin1") !== "%PDF-") return NextResponse.json({ error: "El archivo no es un PDF válido." }, { status: 400 });

  let uploaded: { uri: string; name: string } | null = null;
  let pdfPart: GeminiPart;
  if (pdf.length <= INLINE_MAX_BYTES) {
    pdfPart = { inline_data: { mime_type: "application/pdf", data: pdf.toString("base64") } };
  } else {
    uploaded = await uploadGeminiFile(apiKey, pdf, "application/pdf", fileName, deadline);
    if (!uploaded) return NextResponse.json({ error: "No se pudo enviar el PDF a la IA. Prueba de nuevo en unos minutos." }, { status: 502 });
    pdfPart = { file_data: { mime_type: "application/pdf", file_uri: uploaded.uri } };
  }

  try {
    const result = await generateJsonWithGemini({
      apiKey,
      parts: [pdfPart, { text: PROMPT }],
      responseSchema: RESPONSE_SCHEMA,
      timeBudgetMs: Math.max(0, deadline - Date.now()),
      label: "un manual",
    });
    if (!result.ok) return NextResponse.json({ error: FAILURE_MESSAGES[result.failure] }, { status: 502 });

    const parsed = extractionSchema.safeParse(result.raw);
    if (!parsed.success) return NextResponse.json({ error: "La IA devolvió datos incompletos. Prueba de nuevo." }, { status: 502 });

    // Reuse the same parser as stored notes so the editor gets well-formed blocks.
    const blocks = cleanNoteContent(parseNoteContent(parsed.data.blocks.slice(0, MAX_BLOCKS).map((block) => {
      if (block.type === "checklist") return { type: block.type, items: (block.items ?? []).map((text) => ({ text, done: false })) };
      if (block.type === "steps") return { type: block.type, items: block.items ?? [] };
      if (block.type === "table") return { type: block.type, rows: block.rows ?? [] };
      return { type: block.type, text: block.text ?? "" };
    })));
    if (blocks.length === 0) return NextResponse.json({ error: "La IA no encontró contenido útil en el PDF." }, { status: 502 });

    const extraction: NoteExtraction = {
      title: parsed.data.title,
      category: parsed.data.category as NoteExtraction["category"],
      blocks,
    };
    return NextResponse.json({ extraction });
  } finally {
    if (uploaded) await deleteGeminiFile(apiKey, uploaded.name);
  }
}
