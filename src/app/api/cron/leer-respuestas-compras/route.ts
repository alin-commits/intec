import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPages } from "@/lib/supabase/fetch-all";
import { todayKey } from "@/lib/dates";
import { buzonDeCompras, cuerpoDelCorreo, graphConfigurado, leerEntrada } from "@/lib/compras/graph";
import { pareceAutomatico, reconocerRespuestas, type CorreoRecibido, type ReclamacionMandada } from "@/lib/compras/respuestas";
import { leerRespuesta } from "@/lib/compras/leer-respuesta";

/*
  Lee lo que contestan los proveedores.

  Corre varias veces al día en horario de oficina. Lo que hace, por orden:

   1. Pide los correos recientes de la bandeja de compras.
   2. Se queda con los que llegan en un hilo donde nosotros reclamamos —eso es
      exacto, no una suposición— y que no hemos leído ya.
   3. Pide el cuerpo SOLO de esos. En ese buzón hay casi cuarenta mil correos
      de todo tipo y los demás no se tocan.
   4. Descarta los contestadores automáticos: un "estoy fuera de la oficina"
      llega en el hilo y, si contara, dejaríamos de reclamar a alguien que no
      ha contestado nada.
   5. Le pide a Claude que entienda el resto: qué han dicho, y si dan fecha.
   6. Marca el pedido como contestado y deja la fecha COMO PROPUESTA. No es la
      fecha del pedido hasta que una persona la acepta en la pantalla.

  Si la IA no está disponible, los pasos 1 a 4 funcionan igual: el pedido se
  marca como contestado y se queda sin resumen. Que falle Anthropic no puede
  dejar una respuesta sin detectar.
*/

/** Cuántos días atrás se mira. Con dos basta corriendo varias veces al día; tres da margen a un festivo. */
const DIAS_ATRAS = 3;
/** Tope de correos a los que se les pide el cuerpo, por si un día llega una avalancha. */
const MAXIMO_A_LEER = 40;

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  if (!graphConfigurado()) return NextResponse.json({ skipped: "El buzón de compras no está configurado." });
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "Falta SUPABASE_SERVICE_ROLE_KEY." }, { status: 503 });

  const desde = new Date(Date.now() - DIAS_ATRAS * 86400000).toISOString();

  const [correosDelBuzon, { data: reclamaciones, error: errorReclamaciones }, { data: leidos }] = await Promise.all([
    leerEntrada(desde),
    fetchAllPages<{ conversation_id: string | null; company_code: number; supplier_code: string; sent_at: string; orders: unknown }>(
      (from, to) => admin.from("purchase_order_chases")
        .select("conversation_id, company_code, supplier_code, sent_at, orders")
        .not("conversation_id", "is", null).eq("ok", true).order("sent_at").range(from, to)),
    admin.from("purchase_order_replies").select("message_id").gte("received_at", desde),
  ]);
  if (errorReclamaciones) {
    console.error("Cron leer-respuestas: no se pudieron leer las reclamaciones", errorReclamaciones);
    return NextResponse.json({ error: "No se pudieron leer las reclamaciones." }, { status: 500 });
  }

  const mandadas: ReclamacionMandada[] = reclamaciones.map((fila) => ({
    conversationId: fila.conversation_id,
    companyCode: fila.company_code,
    supplierCode: fila.supplier_code,
    sentAt: fila.sent_at,
    orders: Array.isArray(fila.orders) ? (fila.orders as ReclamacionMandada["orders"]) : [],
  }));

  const reconocidas = reconocerRespuestas({
    correos: correosDelBuzon as CorreoRecibido[],
    reclamaciones: mandadas,
    yaLeidos: new Set((leidos ?? []).map((fila) => fila.message_id as string)),
    buzonPropio: buzonDeCompras(),
  });

  const resumen = { mirados: correosDelBuzon.length, reconocidos: reconocidas.length, leidos: 0, automaticos: 0, conFecha: 0, sinIa: 0 };
  const hoy = todayKey();

  for (const respuesta of reconocidas.slice(0, MAXIMO_A_LEER)) {
    const contenido = await cuerpoDelCorreo(respuesta.correo.id);
    if (!contenido) continue;

    const automatico = pareceAutomatico(respuesta.correo, contenido.cabeceras);
    const lectura = automatico ? null : await leerRespuesta({
      proveedor: respuesta.supplierCode,
      pedidos: respuesta.orders.map((pedido) => `${pedido.series}${pedido.number}`),
      asunto: respuesta.correo.subject,
      cuerpo: contenido.texto,
      hoy,
    });
    if (!automatico && !lectura) resumen.sinIa++;

    // Lo que diga la IA sobre si es automático se suma a lo que dicen las
    // cabeceras: ella ve el texto, que a veces es lo único que lo delata.
    const esAutomatico = automatico || lectura?.esAutomatico === true;
    // Una fecha solo se propone si está dicha sin condiciones.
    const propuesta = lectura?.fechaSegura ? lectura.fechaPrevista : null;

    await admin.from("purchase_order_replies").upsert({
      message_id: respuesta.correo.id,
      conversation_id: respuesta.correo.conversationId,
      company_code: respuesta.companyCode,
      supplier_code: respuesta.supplierCode,
      from_email: respuesta.correo.from,
      subject: respuesta.correo.subject.slice(0, 300),
      received_at: respuesta.correo.receivedAt,
      from_person: !esAutomatico,
      summary: lectura?.resumen?.slice(0, 500) ?? null,
      proposed_on: propuesta,
      proposed_sure: Boolean(lectura?.fechaSegura),
      orders: respuesta.orders,
    }, { onConflict: "message_id" });

    resumen.leidos++;
    if (esAutomatico) { resumen.automaticos++; continue; }
    if (propuesta) resumen.conFecha++;

    // El pedido pasa a contestado. La fecha se queda en propuesta: confirmed_on
    // no se toca aquí, lo hace una persona desde la pantalla.
    const ahora = new Date().toISOString();
    const { error } = await admin.from("purchase_order_tracking").upsert(
      respuesta.orders.map((pedido) => ({
        company_code: respuesta.companyCode, year: pedido.year, series: pedido.series, number: pedido.number,
        state: "contestado", replied_at: respuesta.correo.receivedAt,
        proposed_on: propuesta, proposed_sure: Boolean(lectura?.fechaSegura),
        reply_summary: lectura?.resumen?.slice(0, 500) ?? null,
        updated_at: ahora,
      })),
      { onConflict: "company_code,year,series,number" },
    );
    if (error) console.error("Cron leer-respuestas: no se pudo apuntar el seguimiento", error);
  }

  return NextResponse.json(resumen);
}
