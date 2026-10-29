import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fechaEnDisputa, hilosALeer, pareceAutomatico, pedidosQueCambia, reconocerRespuestas,
  type CorreoRecibido, type ReclamacionMandada,
} from "../src/lib/compras/respuestas.ts";

const BUZON = "compras@suministrointec.com";

function reclamacion(extra: Partial<ReclamacionMandada> = {}): ReclamacionMandada {
  return {
    conversationId: "hilo-A", companyCode: 1, supplierCode: "1645",
    sentAt: "2026-10-20T08:10:00Z",
    orders: [{ year: 2026, series: "", number: 7275 }],
    ...extra,
  };
}
function correo(extra: Partial<CorreoRecibido> = {}): CorreoRecibido {
  return { id: "c1", conversationId: "hilo-A", from: "ventas@proveedor.com", subject: "RE: Pedidos de compra Intec 7275", receivedAt: "2026-10-21T09:00:00Z", ...extra };
}
const reconocer = (correos: CorreoRecibido[], reclamaciones: ReclamacionMandada[], yaLeidos: string[] = []) =>
  reconocerRespuestas({ correos, reclamaciones, yaLeidos: new Set(yaLeidos), buzonPropio: BUZON });

test("una respuesta en el hilo de la reclamación se reconoce, con sus pedidos", () => {
  const salen = reconocer([correo()], [reclamacion()]);
  assert.equal(salen.length, 1);
  assert.equal(salen[0].supplierCode, "1645");
  assert.deepEqual(salen[0].orders.map((p) => p.number), [7275]);
});

test("un correo de otro hilo no es una respuesta por mucho que lo parezca", () => {
  // Mismo remitente, asunto parecido, pero no está en el hilo: puede ser una
  // factura o un correo suyo de otra cosa. Darlo por contestado dejaría de
  // reclamar un pedido que nadie ha contestado.
  const salen = reconocer([correo({ conversationId: "otro-hilo" })], [reclamacion()]);
  assert.equal(salen.length, 0);
});

test("lo que sale de nuestro propio buzón no es una respuesta", () => {
  // Nuestra propia reclamación está en ese hilo: si contara, cada envío se
  // daría por contestado al instante.
  const salen = reconocer([correo({ from: "compras@suministrointec.com" }), correo({ id: "c2", from: "COMPRAS@suministrointec.com" })], [reclamacion()]);
  assert.equal(salen.length, 0, "y da igual cómo venga escrito en mayúsculas");
});

test("lo que escribe cualquiera de la casa tampoco es una respuesta", () => {
  // Probando el circuito se contestó a una reclamación desde el correo de una
  // persona de la empresa: llegó al hilo como cualquier respuesta y el pedido
  // se dio por contestado, con fecha y todo. Un proveedor nunca escribe desde
  // nuestro dominio.
  const salen = reconocer([
    correo({ from: "Alin@suministrointec.com" }),
    correo({ id: "c2", from: "otra.persona@SUMINISTROINTEC.COM" }),
  ], [reclamacion()]);
  assert.equal(salen.length, 0);
  // Y un proveedor que se llame parecido sigue contando: se mira el dominio
  // entero, no que el texto acabe pareciéndose.
  const proveedor = reconocer([correo({ from: "ventas@nosuministrointec.com" })], [reclamacion()]);
  assert.equal(proveedor.length, 1);
});

test("nuestros propios correos, con la dirección interna de Exchange o sin remitente, no son respuestas", () => {
  // Así aparecen en el hilo las reclamaciones que salen como correo nuevo.
  const salen = reconocer([
    correo({ from: "/O=EXCHANGELABS/OU=EXCHANGE ADMINISTRATIVE GROUP (FYDIBOHF23SPDLT)/CN=RECIPIENTS/CN=COMPRAS" }),
    correo({ id: "c2", from: null }),
    correo({ id: "c3", from: "" }),
  ], [reclamacion()]);
  assert.equal(salen.length, 0);
});

