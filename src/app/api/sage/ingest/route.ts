import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";

/*
  Por aquí entran las cifras de Sage.

  Quien llama no es una persona sino el agente que corre en el servidor de Sage,
  así que no hay sesión: se identifica con una clave compartida. Y no manda
  documentos ni clientes, solo totales por día, que es lo único que necesita el
  panel.

  La escritura va con el rol de servicio a propósito: estas tablas no admiten
  escrituras desde el navegador, ni siquiera de un administrador.
*/

export const maxDuration = 60;

const amount = z.number().finite();
const salesRow = z.object({
  companyCode: z.number().int(),
  basis: z.enum(["albaran", "factura"]),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  series: z.string().trim().max(20).default(""),
  /** Nulo cuando la venta no tiene comercial asignado; se enseña como «sin asignar». */
  repCode: z.number().int().nullable().default(null),
  documents: z.number().int().nonnegative(),
  netAmount: amount,
  costAmount: amount,
  vatAmount: amount,
  /** Parte de netAmount sin coste grabado. Por defecto cero, para que un agente
      antiguo que todavía no lo manda siga funcionando. */
  netWithoutCost: amount.default(0),
});

const bodySchema = z.object({
  coveredFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  coveredTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  companies: z.array(z.object({
    code: z.number().int(),
    name: z.string().trim().min(1).max(160),
    isActive: z.boolean().default(true),
  })).max(50),
  reps: z.array(z.object({
    companyCode: z.number().int(),
    code: z.number().int(),
    name: z.string().trim().min(1).max(160),
    isPerson: z.boolean().default(true),
  })).max(500),
  sales: z.array(salesRow).max(20000),
});

function isAuthorized(request: Request): boolean {
  const secret = process.env.SAGE_INGEST_TOKEN;
  if (!secret) return false;
  const received = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "Supabase no está configurado." }, { status: 503 });

  let body: z.infer<typeof bodySchema>;
  try {
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Datos no válidos.", detail: parsed.error.issues[0]?.message }, { status: 400 });
    }
    body = parsed.data;
  } catch {
    return NextResponse.json({ error: "No se pudo leer la solicitud." }, { status: 400 });
  }

  // El envío queda apuntado antes de escribir nada: si algo falla a mitad, se
  // sabe que hubo un intento y por qué no terminó.
  const { data: run } = await admin
    .from("sage_sync_runs")
    .insert({ covered_from: body.coveredFrom, covered_to: body.coveredTo })
    .select("id")
    .single();
  const runId = run?.id as string | undefined;

  async function fail(message: string, status: number) {
    if (runId) await admin!.from("sage_sync_runs").update({ finished_at: new Date().toISOString(), ok: false, message }).eq("id", runId);
    console.error("Sage:", message);
    return NextResponse.json({ error: message }, { status });
  }

  // Las sociedades y los comerciales primero: las ventas apuntan a ellos.
  if (body.companies.length > 0) {
    const { error } = await admin.from("sage_companies").upsert(
      body.companies.map((company) => ({ code: company.code, name: company.name, is_active: company.isActive, updated_at: new Date().toISOString() })),
      { onConflict: "code" },
    );
    if (error) return fail(`No se pudieron guardar las sociedades: ${error.message}`, 500);
  }

  if (body.reps.length > 0) {
    const { error } = await admin.from("sage_reps").upsert(
      body.reps.map((rep) => ({ company_code: rep.companyCode, code: rep.code, name: rep.name, is_person: rep.isPerson, updated_at: new Date().toISOString() })),
      // `person`, el nombre unificado entre sociedades, se rellena a mano y no
      // se pisa en cada envío.
      { onConflict: "company_code,code", ignoreDuplicates: false },
    );
    if (error) return fail(`No se pudieron guardar los comerciales: ${error.message}`, 500);
  }

  // La ventana que manda el agente se reescribe entera: así una venta corregida
  // en Sage, o un albarán borrado, dejan de contar sin tener que adivinarlo.
  const { error: clearError } = await admin
    .from("sage_sales_daily")
    .delete()
    .gte("day", body.coveredFrom)
    .lte("day", body.coveredTo);
  if (clearError) return fail(`No se pudo limpiar el periodo: ${clearError.message}`, 500);

  let written = 0;
  const CHUNK = 500;
  for (let start = 0; start < body.sales.length; start += CHUNK) {
    const chunk = body.sales.slice(start, start + CHUNK).map((row) => ({
      company_code: row.companyCode,
      basis: row.basis,
      day: row.day,
      series: row.series,
      rep_code: row.repCode,
      documents: row.documents,
      net_amount: row.netAmount,
      cost_amount: row.costAmount,
      vat_amount: row.vatAmount,
      net_without_cost: row.netWithoutCost,
    }));
    const { error } = await admin.from("sage_sales_daily").insert(chunk);
    if (error) return fail(`No se pudieron guardar las ventas: ${error.message}`, 500);
    written += chunk.length;
  }

  if (runId) {
    await admin.from("sage_sync_runs").update({
      finished_at: new Date().toISOString(),
      rows_written: written,
      ok: true,
      message: `${body.companies.length} sociedades, ${body.reps.length} comerciales, ${written} filas de venta.`,
    }).eq("id", runId);
  }

  return NextResponse.json({ ok: true, rowsWritten: written });
}
