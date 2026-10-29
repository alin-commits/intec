import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DIAS_PARA_CERRAR,
  diasDesde,
  faltaEnElMotivo,
  motivoParaGuardar,
  MOTIVO_VACIO,
  pideCerrarse,
  repartoDePerdidas,
  ultimoCambio,
} from "../src/lib/por-cerrar.ts";

test("desde cuándo está en su estado: el último cambio, o el alta si nunca cambió", () => {
  assert.equal(ultimoCambio("2026-10-01T09:00:00Z", []), "2026-10-01T09:00:00Z");
  assert.equal(ultimoCambio("2026-10-01T09:00:00Z", ["2026-10-03T10:00:00Z", "2026-10-02T10:00:00Z"]), "2026-10-03T10:00:00Z");
  // Un cambio sin fecha no cuenta, y no puede dejarlo antes de su alta.
  assert.equal(ultimoCambio("2026-10-01T09:00:00Z", [null, undefined, "2026-09-01T00:00:00Z"]), "2026-10-01T09:00:00Z");
});

test("se pide cerrarlo a partir de una semana parado, no antes", () => {
  const ahora = new Date("2026-10-29T12:00:00Z");
  assert.equal(diasDesde("2026-10-22T12:00:00Z", ahora), 7);
  assert.equal(pideCerrarse(diasDesde("2026-10-22T12:00:00Z", ahora)), true);
  // Seis días y veintitrés horas todavía no es una semana.
  assert.equal(pideCerrarse(diasDesde("2026-10-22T13:00:00Z", ahora)), false);
  assert.equal(DIAS_PARA_CERRAR, 7);
  // Una fecha rara o del futuro no da días negativos.
  assert.equal(diasDesde("no es una fecha", ahora), 0);
  assert.equal(diasDesde("2026-11-30T00:00:00Z", ahora), 0);
});

test("para marcarlo perdido hace falta el motivo, y con «otro», cuál", () => {
  assert.equal(faltaEnElMotivo(MOTIVO_VACIO), "Elige por qué se ha perdido.");
  assert.equal(faltaEnElMotivo({ reason: "precio", detail: "" }), null);
  assert.equal(faltaEnElMotivo({ reason: "otro", detail: "   " }), "Con «Otro motivo», escribe cuál.");
  assert.equal(faltaEnElMotivo({ reason: "otro", detail: "Cerró la obra" }), null);
  assert.match(faltaEnElMotivo({ reason: "plazo", detail: "x".repeat(301) }) ?? "", /300/);
});

test("lo que se guarda: el motivo solo si está perdido, y sin espacios de sobra", () => {
  assert.deepEqual(motivoParaGuardar(true, { reason: "plazo", detail: "  tres semanas  " }), { lost_reason: "plazo", lost_detail: "tres semanas", lost_reason_source: "persona" });
  assert.deepEqual(motivoParaGuardar(true, { reason: "precio", detail: "" }), { lost_reason: "precio", lost_detail: null, lost_reason_source: "persona" });
  // Si no está perdido, el motivo escrito no se manda aunque lo hubiera.
  assert.deepEqual(motivoParaGuardar(false, { reason: "precio", detail: "caro" }), { lost_reason: null, lost_detail: null, lost_reason_source: null });
});

test("quién eligió el motivo viaja siempre con él", () => {
  // Tal como lo propuso la IA, consta como de la IA.
  assert.equal(motivoParaGuardar(true, { reason: "precio", detail: "más barato fuera", porIa: true }).lost_reason_source, "ia");
  // En cuanto alguien lo cambia a mano, el formulario quita la marca y consta
  // como de una persona: la base conservaría «ia» si no se le dijera.
  assert.equal(motivoParaGuardar(true, { reason: "plazo", detail: "más barato fuera", porIa: false }).lost_reason_source, "persona");
  // Sin motivo no hay autor que apuntar.
  assert.equal(motivoParaGuardar(true, { reason: "", detail: "", porIa: true }).lost_reason_source, null);
});

test("el reparto de motivos: sobre los que tienen motivo, de más a menos, y los de antes aparte", () => {
  const orden = ["precio", "plazo", "competencia", "otro"] as const;
  const { filas, conMotivo, sinMotivo, porIa } = repartoDePerdidas([
    { reason: "precio", value: 1000 },
    { reason: "precio", source: "ia", value: 500 },
    { reason: "plazo", value: null },
    { reason: null },
    { reason: undefined },
  ], [...orden]);
  assert.equal(conMotivo, 3);
  assert.equal(sinMotivo, 2, "los perdidos de antes del motivo se cuentan aparte");
  assert.equal(porIa, 1);
  assert.deepEqual(filas.map((fila) => fila.motivo), ["precio", "plazo"], "solo los que tienen alguno, el mayor primero");
  assert.equal(Math.round(filas[0].porcentaje), 67, "sobre 3 con motivo, no sobre 5");
  assert.equal(filas[0].valor, 1500);
  assert.equal(filas[0].porIa, 1);
});

test("un motivo que ya no está en la lista también cuenta, para que el total cuadre", () => {
  const { filas, conMotivo } = repartoDePerdidas([{ reason: "sin_stock" }, { reason: "precio" }], ["precio"]);
  assert.equal(conMotivo, 2);
  assert.deepEqual(filas.map((fila) => fila.motivo).sort(), ["precio", "sin_stock"]);
  assert.equal(filas.reduce((suma, fila) => suma + fila.cuantos, 0), 2);
});

test("sin perdidos, nada que repartir y sin dividir por cero", () => {
  const vacio = repartoDePerdidas([], ["precio"]);
  assert.deepEqual(vacio, { filas: [], conMotivo: 0, sinMotivo: 0, porIa: 0 });
});
