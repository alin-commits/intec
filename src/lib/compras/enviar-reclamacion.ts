import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { currencyFormatter } from "@/lib/format";
import { isEmailConfigured, sendEmail } from "@/lib/email";
import { buildReclamacionEmail, type PedidoEnCorreo } from "@/lib/compras/correo-reclamacion";
import { clavePedido, type GrupoAReclamar } from "@/lib/compras/reclamaciones";
import { buscarCorreoDelPedido, buzonDeCompras, graphConfigurado, mandarDesdeElBuzon, redirigidoA, responderEnHilo } from "@/lib/compras/graph";

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
  /** Por dónde salió: el buzón de compras o Resend. */
  via?: "graph" | "resend";
  /** Si se respondió sobre el correo con el que Sage mandó el pedido. */
  enHilo?: boolean;
  /** Si el envío fue desviado a un buzón de pruebas en vez de al proveedor. */
  redirigido?: string | null;
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

/**
 * Cómo va a salir este correo, antes de mandarlo.
 *
 * El hilo solo se usa cuando el correo habla de UN pedido: si lleva cinco, no
 * hay un hilo al que responder sin dejar fuera a los otros cuatro, así que va
 * como correo nuevo desde el buzón, que también queda en Enviados.
 */
export async function comoVaASalir(grupo: GrupoAReclamar, correoDeLaFicha: string | null): Promise<{
  via: "graph" | "resend";
  hilo: Awaited<ReturnType<typeof buscarCorreoDelPedido>>;
  destinatario: string | null;
  redirigido: string | null;
  /** De dónde sale, para poder decirlo en la pantalla sin escribirlo a pelo. */
  remitente: string;
}> {
  const redirigido = redirigidoA();
  if (!graphConfigurado()) {
    return { via: "resend", hilo: null, destinatario: redirigido ?? correoDeLaFicha, redirigido, remitente: REMITENTE_COMPRAS };
  }
  const hilo = grupo.pedidos.length === 1
    ? await buscarCorreoDelPedido(grupo.companyCode, grupo.pedidos[0].number)
    : null;
  // La dirección del correo original manda sobre la de la ficha: es a la que
  // Sage mandó el pedido, y la de la ficha suele ser un info@ genérico.
  const destinatario = redirigido ?? hilo?.destinatarios[0] ?? correoDeLaFicha;
  return { via: "graph", hilo, destinatario, redirigido, remitente: buzonDeCompras() };
}

