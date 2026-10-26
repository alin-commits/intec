import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllPages } from "@/lib/supabase/fetch-all";
import { todayKey } from "@/lib/dates";
import { adjuntosPdf, buzonDeCompras, cuerpoDelCorreo, graphConfigurado, leerEntrada } from "@/lib/compras/graph";
import { pareceAutomatico, reconocerRespuestas, type CorreoRecibido, type ReclamacionMandada } from "@/lib/compras/respuestas";
import { iaConfigurada, leerRespuesta } from "@/lib/compras/leer-respuesta";

/*
  Lee lo que contestan los proveedores.

  Lo llaman dos sitios: el cron de por la mañana y el botón de la pantalla de
  Compras. El botón existe porque el plan gratuito de Vercel solo deja una
  pasada al día: con una sola, una respuesta de las once de la mañana no se
  vería hasta el día siguiente, así que quien lleva compras puede pedirla.

  Lo que hace, por orden:

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

/** Cuántos días atrás se mira. Tres dan margen a un fin de semana o un festivo. */
const DIAS_ATRAS = 3;
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
  const hoy = todayKey();

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
    const lectura = automatico ? null : await leerRespuesta({
      proveedor: respuesta.supplierCode,
      pedidos: respuesta.orders.map((pedido) => `${pedido.series}${pedido.number}`),
      asunto: respuesta.correo.subject,
      cuerpo: contenido.texto,
      adjuntos,
      hoy,
    });
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
      orders: respuesta.orders,
    }, { onConflict: "message_id" });

    if (!iaFallo) resumen.leidos++;

    // Un aviso de expedición se guarda y se enseña, pero no es una respuesta:
    // el proveedor sigue sin decir cuándo llega, así que se le sigue reclamando.
    if (tipo === "expedicion") {
      resumen.expediciones++;
      // Si el aviso trae fecha clara —un preaviso de llegada, por ejemplo—, esa
      // es la mejor fecha que va a dar este pedido: se propone igual que la de
      // una respuesta escrita. Sigue haciendo falta que alguien la acepte.
      await admin.from("purchase_order_tracking").upsert(
        respuesta.orders.map((pedido) => ({
          company_code: respuesta.companyCode, year: pedido.year, series: pedido.series, number: pedido.number,
          shipping_notice: lectura?.resumen?.slice(0, 500) ?? "Aviso de expedición",
          shipping_notice_at: respuesta.correo.receivedAt,
          ...(propuesta ? { proposed_on: propuesta, proposed_sure: enFirme } : {}),
          updated_at: new Date().toISOString(),
        })),
        { onConflict: "company_code,year,series,number" },
      );
      if (enFirme) resumen.conFecha++;
      continue;
    }
    if (tipo !== "respuesta") { resumen.automaticos++; continue; }
    resumen.respuestas++;
    if (enFirme) resumen.conFecha++;

    // El pedido pasa a contestado. La fecha se queda en propuesta: confirmed_on
    // no se toca aquí, lo hace una persona desde la pantalla.
    const ahora = new Date().toISOString();
    const { error } = await admin.from("purchase_order_tracking").upsert(
      respuesta.orders.map((pedido) => ({
        company_code: respuesta.companyCode, year: pedido.year, series: pedido.series, number: pedido.number,
        state: "contestado", replied_at: respuesta.correo.receivedAt,
        proposed_on: propuesta, proposed_sure: enFirme,
        reply_summary: lectura?.resumen?.slice(0, 500) ?? null,
        updated_at: ahora,
      })),
      { onConflict: "company_code,year,series,number" },
    );
    if (error) console.error("Leer respuestas: no se pudo apuntar el seguimiento", error);
  }

  return resumen;
}
