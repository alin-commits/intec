import { test } from "node:test";
import assert from "node:assert/strict";
import { interpretar, loQueDiceDeCadaPedido, sinFechasPasadas, type LecturaDeRespuesta } from "../src/lib/compras/leer-respuesta-prompt.ts";

const pedido = (number: number, series = "") => ({ year: 2026, series, number });

function lectura(extra: Partial<LecturaDeRespuesta> = {}): LecturaDeRespuesta {
  return { tipo: "respuesta", fechaPrevista: null, fechaSegura: false, resumen: "Contestan", porPedido: [], ...extra };
}

test("con varios pedidos, cada uno se queda con su fecha y lo que dicen de él", () => {
  const leido = loQueDiceDeCadaPedido([pedido(7328), pedido(7329), pedido(7343)], lectura({
    fechaPrevista: "2026-11-05",
    resumen: "El 7328 sale hoy; el 7329 en espera",
    porPedido: [
      { pedido: "7328", contesta: true, fechaPrevista: "2026-10-30", fechaSegura: true, resumen: "Sale hoy" },
      { pedido: "7329", contesta: true, fechaPrevista: null, fechaSegura: false, resumen: "En espera de que confirméis el cambio" },
    ],
  }));
  assert.deepEqual(leido.map((p) => [p.number, p.contesta, p.fechaPrevista, p.fechaSegura, p.resumen]), [
    [7328, true, "2026-10-30", true, "Sale hoy"],
    // Lo de antes era ponerle el 05/11 del correo: un pedido en espera con fecha.
    [7329, true, null, false, "En espera de que confirméis el cambio"],
    // Del 7343 no dice nada: no está contestado y se le sigue reclamando.
    [7343, false, null, false, null],
  ]);
});

test("una fecha para todos vale para cada uno", () => {
  const leido = loQueDiceDeCadaPedido([pedido(1), pedido(2)], lectura({
    fechaPrevista: "2026-11-09", fechaSegura: true, resumen: "Todo el lunes",
    porPedido: [
      { pedido: "1", contesta: true, fechaPrevista: "2026-11-09", fechaSegura: true, resumen: "" },
      { pedido: "2", contesta: true, fechaPrevista: "2026-11-09", fechaSegura: true, resumen: "" },
    ],
  }));
  assert.deepEqual(leido.map((p) => [p.contesta, p.fechaPrevista, p.fechaSegura, p.resumen]), [
    [true, "2026-11-09", true, "Todo el lunes"],
    [true, "2026-11-09", true, "Todo el lunes"],
  ]);
});

test("si la IA no distingue pedidos, lo del correo vale para todos, como antes", () => {
  const leido = loQueDiceDeCadaPedido([pedido(1), pedido(2)], lectura({ fechaPrevista: "2026-11-09", fechaSegura: true }));
  assert.ok(leido.every((p) => p.contesta && p.fechaPrevista === "2026-11-09" && p.fechaSegura));
  // Y lo mismo si lo que devuelve no casa con ninguno.
  const raro = loQueDiceDeCadaPedido([pedido(1), pedido(2)], lectura({
    fechaPrevista: "2026-11-09",
    porPedido: [{ pedido: "9999", contesta: true, fechaPrevista: null, fechaSegura: false, resumen: "x" }],
  }));
  assert.ok(raro.every((p) => p.contesta && p.fechaPrevista === "2026-11-09"));
});

test("con un solo pedido, todo lo que llega en su hilo va por él", () => {
  // Aunque la IA diga que no contesta: en su hilo solo puede hablar de él.
  const solo = loQueDiceDeCadaPedido([pedido(7)], lectura({
    fechaPrevista: "2026-11-02", fechaSegura: true,
    porPedido: [{ pedido: "7", contesta: false, fechaPrevista: null, fechaSegura: false, resumen: "" }],
  }));
  assert.deepEqual(solo.map((p) => [p.contesta, p.fechaPrevista, p.fechaSegura]), [[true, "2026-11-02", true]]);
  // Y si dio la fecha solo pedido a pedido, se aprovecha.
  const abajo = loQueDiceDeCadaPedido([pedido(7)], lectura({
    porPedido: [{ pedido: "7", contesta: true, fechaPrevista: "2026-11-03", fechaSegura: false, resumen: "" }],
  }));
  assert.deepEqual(abajo.map((p) => [p.fechaPrevista, p.fechaSegura]), [["2026-11-03", false]]);
});

test("el pedido se reconoce con la serie o solo con el número", () => {
  const leido = loQueDiceDeCadaPedido([pedido(15, "PC"), pedido(16, "PC")], lectura({
    porPedido: [
      { pedido: "PC/15", contesta: true, fechaPrevista: "2026-11-04", fechaSegura: true, resumen: "" },
      { pedido: "pedido 16", contesta: true, fechaPrevista: "2026-11-06", fechaSegura: true, resumen: "" },
    ],
  }));
  assert.deepEqual(leido.map((p) => p.fechaPrevista), ["2026-11-04", "2026-11-06"]);
});

test("sin fecha no hay fecha segura", () => {
  const leido = loQueDiceDeCadaPedido([pedido(1), pedido(2)], lectura({
    porPedido: [
      { pedido: "1", contesta: true, fechaPrevista: null, fechaSegura: true, resumen: "Lo miramos" },
      { pedido: "2", contesta: true, fechaPrevista: "2026-11-04", fechaSegura: true, resumen: "" },
    ],
  }));
  assert.deepEqual(leido.map((p) => p.fechaSegura), [false, true]);
});

test("si la IA no pudo leerlo, el pedido cuenta como contestado y sin fecha", () => {
  const leido = loQueDiceDeCadaPedido([pedido(1), pedido(2)], null);
  assert.deepEqual(leido.map((p) => [p.contesta, p.fechaPrevista, p.resumen]), [[true, null, null], [true, null, null]]);
});

test("una lectura sin el detalle por pedido se acepta igual", () => {
  const leido = interpretar({ tipo: "respuesta", fechaPrevista: "2026-11-04", fechaSegura: true, resumen: "El 4" });
  assert.deepEqual(leido?.porPedido, []);
});

test("una fecha anterior al correo no es una fecha prevista", () => {
  const limpia = sinFechasPasadas(lectura({
    fechaPrevista: "2026-10-23", fechaSegura: true,
    porPedido: [
      { pedido: "1", contesta: true, fechaPrevista: "2026-10-22", fechaSegura: true, resumen: "Salió el 22" },
      { pedido: "2", contesta: true, fechaPrevista: "2026-10-28", fechaSegura: true, resumen: "Llega el 28" },
    ],
  }), "2026-10-26");
  assert.equal(limpia?.fechaPrevista, null);
  assert.deepEqual(limpia?.porPedido.map((p) => p.fechaPrevista), [null, "2026-10-28"]);
  // Y la del mismo día vale: «os llega hoy».
  assert.equal(sinFechasPasadas(lectura({ fechaPrevista: "2026-10-26" }), "2026-10-26")?.fechaPrevista, "2026-10-26");
  assert.equal(sinFechasPasadas(null, "2026-10-26"), null);
});