test("un correo anterior a la reclamación no está contestándola", () => {
  // El hilo existe desde que Sage mandó el pedido: hay correos suyos de antes.
  const salen = reconocer([correo({ receivedAt: "2026-10-19T10:00:00Z" })], [reclamacion({ sentAt: "2026-10-20T08:10:00Z" })]);
  assert.equal(salen.length, 0);
});

test("un correo ya leído no se vuelve a procesar", () => {
  assert.equal(reconocer([correo()], [reclamacion()], ["c1"]).length, 0);
});

test("si al proveedor se le reclamaron varios pedidos en ese hilo, la respuesta vale para todos", () => {
  const dos = reclamacion({ orders: [{ year: 2026, series: "", number: 7275 }, { year: 2026, series: "", number: 7280 }] });
  const salen = reconocer([correo()], [dos]);
  assert.deepEqual(salen[0].orders.map((p) => p.number), [7275, 7280]);
});

test("dos reclamaciones en el mismo hilo no duplican los pedidos", () => {
  const primera = reclamacion({ sentAt: "2026-10-20T08:00:00Z" });
  const segunda = reclamacion({ sentAt: "2026-10-21T08:00:00Z" });
  const salen = reconocer([correo({ receivedAt: "2026-10-21T09:00:00Z" })], [primera, segunda]);
  assert.equal(salen.length, 1);
  assert.deepEqual(salen[0].orders.map((p) => p.number), [7275]);
});

test("sin hilo no se empareja nada", () => {
  assert.equal(reconocer([correo({ conversationId: null })], [reclamacion()]).length, 0);
  assert.equal(reconocer([correo()], [reclamacion({ conversationId: null })]).length, 0);
});

test("las respuestas automáticas se reconocen por las cabeceras", () => {
  const normal = { subject: "RE: Pedidos de compra Intec 7275" };
  assert.ok(!pareceAutomatico(normal));
  assert.ok(pareceAutomatico(normal, { "auto-submitted": "auto-replied" }));
  assert.ok(pareceAutomatico(normal, { "x-autoreply": "yes" }));
  assert.ok(pareceAutomatico(normal, { precedence: "auto_reply" }));
  // "auto-submitted: no" es lo que pone un correo normal: no lo convierte en automático.
  assert.ok(!pareceAutomatico(normal, { "auto-submitted": "no" }));
});

test("y por el asunto cuando no traen cabeceras", () => {
  for (const subject of [
    "Fuera de la oficina: RE: Pedidos de compra Intec 7275",
    "Automatic reply: pedido 7275",
    "RESPUESTA AUTOMÁTICA",
    "No responder a este correo",
    "Undeliverable: Pedidos de compra Intec 7275",
  ]) {
    assert.ok(pareceAutomatico({ subject }), subject);
  }
  assert.ok(!pareceAutomatico({ subject: "RE: Pedidos de compra Intec 7275 - confirmamos para el 4/11" }));
});

test("la fecha del proveedor que no cuadra con Sage se avisa, y la que cuadra no", () => {
  // El caso de verdad: Sage dice el 27, el proveedor escribe después diciendo
  // que lo manda el 2 de noviembre, y el pedido se daba por confirmado.
  assert.equal(fechaEnDisputa({ dicha: "2026-11-02", enSage: ["2026-10-27"], sinFecha: 0 }), "2026-11-02");
  assert.equal(fechaEnDisputa({ dicha: "2026-10-27", enSage: ["2026-10-27"], sinFecha: 0 }), null);

  // Un pedido de varias líneas: si confirma la de una, no hay nada que decir
  // aunque la del pedido —la más lejana— sea otra.
  assert.equal(fechaEnDisputa({ dicha: "2026-10-27", enSage: ["2026-10-27", "2026-11-10"], sinFecha: 0 }), null);
  assert.equal(fechaEnDisputa({ dicha: "2026-12-01", enSage: ["2026-10-27", "2026-11-10"], sinFecha: 0 }), "2026-12-01");
});

