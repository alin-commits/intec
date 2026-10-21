import "server-only";

/*
  Mandar desde el buzón de compras con Microsoft Graph.

  Por qué no basta con Resend, que ya funciona: Resend manda *en nombre de*
  compras@, pero el correo no pasa por el buzón. No aparece en Enviados, así
  que quien lleva compras recibe respuestas a correos que no recuerda haber
  escrito, y el proveedor recibe un mensaje suelto sin el pedido debajo.

  Con Graph el correo lo manda el buzón: queda en Enviados, se responde sobre
  el hilo del correo con el que Sage mandó el pedido —el proveedor ve de qué le
  hablas— y su respuesta vuelve al mismo hilo.

  Hace falta un registro de aplicación en Entra ID con permisos de aplicación
  Mail.ReadWrite y Mail.Send, limitado a este buzón con una
  ApplicationAccessPolicy. Sin esas variables configuradas esto no existe y
  quien llama se vuelve a Resend.
*/

import { elegirCorreoDelPedido, meterEnElCuerpo, type CorreoDelPedido } from "@/lib/compras/graph-hilo";

const GRAPH = "https://graph.microsoft.com/v1.0";

export function graphConfigurado(): boolean {
  return Boolean(process.env.MS_TENANT_ID && process.env.MS_CLIENT_ID && process.env.MS_CLIENT_SECRET && process.env.MS_COMPRAS_MAILBOX);
}

/** El buzón desde el que se escribe. */
export function buzonDeCompras(): string {
  return process.env.MS_COMPRAS_MAILBOX ?? "";
}

/*
  El asunto con el que Sage manda el pedido, que es por donde se encuentra el
  hilo. Cambia por sociedad ("Pedidos de compra Intec 7275"), así que se
  configura fuera: MS_COMPRAS_ASUNTOS con un patrón por código de empresa, o
  MS_COMPRAS_ASUNTO_PEDIDO para todas. No va escrito aquí porque el repositorio
  es público y esto es cómo se ven vuestros correos por dentro.

  Si el patrón no acierta no se rompe nada: no se encuentra el hilo y sale un
  correo nuevo, que es justo lo que hacíamos antes de todo esto.
*/
export function asuntoDelPedido(companyCode: number, numero: number): string | null {
  const rellenar = (patron: string) => patron.replace("{numero}", String(numero));
  const porEmpresa = process.env.MS_COMPRAS_ASUNTOS;
  if (porEmpresa) {
    try {
      const mapa = JSON.parse(porEmpresa) as Record<string, string>;
      const suyo = mapa[String(companyCode)];
      if (suyo) return rellenar(suyo);
    } catch {
      console.error("Graph: MS_COMPRAS_ASUNTOS no es un JSON válido.");
    }
  }
  const general = process.env.MS_COMPRAS_ASUNTO_PEDIDO;
  return general ? rellenar(general) : null;
}

/**
 * A dónde van de verdad los correos.
 *
 * Con MS_COMPRAS_REDIRIGIR_A puesto, todo acaba en esa dirección en vez de en
 * el proveedor. Es para los primeros días: se ve lo que saldría, llegando de
 * verdad a un buzón, sin que lo reciba nadie de fuera.
 */
export function redirigidoA(): string | null {
  return process.env.MS_COMPRAS_REDIRIGIR_A?.trim() || null;
}

// El token dura una hora larga; se guarda para no pedir uno por correo.
let tokenGuardado: { valor: string; caduca: number } | null = null;

