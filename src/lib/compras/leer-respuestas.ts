import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllPages } from "@/lib/supabase/fetch-all";
import { dateKeyInMadrid } from "@/lib/dates";
import { adjuntosPdf, buzonDeCompras, cuerpoDelCorreo, graphConfigurado, leerHilos } from "@/lib/compras/graph";
import {
  hilosALeer, pareceAutomatico, pedidosQueCambia, reconocerRespuestas,
  type CorreoRecibido, type ReclamacionMandada, type SeguimientoApuntado,
} from "@/lib/compras/respuestas";
import { iaConfigurada, leerRespuesta } from "@/lib/compras/leer-respuesta";
import { loQueDiceDeCadaPedido, sinFechasPasadas } from "@/lib/compras/leer-respuesta-prompt";

/*
  Lee lo que contestan los proveedores.

  Lo llaman dos sitios: el cron de por la mañana y el botón de la pantalla de
  Compras. El botón existe porque el plan gratuito de Vercel solo deja una
  pasada al día: con una sola, una respuesta de las once de la mañana no se
  vería hasta el día siguiente, así que quien lleva compras puede pedirla.

  Lo que hace, por orden:

   1. Pide los correos de las conversaciones en las que hemos reclamado en
      las últimas semanas, en todas las carpetas del buzón.
   2. Se queda con los que no son nuestros, llegaron después de reclamar y no
      hemos leído ya. Va por la conversación, que es exacto, no una suposición.
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

/**
 * Las reclamaciones de cuántos días atrás se siguen mirando. Un proveedor puede
 * tardar en contestar, o mandar la fecha en un segundo correo días después.
 */
const DIAS_DE_HILOS = 45;
/** Tope de correos a los que se les pide el cuerpo, por si un día llega una avalancha. */
const MAXIMO_A_LEER = 40;

export type ResumenDeLectura = {
  mirados: number;
  reconocidos: number;
  leidos: number;
  respuestas: number;
  expediciones: number;
  automaticos: number;
  /** Respuestas de las que sale una fecha dicha en firme. */
  conFecha: number;
  conPdf: number;
  sinIa: number;
};

export type FalloDeLectura = { error: string; estado: number };
export type SaltoDeLectura = { skipped: string };

export function buzonListo(): boolean {
  return graphConfigurado();
}

