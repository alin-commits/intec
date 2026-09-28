// Lo que manda el agente de Sage (scripts/sage/agente-sage.ps1) y cómo se pasa
// a la base de datos. Aparte de la ruta para poder probarlo sin servidor.
import { z } from "zod";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const amount = z.number().finite();
/** Nulo cuando el documento no tiene comercial asignado; se enseña como «sin asignar». */
const repCode = z.number().int().nullable().default(null);

const salesRow = z.object({
  companyCode: z.number().int(),
  basis: z.enum(["albaran", "factura"]),
  day,
  series: z.string().trim().max(20).default(""),
  repCode,
  documents: z.number().int().nonnegative(),
  netAmount: amount,
  costAmount: amount,
  vatAmount: amount,
  /** Parte de netAmount sin coste grabado. Por defecto cero, para que un agente
      antiguo que todavía no lo manda siga funcionando. */
  netWithoutCost: amount.default(0),
});

/** Ofertas y pedidos comparten forma: totales por día, serie y comercial. */
const documentRow = z.object({
  companyCode: z.number().int(),
  day,
  series: z.string().trim().max(20).default(""),
  repCode,
  documents: z.number().int().nonnegative(),
  netAmount: amount,
});

/*
  Todo lo que no son ventas es opcional. Si una parte no viene, no se toca lo que
  ya hay de ella: así funciona el agente antiguo, que solo manda ventas, y el
  nuevo cuando no puede leer alguna tabla de Sage.
*/
export const sageIngestSchema = z.object({
  coveredFrom: day,
  coveredTo: day,
  /** El día de las fotos (cartera, clientes dormidos), en la hora del servidor de Sage. */
  takenOn: day.optional(),
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
  offers: z.array(documentRow).max(20000).optional(),
  orders: z.array(documentRow).max(20000).optional(),
  families: z.array(z.object({
    companyCode: z.number().int(),
    code: z.string().trim().max(40),
    name: z.string().trim().min(1).max(160),
  })).max(5000).optional(),
  familySales: z.array(z.object({
    companyCode: z.number().int(),
    day,
    familyCode: z.string().trim().max(40).default(""),
    units: amount.default(0),
    netAmount: amount,
    costAmount: amount.default(0),
    /** Parte de netAmount de líneas sin coste grabado, que el margen deja fuera. */
    netWithoutCost: amount.default(0),
  })).max(40000).optional(),
  customers: z.array(z.object({
    companyCode: z.number().int(),
    month: z.string().regex(/^\d{4}-\d{2}-01$/),
    activeCustomers: z.number().int().nonnegative(),
    newCustomers: z.number().int().nonnegative(),
  })).max(2000).optional(),
  backlog: z.array(z.object({
    companyCode: z.number().int(),
    repCode,
    count: z.number().int().nonnegative(),
    amount,
  })).max(2000).optional(),
  dormant: z.array(z.object({
    companyCode: z.number().int(),
    count: z.number().int().nonnegative(),
    amount,
  })).max(50).optional(),
  /** Solo nombres de tablas y columnas de Sage, para poder ampliar la lectura. */
  schema: z.array(z.object({
    table: z.string().trim().min(1).max(128),
    column: z.string().trim().min(1).max(128),
    type: z.string().trim().max(64).default(""),
  })).max(5000).optional(),
  /** Lo que el agente quiere que conste: qué no pudo leer y por qué. */
  notes: z.array(z.string().trim().max(300)).max(30).optional(),
});

export type SageIngestBody = z.infer<typeof sageIngestSchema>;

/** Lo que recibe `sage_ingest`: los nombres de las columnas de la base de datos. */
export function toDatabasePayload(body: SageIngestBody): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    covered_from: body.coveredFrom,
    covered_to: body.coveredTo,
    taken_on: body.takenOn ?? null,
    companies: body.companies.map((company) => ({ code: company.code, name: company.name, is_active: company.isActive })),
    reps: body.reps.map((rep) => ({ company_code: rep.companyCode, code: rep.code, name: rep.name, is_person: rep.isPerson })),
    sales: body.sales.map((row) => ({
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
    })),
  };
  const documents = (rows: z.infer<typeof documentRow>[]) => rows.map((row) => ({
    company_code: row.companyCode,
    day: row.day,
    series: row.series,
    rep_code: row.repCode,
    documents: row.documents,
    net_amount: row.netAmount,
  }));
  // Solo se añade lo que ha venido: una clave ausente le dice a la base de datos
  // que esa parte no se toque.
  if (body.offers) payload.offers = documents(body.offers);
  if (body.orders) payload.orders = documents(body.orders);
  if (body.families) payload.families = body.families.map((family) => ({ company_code: family.companyCode, code: family.code, name: family.name }));
  if (body.familySales) {
    payload.family_sales = body.familySales.map((row) => ({
      company_code: row.companyCode,
      day: row.day,
      family_code: row.familyCode,
      units: row.units,
      net_amount: row.netAmount,
      cost_amount: row.costAmount,
      net_without_cost: row.netWithoutCost,
    }));
  }
  if (body.customers) {
    payload.customers = body.customers.map((row) => ({
      company_code: row.companyCode,
      month: row.month,
      active_customers: row.activeCustomers,
      new_customers: row.newCustomers,
    }));
  }
  if (body.backlog) payload.backlog = body.backlog.map((row) => ({ company_code: row.companyCode, rep_code: row.repCode, count: row.count, amount: row.amount }));
  if (body.dormant) payload.dormant = body.dormant.map((row) => ({ company_code: row.companyCode, count: row.count, amount: row.amount }));
  if (body.schema) payload.schema = body.schema.map((row) => ({ table_name: row.table, column_name: row.column, data_type: row.type }));
  return payload;
}

/** El resumen que queda apuntado en cada lectura, para saber qué llegó. */
export function describeIngest(body: SageIngestBody, counts: Record<string, number>): string {
  const parts = [`${body.companies.length} sociedades, ${body.reps.length} comerciales, ${counts.sales ?? 0} filas de venta`];
  const extra: [string, string][] = [
    ["offers", "de ofertas"],
    ["orders", "de pedidos"],
    ["family_sales", "por familia"],
    ["customers", "de clientes por mes"],
    ["backlog", "de cartera de pedidos"],
    ["dormant", "de clientes dormidos"],
    ["schema", "columnas de estructura"],
  ];
  for (const [key, label] of extra) {
    if (counts[key] !== undefined) parts.push(`${counts[key]} ${label}`);
  }
  const notes = body.notes?.filter(Boolean) ?? [];
  const text = `${parts.join(", ")}.${notes.length ? ` Avisos del agente: ${notes.join(" | ")}` : ""}`;
  return text.slice(0, 2000);
}
