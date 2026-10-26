import { test } from "node:test";
import assert from "node:assert/strict";
import { clavePedido, escalonAMano, escalonQueToca, reclamacionesDeHoy, type PedidoReclamable, type Seguimiento } from "../src/lib/compras/reclamaciones.ts";

const DESDE = "2026-10-01";

function pedido(extra: Partial<PedidoReclamable> = {}): PedidoReclamable {
  return {
    companyCode: 1, year: 2026, series: "", number: 7000,
    supplierCode: "1645", orderDate: "2026-10-10", lineasSinFecha: 2, pendingAmount: 100,
    ...extra,
  };
}
const sin = new Map<string, Seguimiento>();
const con = (p: PedidoReclamable, s: Partial<Seguimiento>) =>
  new Map([[clavePedido(p), { state: "sin_confirmar", level: 0, quietUntil: null, ...s }]]);

test("el primer aviso sale a los 2 días laborables, ni antes ni el día del pedido", () => {
  // El 10/10/2026 es sábado: el domingo no cuenta, el lunes 12 va un día
  // laborable y el martes 13 van dos.
  const p = pedido({ orderDate: "2026-10-10" });
  assert.equal(escalonQueToca(p, undefined, "2026-10-10"), null, "el mismo día no");
  assert.equal(escalonQueToca(p, undefined, "2026-10-11"), null, "el domingo tampoco");
  assert.equal(escalonQueToca(p, undefined, "2026-10-12"), null, "el lunes solo lleva uno");
  assert.equal(escalonQueToca(p, undefined, "2026-10-13"), 1, "el martes sí");
});

test("el fin de semana no cuenta: lo pedido el viernes no se reclama el lunes", () => {
  // El 16/10/2026 es viernes. Sábado y domingo no cuentan, así que el lunes
  // 19 lleva un día laborable y el martes 20, dos.
  const p = pedido({ orderDate: "2026-10-16" });
  assert.equal(escalonQueToca(p, undefined, "2026-10-18"), null, "el domingo lleva cero");
  assert.equal(escalonQueToca(p, undefined, "2026-10-19"), null, "el lunes lleva uno");
  assert.equal(escalonQueToca(p, undefined, "2026-10-20"), 1, "el martes ya son dos");
});

test("el segundo sale a los 5 laborables, y solo si el primero ya salió", () => {
  const p = pedido({ orderDate: "2026-10-10" });
  // Sábado 10: el jueves 15 lleva cuatro laborables y el viernes 16, cinco.
  assert.equal(escalonQueToca(p, { state: "reclamado", level: 1, quietUntil: null }, "2026-10-15"), null);
  assert.equal(escalonQueToca(p, { state: "reclamado", level: 1, quietUntil: null }, "2026-10-16"), 2);
  // Y después de los dos, no hay un tercero por mucho que pase el tiempo.
  assert.equal(escalonQueToca(p, { state: "reclamado", level: 2, quietUntil: null }, "2027-05-01"), null);
});

test("un pedido sin pasar al proveedor no se reclama, por viejo que sea", () => {
  // Si no se le ha enviado, no lo ha recibido: reclamarle una fecha es
  // pedirle cuentas de algo que no le ha llegado.
  const sinPasar = pedido({ orderDate: "2026-09-01", pasadoAProveedor: false });
  assert.equal(escalonQueToca(sinPasar, undefined, "2026-10-20"), null);

  // En cuanto compras lo pasa entra por donde le toca, y el plazo se cuenta
  // desde la fecha del pedido: uno viejo recibe el primero, no el segundo.
  const yaPasado = pedido({ orderDate: "2026-09-01", pasadoAProveedor: true });
  assert.equal(escalonQueToca(yaPasado, undefined, "2026-10-20"), 1);
});

test("si no se sabe si está pasado, se reclama como hasta ahora", () => {
  // Un agente de Sage antiguo no manda esa columna. Dejar de reclamar por
  // falta de un dato sería peor que el problema que arregla.
  assert.equal(escalonQueToca(pedido({ orderDate: "2026-10-10", pasadoAProveedor: null }), undefined, "2026-10-13"), 1);
  assert.equal(escalonQueToca(pedido({ orderDate: "2026-10-10" }), undefined, "2026-10-13"), 1);
});