/** Lee la bandeja y apunta lo que han contestado. Devuelve el recuento. */
export async function leerRespuestasDeProveedores(
  admin: SupabaseClient,
): Promise<ResumenDeLectura | FalloDeLectura> {
  const desde = new Date(Date.now() - DIAS_DE_HILOS * 86400000).toISOString();

  const [{ data: reclamaciones, error: errorReclamaciones }, { data: leidos }] = await Promise.all([
    fetchAllPages<{ conversation_id: string | null; company_code: number; supplier_code: string; sent_at: string; orders: unknown }>(
      (from, to) => admin.from("purchase_order_chases")
        .select("conversation_id, company_code, supplier_code, sent_at, orders")
        .not("conversation_id", "is", null).eq("ok", true).order("sent_at").range(from, to)),
    fetchAllPages<{ message_id: string }>(
      (from, to) => admin.from("purchase_order_replies").select("message_id").gte("received_at", desde).order("message_id").range(from, to)),
  ]);
  if (errorReclamaciones) {
    console.error("Leer respuestas: no se pudieron leer las reclamaciones", errorReclamaciones);
    return { error: "No se pudieron leer las reclamaciones.", estado: 500 };
  }

  const mandadas: ReclamacionMandada[] = (reclamaciones ?? []).map((fila) => ({
    conversationId: fila.conversation_id,
    companyCode: fila.company_code,
    supplierCode: fila.supplier_code,
    sentAt: fila.sent_at,
    orders: Array.isArray(fila.orders) ? (fila.orders as ReclamacionMandada["orders"]) : [],
  }));
  const correosDelBuzon = await leerHilos(hilosALeer(mandadas, desde), desde);

  const reconocidas = reconocerRespuestas({
    correos: correosDelBuzon as CorreoRecibido[],
    reclamaciones: mandadas,
    yaLeidos: new Set((leidos ?? []).map((fila) => fila.message_id as string)),
    buzonPropio: buzonDeCompras(),
  });

  const resumen: ResumenDeLectura = {
    mirados: correosDelBuzon.length, reconocidos: reconocidas.length, leidos: 0,
    respuestas: 0, expediciones: 0, automaticos: 0, conFecha: 0, conPdf: 0, sinIa: 0,
  };

  for (const respuesta of reconocidas.slice(0, MAXIMO_A_LEER)) {
    const contenido = await cuerpoDelCorreo(respuesta.correo.id);
    if (!contenido) continue;

    const automatico = pareceAutomatico(respuesta.correo, contenido.cabeceras);
    /*
      Los PDF solo se bajan de lo que ya sabemos que es una respuesta nuestra.
      De 26 respuestas medidas, 9 traían la fecha en el adjunto y nada en el
      texto; pero en ese buzón hay miles de facturas y publicidad, y bajar
      adjuntos de todo sería tan caro como inútil.
    */
    const adjuntos = automatico ? [] : await adjuntosPdf(respuesta.correo.id);
    /*
      El día en que escribieron, no el de hoy. «Se envía hoy», «mañana» o «el
      lunes» se cuentan desde ahí: un correo del lunes leído el jueves daba el
      jueves como fecha de envío.
    */
    const diaDelCorreo = dateKeyInMadrid(respuesta.correo.receivedAt);
    const leida = automatico ? null : await leerRespuesta({
      proveedor: respuesta.supplierCode,
      pedidos: respuesta.orders.map((pedido) => `${pedido.series}${pedido.number}`),
      asunto: respuesta.correo.subject,
      cuerpo: contenido.texto,
      adjuntos,
      hoy: diaDelCorreo,
    });
    const lectura = sinFechasPasadas(leida, diaDelCorreo);
    // Si la IA estaba disponible y aun así no contestó —se satura y devuelve
    // 503—, este correo no se da por leído: el pedido se marca igual como
    // contestado, pero la próxima pasada vuelve a intentar el resumen. Si se
    // apuntara ahora, se quedaría sin resumen para siempre.
    if (adjuntos.length > 0) resumen.conPdf++;
    const iaFallo = !automatico && !lectura && iaConfigurada();
    if (iaFallo) resumen.sinIa++;

    // Las cabeceras mandan sobre la IA para los contestadores: un "fuera de la
    // oficina" lo delata la cabecera aunque el texto parezca una respuesta.
    const tipo = automatico ? "automatico" : (lectura?.tipo ?? "respuesta");
    /*
      La fecha que ha dicho el proveedor, y aparte si la dijo en firme.

      Antes, la dicha con condiciones —"sobre el 15", "si nos llega el
      material"— se tiraba, y con ella se perdía lo único que avisa de que la
      fecha que hay en Sage ya no vale. Se guarda siempre, con proposed_sure
      diciendo de qué clase es; quien la mira decide, que para eso está.
    */
    const propuesta = lectura?.fechaPrevista ?? null;
    const enFirme = Boolean(lectura?.fechaSegura && lectura.fechaPrevista);
    // Y pedido a pedido, que es lo que se apunta en cada uno.
    const porPedido = loQueDiceDeCadaPedido(respuesta.orders, lectura);

    if (!iaFallo) await admin.from("purchase_order_replies").upsert({
      message_id: respuesta.correo.id,
      conversation_id: respuesta.correo.conversationId,
      company_code: respuesta.companyCode,
      supplier_code: respuesta.supplierCode,
      from_email: respuesta.correo.from,
      subject: respuesta.correo.subject.slice(0, 300),
      received_at: respuesta.correo.receivedAt,
      kind: tipo,
      from_person: tipo === "respuesta",
      summary: lectura?.resumen?.slice(0, 500) ?? null,
      proposed_on: propuesta,
      proposed_sure: enFirme,
      // Con lo que dijo de cada uno, para enseñarlo en la ficha de cada pedido.
      orders: porPedido.map((pedido) => ({
        year: pedido.year, series: pedido.series, number: pedido.number,
        answered: pedido.contesta, proposed_on: pedido.fechaPrevista, proposed_sure: pedido.fechaSegura, summary: pedido.resumen,
      })),
    }, { onConflict: "message_id" });

    if (!iaFallo) resumen.leidos++;

    // Lo que ya hay apuntado de esos pedidos: un correo viejo no pisa una
    // confirmación ni una respuesta posteriores.
    const { data: apuntado } = await admin.from("purchase_order_tracking")
      .select("year, series, number, confirmed_at, replied_at")
      .eq("company_code", respuesta.companyCode)
      .in("number", respuesta.orders.map((pedido) => pedido.number));
    // Y de los de ese correo, solo aquellos de los que dice algo: si contesta
    // por dos de cuatro, a los otros dos se les sigue reclamando.
    const pedidos = pedidosQueCambia(porPedido, (apuntado ?? []) as SeguimientoApuntado[], respuesta.correo.receivedAt)
      .filter((pedido) => pedido.contesta);

    // Un aviso de expedición se guarda y se enseña, pero no es una respuesta:
    // el proveedor sigue sin decir cuándo llega, así que se le sigue reclamando.
    if (tipo === "expedicion") {
      resumen.expediciones++;
      // Si el aviso trae fecha clara —un preaviso de llegada, por ejemplo—, esa
      // es la mejor fecha que va a dar este pedido: se propone igual que la de
      // una respuesta escrita. Sigue haciendo falta que alguien la acepte.
      await apuntarSeguimiento(admin, pedidos.map((pedido) => ({
        company_code: respuesta.companyCode, year: pedido.year, series: pedido.series, number: pedido.number,
        shipping_notice: pedido.resumen?.slice(0, 500) ?? "Aviso de expedición",
        shipping_notice_at: respuesta.correo.receivedAt,
        ...(pedido.fechaPrevista ? { proposed_on: pedido.fechaPrevista, proposed_sure: pedido.fechaSegura } : {}),
        updated_at: new Date().toISOString(),
      })));
      if (enFirme) resumen.conFecha++;
      continue;
    }
    if (tipo !== "respuesta") { resumen.automaticos++; continue; }
    resumen.respuestas++;
    if (enFirme) resumen.conFecha++;

    // El pedido pasa a contestado. La fecha se queda en propuesta: confirmed_on
    // no se toca aquí, lo hace una persona desde la pantalla.
    const ahora = new Date().toISOString();
    await apuntarSeguimiento(admin, pedidos.map((pedido) => ({
      company_code: respuesta.companyCode, year: pedido.year, series: pedido.series, number: pedido.number,
      state: "contestado", replied_at: respuesta.correo.receivedAt,
      // Un «gracias» o un «adjunto albarán» después de dar la fecha no la
      // borra: sin fecha nueva se queda la que ya había.
      ...(pedido.fechaPrevista ? { proposed_on: pedido.fechaPrevista, proposed_sure: pedido.fechaSegura } : {}),
      reply_summary: pedido.resumen?.slice(0, 500) ?? null,
      updated_at: ahora,
    })));
  }

  return resumen;
}

/*
  Apunta el seguimiento de los pedidos de un correo, en dos tandas: los que
  traen fecha y los que no.

  En una sola, PostgREST pone a null en todas las filas las columnas que falten
  en alguna. Un pedido sin fecha nueva perdía así la que ya tenía, o la tanda
  entera fallaba —proposed_sure no admite null— y no se apuntaba ninguno: le
  pasó a un correo de cuatro pedidos en cuanto la fecha empezó a ir por pedido.
*/
async function apuntarSeguimiento(admin: SupabaseClient, filas: Record<string, unknown>[]) {
  const tandas = [filas.filter((fila) => "proposed_on" in fila), filas.filter((fila) => !("proposed_on" in fila))];
  for (const tanda of tandas) {
    if (tanda.length === 0) continue;
    const { error } = await admin.from("purchase_order_tracking").upsert(tanda, { onConflict: "company_code,year,series,number" });
    if (error) console.error("Leer respuestas: no se pudo apuntar el seguimiento", error);
  }
}