test("sin fecha dicha, o con el pedido aún sin confirmar, no se avisa de nada", () => {
  assert.equal(fechaEnDisputa({ dicha: null, enSage: ["2026-10-27"], sinFecha: 0 }), null);
  assert.equal(fechaEnDisputa({ dicha: "", enSage: ["2026-10-27"], sinFecha: 0 }), null);
  // Mientras falten fechas en Sage el pedido ya sale como sin confirmar: un
  // segundo aviso por lo mismo sobraría.
  assert.equal(fechaEnDisputa({ dicha: "2026-11-02", enSage: ["2026-10-27"], sinFecha: 1 }), null);
  assert.equal(fechaEnDisputa({ dicha: "2026-11-02", enSage: [], sinFecha: 0 }), null);
});

test("una fecha con hora se compara por el día", () => {
  assert.equal(fechaEnDisputa({ dicha: "2026-10-27T00:00:00Z", enSage: ["2026-10-27"], sinFecha: 0 }), null);
});

test("se miran los hilos de las reclamaciones recientes, sin repetir y sin las que no tienen hilo", () => {
  const hilos = hilosALeer([
    { conversationId: "h1", sentAt: "2026-10-26T09:00:00Z" },
    { conversationId: "h1", sentAt: "2026-10-29T09:00:00Z" },
    { conversationId: null, sentAt: "2026-10-28T09:00:00Z" },
    { conversationId: "h2", sentAt: "2026-10-28T09:00:00Z" },
    // De hace más de lo que se mira: ya se sigue a mano.
    { conversationId: "h0", sentAt: "2026-08-01T09:00:00Z" },
  ], "2026-09-14T00:00:00Z");
  assert.deepEqual(hilos.sort(), ["h1", "h2"]);
});

test("un correo viejo no pisa una fecha confirmada después ni una respuesta más nueva", () => {
  const pedidos = [
    { year: 2026, series: "PC", number: 1 },
    { year: 2026, series: "PC", number: 2 },
    { year: 2026, series: "PC", number: 3 },
    { year: 2026, series: "PC", number: 4 },
  ];
  const apuntado = [
    // Confirmado por una persona cuando el correo ya había llegado.
    { year: 2026, series: "PC", number: 1, confirmed_at: "2026-10-27T10:00:00Z", replied_at: null },
    // Ya tiene una respuesta más nueva.
    { year: 2026, series: "PC", number: 2, confirmed_at: null, replied_at: "2026-10-28T10:00:00Z" },
    // Confirmado antes de que llegara: el proveedor dice algo nuevo y cuenta.
    { year: 2026, series: "PC", number: 3, confirmed_at: "2026-10-20T10:00:00Z", replied_at: "2026-10-20T09:00:00Z" },
    // El 4 no tiene nada apuntado.
  ];
  const cambian = pedidosQueCambia(pedidos, apuntado, "2026-10-26T12:00:00Z").map((p) => p.number);
  assert.deepEqual(cambian, [3, 4]);
});

test("las respuestas salen de la más vieja a la más nueva, para que mande la última", () => {
  const reclamacion: ReclamacionMandada = {
    conversationId: "h1", companyCode: 1, supplierCode: "P1", sentAt: "2026-10-20T08:00:00Z",
    orders: [{ year: 2026, series: "PC", number: 1 }],
  };
  const correo = (id: string, receivedAt: string): CorreoRecibido =>
    ({ id, conversationId: "h1", from: "ventas@proveedor.example", subject: "RE: pedido", receivedAt });
  const reconocidas = reconocerRespuestas({
    correos: [correo("nuevo", "2026-10-25T10:00:00Z"), correo("viejo", "2026-10-21T10:00:00Z")],
    reclamaciones: [reclamacion],
    yaLeidos: new Set(),
    buzonPropio: "compras@nuestra.example",
  });
  assert.deepEqual(reconocidas.map((r) => r.correo.id), ["viejo", "nuevo"]);
});