test("un pedido viejo al que no se escribió nunca recibe el primero, no el segundo", () => {
  // Si el cron no corrió unos días, al volver recupera en orden en vez de
  // saltarse el primer aviso y mandar directamente el segundo.
  const p = pedido({ orderDate: "2026-10-01" });
  assert.equal(escalonQueToca(p, undefined, "2026-10-20"), 1);
});

test("no se escribe si ya está resuelto, pausado o es de los que no se reclaman", () => {
  const p = pedido({ orderDate: "2026-10-01" });
  for (const state of ["confirmado", "contestado", "pausado", "sin_reclamar"]) {
    assert.equal(escalonQueToca(p, { state, level: 0, quietUntil: null }, "2026-10-20"), null, state);
  }
});

test("la ventana de silencio manda mientras dura, y deja de mandar cuando pasa", () => {
  const p = pedido({ orderDate: "2026-10-01" });
  const callado = { state: "reclamado", level: 0, quietUntil: "2026-10-25T09:00:00Z" };
  assert.equal(escalonQueToca(p, callado, "2026-10-20"), null);
  assert.equal(escalonQueToca(p, callado, "2026-10-25"), 1, "el mismo día que vence ya se puede");
});

test("sin líneas sin fecha o sin proveedor no se reclama nada", () => {
  assert.equal(escalonQueToca(pedido({ lineasSinFecha: 0 }), undefined, "2026-10-20"), null);
  assert.equal(escalonQueToca(pedido({ supplierCode: null }), undefined, "2026-10-20"), null);
});

test("los pedidos anteriores al encendido no entran en el automático", () => {
  // Los 275 atascados se reclaman a mano: si entraran, serían 112 correos de
  // golpe el primer día, algunos de pedidos de hace más de un año.
  const viejo = pedido({ orderDate: "2025-10-13", number: 28 });
  const nuevo = pedido({ orderDate: "2026-10-10", number: 7272 });
  const salen = reclamacionesDeHoy({ pedidos: [viejo, nuevo], seguimiento: sin, hoy: "2026-10-20", desde: DESDE });
  assert.equal(salen.length, 1);
  assert.deepEqual(salen[0].pedidos.map((p) => p.number), [7272]);
});

test("a cada proveedor le llega un correo con todos sus pedidos, no uno por pedido", () => {
  const pedidos = [
    pedido({ number: 1, supplierCode: "A", orderDate: "2026-10-10" }),
    pedido({ number: 2, supplierCode: "A", orderDate: "2026-10-11" }),
    pedido({ number: 3, supplierCode: "B", orderDate: "2026-10-12" }),
  ];
  const salen = reclamacionesDeHoy({ pedidos, seguimiento: sin, hoy: "2026-10-20", desde: DESDE });
  assert.equal(salen.length, 2, "dos proveedores, dos correos");
  const a = salen.find((g) => g.supplierCode === "A")!;
  assert.deepEqual(a.pedidos.map((p) => p.number), [1, 2], "y los suyos van ordenados por antigüedad");
});

test("el mismo proveedor en dos empresas son dos correos distintos", () => {
  const pedidos = [
    pedido({ companyCode: 1, number: 1, supplierCode: "A" }),
    pedido({ companyCode: 3, number: 1, supplierCode: "A" }),
  ];
  assert.equal(reclamacionesDeHoy({ pedidos, seguimiento: sin, hoy: "2026-10-20", desde: DESDE }).length, 2);
});

test("si en el mismo correo hay pedidos de los dos escalones, se apunta el más alto", () => {
  const viejo = pedido({ number: 1, orderDate: "2026-10-10" });
  const nuevo = pedido({ number: 2, orderDate: "2026-10-18" });
  const seguimiento = new Map([[clavePedido(viejo), { state: "reclamado", level: 1, quietUntil: null }]]);
  const salen = reclamacionesDeHoy({ pedidos: [viejo, nuevo], seguimiento, hoy: "2026-10-20", desde: DESDE });
  assert.equal(salen.length, 1);
  assert.equal(salen[0].nivel, 2);
  assert.equal(salen[0].pedidos.length, 2, "van los dos pedidos en el mismo correo");
});

