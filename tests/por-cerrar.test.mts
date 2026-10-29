import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DIAS_PARA_CERRAR,
  diasDesde,
  faltaEnElMotivo,
  motivoParaGuardar,
  MOTIVO_VACIO,
  pideCerrarse,
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
  assert.deepEqual(motivoParaGuardar(true, { reason: "plazo", detail: "  tres semanas  " }), { lost_reason: "plazo", lost_detail: "tres semanas" });
  assert.deepEqual(motivoParaGuardar(true, { reason: "precio", detail: "" }), { lost_reason: "precio", lost_detail: null });
  // Si no está perdido, el motivo escrito no se manda aunque lo hubiera.
  assert.deepEqual(motivoParaGuardar(false, { reason: "precio", detail: "caro" }), { lost_reason: null, lost_detail: null });
});
