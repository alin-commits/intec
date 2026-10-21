import { emailShell, escapeHtml } from "@/lib/email-templates";

/*
  El correo que se le manda al proveedor para que diga cuándo llega.

  Esto sale de la empresa, no del panel: lo lee alguien de otra compañía. Por
  eso no lleva la marca del Hub ni enlaces a él, el remitente es compras@ y se
  contesta respondiendo, que es como se hace hoy.

  Va en el idioma del que lo recibe —un proveedor no tiene por qué entender de
  qué le hablas si le mandas jerga interna—: pedido, fecha, artículos y una
  pregunta clara.
*/

export type PedidoEnCorreo = {
  /** Lo que el proveedor ve en su sistema: la serie y el número. */
  referencia: string;
  fecha: string;
  lineasSinFecha: number;
  importe: string;
  /** Los artículos que siguen sin fecha, para que sepa de qué se habla. */
  articulos: string[];
};

const CELDA = "padding:9px 12px;border-bottom:1px solid #eef0f6;font-size:13px;vertical-align:top;";
const CABECERA = "padding:9px 12px;border-bottom:1px solid #e2e8f0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#64748b;text-align:left;";

/** Más de esto en un correo no lo lee nadie; el resto se resume. */
const MAX_ARTICULOS = 6;

function filaPedido(pedido: PedidoEnCorreo): string {
  const sobran = pedido.articulos.length - MAX_ARTICULOS;
  const articulos = pedido.articulos.slice(0, MAX_ARTICULOS).map((a) => escapeHtml(a));
  if (sobran > 0) articulos.push(`y ${sobran} ${sobran === 1 ? "artículo más" : "artículos más"}`);
  return `<tr>
    <td style="${CELDA}"><strong>${escapeHtml(pedido.referencia)}</strong>${articulos.length ? `<div style="margin-top:4px;color:#64748b;font-size:12px;line-height:1.5;">${articulos.join("<br>")}</div>` : ""}</td>
    <td style="${CELDA}white-space:nowrap;">${escapeHtml(pedido.fecha)}</td>
    <td style="${CELDA}white-space:nowrap;text-align:right;">${escapeHtml(pedido.importe)}</td>
  </tr>`;
}

export function buildReclamacionEmail(input: {
  proveedor: string;
  empresa: string;
  pedidos: PedidoEnCorreo[];
  /** 1 el primer aviso, 2 el segundo. A mano, el que corresponda. */
  nivel: 1 | 2;
  /** Quién lo manda, cuando lo manda una persona desde la pantalla. */
  firma?: string | null;
}): { subject: string; html: string } {
  const varios = input.pedidos.length > 1;
  const referencias = input.pedidos.map((p) => p.referencia).join(", ");

  const asunto = varios
    ? `Confirmación de fecha de entrega — ${input.pedidos.length} pedidos pendientes`
    : `Confirmación de fecha de entrega — pedido ${referencias}`;

  const entrada = input.nivel === 2
    ? `<p style="margin:0 0 14px;">Os escribimos de nuevo: ${varios ? "de estos pedidos" : "de este pedido"} seguimos sin tener fecha de entrega y ${varios ? "están" : "está"} pendiente${varios ? "s" : ""} de recibir.</p>`
    : `<p style="margin:0 0 14px;">${varios ? "Tenemos estos pedidos pendientes de recibir" : "Tenemos este pedido pendiente de recibir"} y todavía no ${varios ? "tenemos" : "tenemos"} fecha de entrega.</p>`;

  const cuerpo = `
    <p style="margin:0 0 14px;">Hola,</p>
    ${entrada}
    <table role="presentation" style="width:100%;border-collapse:collapse;margin:4px 0 18px;">
      <tr>
        <th style="${CABECERA}">Pedido</th>
        <th style="${CABECERA}white-space:nowrap;">Fecha</th>
        <th style="${CABECERA}text-align:right;white-space:nowrap;">Pendiente</th>
      </tr>
      ${input.pedidos.map(filaPedido).join("")}
    </table>
    <p style="margin:0 0 14px;"><strong>¿Nos podéis confirmar la fecha prevista de entrega?</strong> Con responder a este correo nos vale${varios ? "; si cada pedido lleva una fecha distinta, indicadlo por pedido" : ""}.</p>
    <p style="margin:0;color:#64748b;font-size:13px;">Gracias,<br>${escapeHtml(input.firma || "Departamento de Compras")}<br>${escapeHtml(input.empresa)}</p>
  `;

  return { subject: asunto, html: emailShell("Fecha de entrega", cuerpo, input.empresa, 560) };
}
