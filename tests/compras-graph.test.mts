import { test } from "node:test";
import assert from "node:assert/strict";
import { elegirCorreoDelPedido, meterEnElCuerpo, type CorreoDelPedido } from "../src/lib/compras/graph-hilo.ts";

function correo(extra: Partial<CorreoDelPedido>): CorreoDelPedido {
  return { id: "1", subject: "Pedidos de compra Intec 123", destinatarios: ["ventas@proveedor.com"], sentDateTime: "2026-10-01T08:00:00Z", ...extra };
}

test("un pedido no se confunde con otro que empieza igual", () => {
  // Buscando el 123, Microsoft devuelve también el 1234 y el 1230. Colarse
  // aquí significa reclamar sobre el hilo de otro pedido, a un proveedor que
  // no tiene nada que ver.
  const encontrados = [
    correo({ id: "del-1234", subject: "Pedidos de compra Intec 1234" }),
    correo({ id: "del-1230", subject: "Pedidos de compra Intec 1230" }),
    correo({ id: "el-bueno", subject: "Pedidos de compra Intec 123" }),
  ];
  assert.equal(elegirCorreoDelPedido(encontrados, "Pedidos de compra Intec 123")?.id, "el-bueno");
});

test("vale el envío original, no nuestras propias reclamaciones", () => {
  // Las reclamaciones llevan el mismo asunto con RE: delante. Responder sobre
  // la última dejaría el pedido original cada vez más abajo en el hilo.
  const encontrados = [
    correo({ id: "reclamacion-2", subject: "RE: Pedidos de compra Intec 123", sentDateTime: "2026-10-09T08:00:00Z" }),
    correo({ id: "el-pedido", subject: "Pedidos de compra Intec 123", sentDateTime: "2026-10-01T08:00:00Z" }),
    correo({ id: "reclamacion-1", subject: "RE: Pedidos de compra Intec 123", sentDateTime: "2026-10-03T08:00:00Z" }),
  ];
  assert.equal(elegirCorreoDelPedido(encontrados, "Pedidos de compra Intec 123")?.id, "el-pedido");
});

test("si no está el correo del pedido, no se inventa ninguno", () => {
  const encontrados = [
    correo({ id: "factura", subject: "Factura F-2026-884" }),
    correo({ id: "otro", subject: "Pedidos de compra Intec 999" }),
  ];
  assert.equal(elegirCorreoDelPedido(encontrados, "Pedidos de compra Intec 123"), null);
  assert.equal(elegirCorreoDelPedido([], "Pedidos de compra Intec 123"), null);
});

test("da igual cómo escriba Microsoft las mayúsculas", () => {
  const encontrados = [correo({ id: "el-bueno", subject: "RV: PEDIDOS DE COMPRA INTEC 123" })];
  assert.equal(elegirCorreoDelPedido(encontrados, "Pedidos de compra Intec 123")?.id, "el-bueno");
});

test("un asunto con caracteres raros no rompe la búsqueda", () => {
  // El asunto entra en una expresión regular: sin escapar, un paréntesis o un
  // signo de interrogación la haría fallar o casar de más.
  const encontrados = [correo({ id: "raro", subject: "Pedido (urgente) 123 ¿?" })];
  assert.equal(elegirCorreoDelPedido(encontrados, "Pedido (urgente) 123 ¿?")?.id, "raro");
  assert.doesNotThrow(() => elegirCorreoDelPedido(encontrados, "a+b*c["));
});

test("el texto entra dentro del cuerpo, con el pedido original debajo", () => {
  const borrador = '<html><head><style>p{}</style></head><body lang="ES"><div>El pedido original</div></body></html>';
  const salida = meterEnElCuerpo(borrador, "<p>Nuestra reclamación</p>");
  assert.ok(salida.startsWith("<html><head>"), "no se toca lo de antes del cuerpo");
  assert.ok(salida.includes('<body lang="ES"><p>Nuestra reclamación</p><div>El pedido original</div>'), salida.slice(0, 160));
  assert.ok(salida.indexOf("Nuestra reclamación") < salida.indexOf("El pedido original"), "lo nuestro va primero");
});

test("un borrador sin <body> tampoco se pierde", () => {
  const salida = meterEnElCuerpo("<div>Solo un trozo</div>", "<p>Lo nuestro</p>");
  assert.equal(salida, "<p>Lo nuestro</p><div>Solo un trozo</div>");
});