export async function enviarReclamacion(
  admin: SupabaseClient,
  grupo: GrupoAReclamar,
  opciones: { kind: "auto" | "manual"; sentBy?: string | null; firma?: string | null },
): Promise<ResultadoEnvio> {
  const preparado = await prepararReclamacion(admin, grupo, { firma: opciones.firma });
  const salida = await comoVaASalir(grupo, preparado.destinatario);
  const destinatario = salida.destinatario;
  const base = { proveedor: preparado.proveedor, asunto: preparado.asunto, html: preparado.html, pedidos: grupo.pedidos.length, destinatario, via: salida.via };

  if (!destinatario) return { ...base, ok: false, motivo: "sin_correo" };
  // Resend necesita su configuración; por el buzón se manda sin ella.
  if (salida.via === "resend" && !isEmailConfigured()) return { ...base, ok: false, motivo: "sin_configurar" };

  // Reservar el turno. Si otra ejecución ya lo hizo hoy, el índice único lo
  // rechaza (23505) y aquí no sale nada.
  const apunte = {
    company_code: grupo.companyCode,
    supplier_code: grupo.supplierCode,
    level: grupo.nivel,
    kind: opciones.kind,
    sent_by: opciones.sentBy ?? null,
    to_email: destinatario,
    orders: grupo.pedidos.map((p) => ({ year: p.year, series: p.series, number: p.number })),
    ok: false,
    message: "Enviando…",
  };
  // El hilo en el que sale es por donde se reconocerá la respuesta. Si su
  // migración todavía no está, se apunta sin él: se perderá la detección
  // automática de esa respuesta, pero no el envío ni lo que impide repetirlo.
  let { data: registro, error: errorRegistro } = await admin.from("purchase_order_chases")
    .insert({ ...apunte, conversation_id: salida.hilo?.conversationId ?? null }).select("id").single();
  if (errorRegistro?.code === "42703") {
    console.warn("Compras: falta la migración de respuestas; se apunta la reclamación sin el hilo.");
    ({ data: registro, error: errorRegistro } = await admin.from("purchase_order_chases").insert(apunte).select("id").single());
  }

  if (errorRegistro || !registro) {
    if (errorRegistro?.code === "23505") return { ...base, ok: false, motivo: "repetido" };
    console.error("Compras: no se pudo apuntar la reclamación", errorRegistro);
    return { ...base, ok: false, motivo: "fallo_envio" };
  }

  let enviado = false;
  let enHilo = false;
  let detalle: string | null = null;
  if (salida.via === "graph") {
    const resultado = salida.hilo
      ? await responderEnHilo(salida.hilo, preparado.html, destinatario)
      : await mandarDesdeElBuzon(destinatario, preparado.asunto, preparado.html);
    enviado = resultado.ok;
    enHilo = resultado.enHilo;
    detalle = resultado.error ?? null;
  } else {
    enviado = await sendEmail({ to: destinatario, subject: preparado.asunto, html: preparado.html, from: REMITENTE_COMPRAS });
    if (!enviado) detalle = "Resend no aceptó el envío.";
  }
  // El correo ya ha salido: cerrar el registro no puede fallar por una columna
  // que falte. Si la migración del envío por buzón no está, se guarda lo demás,
  // que es lo que impide repetir el envío.
  const cierre = {
    ok: enviado,
    message: enviado
      ? (salida.redirigido ? `Prueba: desviado a ${salida.redirigido}, el proveedor no lo ha recibido.` : null)
      : (detalle ?? "El envío falló.").slice(0, 2000),
  };
  const apuntado = await admin.from("purchase_order_chases")
    .update({ ...cierre, via: salida.via, in_thread: enHilo }).eq("id", registro.id);
  if (apuntado.error?.code === "42703") {
    await admin.from("purchase_order_chases").update(cierre).eq("id", registro.id);
  } else if (apuntado.error) {
    console.error("Compras: la reclamación salió pero no se pudo cerrar su registro", apuntado.error);
  }
  if (!enviado) {
    console.error("Compras: no se pudo mandar la reclamación", detalle);
    return { ...base, ok: false, motivo: "fallo_envio", via: salida.via, enHilo: false };
  }

  /*
    Con el desvío puesto esto es una prueba: el correo ha ido a un buzón
    nuestro y el proveedor no ha recibido nada. Si se diera el pedido por
    reclamado, gastaría su primer aviso sin que nadie se lo haya pedido, y al
    quitar el desvío le llegaría de entrada el segundo —el de "os escribimos de
    nuevo"— como primer contacto. Queda el registro del envío, que es lo que
    hace falta para verlo, pero el escalón no sube.
  */
  if (salida.redirigido) {
    return { ...base, ok: true, via: salida.via, enHilo, destinatario, redirigido: salida.redirigido };
  }

  // Solo ahora sube el escalón de cada pedido.
  const ahora = new Date().toISOString();
  const seguimientos = grupo.pedidos.map((pedido) => ({
    company_code: pedido.companyCode, year: pedido.year, series: pedido.series, number: pedido.number,
    state: "reclamado", level: pedido.nivel, last_chased_at: ahora, updated_at: ahora,
  }));
  const { error: errorSeguimiento } = await admin.from("purchase_order_tracking")
    .upsert(seguimientos, { onConflict: "company_code,year,series,number" });
  if (errorSeguimiento) console.error("Compras: la reclamación salió pero no se pudo apuntar el seguimiento", errorSeguimiento);

  return { ...base, ok: true, via: salida.via, enHilo, destinatario, redirigido: null };
}

/** Los pedidos de un envío, como se guardan en el registro. */
export function pedidosDelRegistro(orders: unknown): Fila[] {
  return Array.isArray(orders) ? (orders as Fila[]) : [];
}
