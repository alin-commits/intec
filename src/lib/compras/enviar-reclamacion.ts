import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { currencyFormatter } from "@/lib/format";
import { isEmailConfigured, sendEmail } from "@/lib/email";
import { buildReclamacionEmail, type PedidoEnCorreo } from "@/lib/compras/correo-reclamacion";
import { clavePedido, type GrupoAReclamar } from "@/lib/compras/reclamaciones";

/*
  Mandar una reclamación: lo mismo para el botón y para el cron.

  Dos cosas que importan y que no se ven leyendo por encima:

  · El registro se escribe ANTES de mandar, no después. Es esa escritura la que
    reserva el turno: si dos ejecuciones coinciden, la segunda choca con el
    índice único y se va sin mandar nada. Al revés —mandar y luego apuntar— un
    fallo entre medias deja al proveedor con dos correos iguales.
  · Solo sube el escalón lo que salió bien. Si el envío falla, el pedido se
    queda como estaba y mañana se vuelve a intentar el mismo aviso, no el
    siguiente.
*/

/** De aquí salen las reclamaciones, y aquí contestan los proveedores. */
export const REMITENTE_COMPRAS = "Compras Suministros Intec <compras@suministrointec.com>";

export type ResultadoEnvio = {
  ok: boolean;
  /** Por qué no se mandó, cuando no se mandó. */
  motivo?: "sin_correo" | "repetido" | "sin_configurar" | "fallo_envio";
  destinatario: string | null;
  proveedor: string;
  asunto: string;
  html: string;
  pedidos: number;
};

type Fila = { company_code: number; year: number; series: string; number: number };

/**
 * Prepara el correo de un proveedor sin mandarlo: es lo que se enseña en la
 * pantalla antes de dar a enviar, para que nadie mande a ciegas algo que sale
 * de la empresa.
 */
export async function prepararReclamacion(
  admin: SupabaseClient,
  grupo: GrupoAReclamar,
  opciones: { firma?: string | null } = {},
): Promise<{ destinatario: string | null; proveedor: string; empresa: string; asunto: string; html: string }> {
  const [{ data: proveedor }, { data: empresa }, { data: lineas }] = await Promise.all([
    admin.from("sage_suppliers").select("name, email").eq("company_code", grupo.companyCode).eq("code", grupo.supplierCode).maybeSingle(),
    admin.from("sage_companies").select("name").eq("code", grupo.companyCode).maybeSingle(),
    admin.from("sage_purchase_order_lines").select("company_code, year, series, number, description, article_code, expected_on")
      .eq("company_code", grupo.companyCode).gt("pending_units", 0)
      .in("number", grupo.pedidos.map((p) => p.number)),
  ]);

  // Los artículos de cada pedido, solo los que siguen sin fecha: de los demás
  // no hay nada que preguntar.
  const articulosDe = new Map<string, string[]>();
  for (const linea of lineas ?? []) {
    if (linea.expected_on) continue;
    const llave = clavePedido({ companyCode: linea.company_code, year: linea.year, series: linea.series, number: linea.number });
    const lista = articulosDe.get(llave) ?? [];
    lista.push(String(linea.description || linea.article_code || "").trim() || "Artículo sin descripción");
    articulosDe.set(llave, lista);
  }

  const pedidos: PedidoEnCorreo[] = grupo.pedidos.map((pedido) => ({
    referencia: `${pedido.series}${pedido.number}`,
    fecha: pedido.orderDate,
    lineasSinFecha: pedido.lineasSinFecha,
    importe: currencyFormatter.format(Number(pedido.pendingAmount)),
    articulos: articulosDe.get(clavePedido(pedido)) ?? [],
  }));

  const nombreEmpresa = (empresa?.name as string) || "Suministros Intec";
  const { subject, html } = buildReclamacionEmail({
    proveedor: (proveedor?.name as string) || grupo.supplierCode,
    empresa: nombreEmpresa,
    pedidos,
    nivel: grupo.nivel,
    firma: opciones.firma,
  });
  return { destinatario: (proveedor?.email as string) || null, proveedor: (proveedor?.name as string) || grupo.supplierCode, empresa: nombreEmpresa, asunto: subject, html };
}

export async function enviarReclamacion(
  admin: SupabaseClient,
  grupo: GrupoAReclamar,
  opciones: { kind: "auto" | "manual"; sentBy?: string | null; firma?: string | null },
): Promise<ResultadoEnvio> {
  const preparado = await prepararReclamacion(admin, grupo, { firma: opciones.firma });
  const base = { proveedor: preparado.proveedor, asunto: preparado.asunto, html: preparado.html, pedidos: grupo.pedidos.length, destinatario: preparado.destinatario };

  if (!preparado.destinatario) return { ...base, ok: false, motivo: "sin_correo" };
  if (!isEmailConfigured()) return { ...base, ok: false, motivo: "sin_configurar" };

  // Reservar el turno. Si otra ejecución ya lo hizo hoy, el índice único lo
  // rechaza (23505) y aquí no sale nada.
  const { data: registro, error: errorRegistro } = await admin.from("purchase_order_chases").insert({
    company_code: grupo.companyCode,
    supplier_code: grupo.supplierCode,
    level: grupo.nivel,
    kind: opciones.kind,
    sent_by: opciones.sentBy ?? null,
    to_email: preparado.destinatario,
    orders: grupo.pedidos.map((p) => ({ year: p.year, series: p.series, number: p.number })),
    ok: false,
    message: "Enviando…",
  }).select("id").single();

  if (errorRegistro) {
    if (errorRegistro.code === "23505") return { ...base, ok: false, motivo: "repetido" };
    console.error("Compras: no se pudo apuntar la reclamación", errorRegistro);
    return { ...base, ok: false, motivo: "fallo_envio" };
  }

  const enviado = await sendEmail({ to: preparado.destinatario, subject: preparado.asunto, html: preparado.html, from: REMITENTE_COMPRAS });
  await admin.from("purchase_order_chases").update({ ok: enviado, message: enviado ? null : "El envío falló." }).eq("id", registro.id);
  if (!enviado) return { ...base, ok: false, motivo: "fallo_envio" };

  // Solo ahora sube el escalón de cada pedido.
  const ahora = new Date().toISOString();
  const seguimientos = grupo.pedidos.map((pedido) => ({
    company_code: pedido.companyCode, year: pedido.year, series: pedido.series, number: pedido.number,
    state: "reclamado", level: pedido.nivel, last_chased_at: ahora, updated_at: ahora,
  }));
  const { error: errorSeguimiento } = await admin.from("purchase_order_tracking")
    .upsert(seguimientos, { onConflict: "company_code,year,series,number" });
  if (errorSeguimiento) console.error("Compras: la reclamación salió pero no se pudo apuntar el seguimiento", errorSeguimiento);

  return { ...base, ok: true };
}

/** Los pedidos de un envío, como se guardan en el registro. */
export function pedidosDelRegistro(orders: unknown): Fila[] {
  return Array.isArray(orders) ? (orders as Fila[]) : [];
}