export async function tokenDeGraph(): Promise<string | null> {
  if (!graphConfigurado()) return null;
  if (tokenGuardado && tokenGuardado.caduca > Date.now() + 60_000) return tokenGuardado.valor;

  const respuesta = await fetch(`https://login.microsoftonline.com/${process.env.MS_TENANT_ID}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.MS_CLIENT_ID!,
      client_secret: process.env.MS_CLIENT_SECRET!,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });
  if (!respuesta.ok) {
    // El cuerpo trae el código de Microsoft (AADSTS…), que es lo único que
    // distingue "falta el consentimiento" de "el secreto ha caducado".
    console.error("Graph: no se pudo obtener el token", (await respuesta.text()).slice(0, 400));
    tokenGuardado = null;
    return null;
  }
  const datos = (await respuesta.json()) as { access_token: string; expires_in: number };
  tokenGuardado = { valor: datos.access_token, caduca: Date.now() + datos.expires_in * 1000 };
  return datos.access_token;
}

/** Para las pruebas: olvidar el token guardado. */
export function olvidarToken() {
  tokenGuardado = null;
}

async function pedir(ruta: string, opciones: RequestInit = {}): Promise<Response | null> {
  const token = await tokenDeGraph();
  if (!token) return null;
  return fetch(`${GRAPH}${ruta}`, {
    ...opciones,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(opciones.headers ?? {}) },
  });
}

export type { CorreoDelPedido };
export { elegirCorreoDelPedido, meterEnElCuerpo };

/** Busca en todo el buzón el correo con el que se mandó ese pedido. */
export async function buscarCorreoDelPedido(companyCode: number, numero: number): Promise<CorreoDelPedido | null> {
  const asunto = asuntoDelPedido(companyCode, numero);
  if (!asunto) return null;
  const buzon = encodeURIComponent(buzonDeCompras());
  const busqueda = encodeURIComponent(`"subject:${asunto}"`);
  const respuesta = await pedir(`/users/${buzon}/messages?$search=${busqueda}&$select=id,subject,toRecipients,sentDateTime&$top=25`);
  if (!respuesta) return null;
  if (!respuesta.ok) {
    console.error("Graph: no se pudo buscar el correo del pedido", (await respuesta.text()).slice(0, 300));
    return null;
  }
  const datos = (await respuesta.json()) as { value?: { id: string; subject: string; sentDateTime: string; toRecipients?: { emailAddress?: { address?: string } }[] }[] };
  const correos: CorreoDelPedido[] = (datos.value ?? []).map((mensaje) => ({
    id: mensaje.id,
    subject: mensaje.subject ?? "",
    sentDateTime: mensaje.sentDateTime ?? "",
    destinatarios: (mensaje.toRecipients ?? []).map((quien) => quien.emailAddress?.address ?? "").filter(Boolean),
  }));
  return elegirCorreoDelPedido(correos, asunto);
}

export type ResultadoGraph = { ok: boolean; enHilo: boolean; destinatario: string | null; error?: string };

/**
 * Responde sobre el hilo del pedido.
 *
 * Tres pasos y no uno, porque el borrador que crea Graph viene mal para esto:
 * responde al remitente, que somos nosotros —el pedido salió de este buzón—,
 * así que el destinatario hay que rehacerlo con el del correo original.
 */
export async function responderEnHilo(correo: CorreoDelPedido, html: string, destinatario: string): Promise<ResultadoGraph> {
  const buzon = encodeURIComponent(buzonDeCompras());

  const creado = await pedir(`/users/${buzon}/messages/${correo.id}/createReply`, { method: "POST" });
  if (!creado) return { ok: false, enHilo: false, destinatario, error: "Sin acceso a Graph." };
  if (!creado.ok) return { ok: false, enHilo: false, destinatario, error: (await creado.text()).slice(0, 300) };
  const borrador = (await creado.json()) as { id: string; body?: { content?: string } };

  const actualizado = await pedir(`/users/${buzon}/messages/${borrador.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      toRecipients: [{ emailAddress: { address: destinatario } }],
      body: { contentType: "HTML", content: meterEnElCuerpo(borrador.body?.content ?? "", html) },
    }),
  });
  if (!actualizado) return { ok: false, enHilo: false, destinatario, error: "Sin acceso a Graph." };
  if (!actualizado.ok) return { ok: false, enHilo: false, destinatario, error: (await actualizado.text()).slice(0, 300) };

  const enviado = await pedir(`/users/${buzon}/messages/${borrador.id}/send`, { method: "POST" });
  if (!enviado) return { ok: false, enHilo: false, destinatario, error: "Sin acceso a Graph." };
  if (!enviado.ok) return { ok: false, enHilo: false, destinatario, error: (await enviado.text()).slice(0, 300) };
  return { ok: true, enHilo: true, destinatario };
}

/** Un correo nuevo desde el buzón, cuando no se encuentra el del pedido. */
export async function mandarDesdeElBuzon(destinatario: string, asunto: string, html: string): Promise<ResultadoGraph> {
  const buzon = encodeURIComponent(buzonDeCompras());
  const respuesta = await pedir(`/users/${buzon}/sendMail`, {
    method: "POST",
    body: JSON.stringify({
      message: {
        subject: asunto,
        body: { contentType: "HTML", content: html },
        toRecipients: [{ emailAddress: { address: destinatario } }],
      },
      saveToSentItems: true,
    }),
  });
  if (!respuesta) return { ok: false, enHilo: false, destinatario, error: "Sin acceso a Graph." };
  if (!respuesta.ok) return { ok: false, enHilo: false, destinatario, error: (await respuesta.text()).slice(0, 300) };
  return { ok: true, enHilo: false, destinatario };
}