test("primero el proveedor que lleva más esperando", () => {
  const pedidos = [
    pedido({ number: 1, supplierCode: "NUEVO", orderDate: "2026-10-17" }),
    pedido({ number: 2, supplierCode: "VIEJO", orderDate: "2026-10-05" }),
  ];
  const salen = reclamacionesDeHoy({ pedidos, seguimiento: sin, hoy: "2026-10-20", desde: DESDE });
  assert.deepEqual(salen.map((g) => g.supplierCode), ["VIEJO", "NUEVO"]);
});

test("un pedido que ya tiene todas sus líneas con fecha deja de contar aunque tenga seguimiento", () => {
  const p = pedido({ lineasSinFecha: 0 });
  assert.equal(escalonQueToca(p, { state: "reclamado", level: 1, quietUntil: null }, "2026-10-20"), null);
  assert.equal(reclamacionesDeHoy({ pedidos: [p], seguimiento: con(p, { level: 1 }), hoy: "2026-10-20", desde: DESDE }).length, 0);
});

test("cada pedido lleva su propio escalón aunque viajen en el mismo correo", () => {
  // El pedido viejo va por el segundo aviso y el nuevo por el primero. Si al
  // nuevo se le apuntara el segundo solo por acompañarlo, se quedaría sin su
  // recordatorio de los cinco días.
  const viejo = pedido({ number: 1, orderDate: "2026-10-10" });
  const nuevo = pedido({ number: 2, orderDate: "2026-10-18" });
  const seguimiento = new Map([[clavePedido(viejo), { state: "reclamado", level: 1, quietUntil: null }]]);
  const [grupo] = reclamacionesDeHoy({ pedidos: [viejo, nuevo], seguimiento, hoy: "2026-10-20", desde: DESDE });
  assert.deepEqual(grupo.pedidos.map((p) => [p.number, p.nivel]), [[1, 2], [2, 1]]);
  assert.equal(grupo.nivel, 2, "el tono del correo es el del escalón más alto");
});

test("reclamar a mano sube el escalón igual, y se queda en el segundo", () => {
  assert.equal(escalonAMano(undefined), 1);
  assert.equal(escalonAMano({ state: "sin_confirmar", level: 0, quietUntil: null }), 1);
  assert.equal(escalonAMano({ state: "reclamado", level: 1, quietUntil: null }), 2);
  assert.equal(escalonAMano({ state: "reclamado", level: 2, quietUntil: null }), 2);
});

test("un pedido servido no se reclama aunque le sobren unidades", () => {
  // Sage cierra pedidos dejando un resto: 197 de 533 estaban servidos con
  // unidades pendientes, y entre todos sumaban 11.204 € frente a los 705.171 €
  // de los que de verdad faltan. Reclamarlos es dar la lata por un sobrante.
  const servido = pedido({ status: 2, orderDate: "2026-10-01" });
  assert.equal(escalonQueToca(servido, undefined, "2026-10-20"), null);
  assert.equal(reclamacionesDeHoy({ pedidos: [servido], seguimiento: sin, hoy: "2026-10-20", desde: DESDE }).length, 0);
});

test("ni uno servido a medias: solo se trabaja con los pendientes", () => {
  assert.equal(escalonQueToca(pedido({ status: 1, orderDate: "2026-10-01" }), undefined, "2026-10-20"), null);
  assert.equal(escalonQueToca(pedido({ status: 0, orderDate: "2026-10-01" }), undefined, "2026-10-20"), 1);
});

test("y si Sage no manda el estado, se reclama igual", () => {
  // No saberlo no es razón para callarse: el pedido tiene material pendiente.
  assert.equal(escalonQueToca(pedido({ status: null, orderDate: "2026-10-01" }), undefined, "2026-10-20"), 1);
  assert.equal(escalonQueToca(pedido({ orderDate: "2026-10-01" }), undefined, "2026-10-20"), 1);
});
