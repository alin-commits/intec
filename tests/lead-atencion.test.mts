import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HORAS_PARA_ATENDER,
  atencionDeLead,
  esperaDetallada,
  horasEnPalabras,
  horasLaborables,
  primerToque,
} from "../src/lib/leads/atencion.ts";

// Octubre de 2026 en Madrid va con horario de verano (UTC+2) hasta el día 25.
// El viernes es el 2, el sábado el 3, el domingo el 4 y el lunes el 5.
const VIERNES_18 = "2026-10-02T16:00:00.000Z";
const SABADO_10 = "2026-10-03T08:00:00.000Z";
const SABADO_18 = "2026-10-03T16:00:00.000Z";
const LUNES_09 = "2026-10-05T07:00:00.000Z";
const LUNES_12 = "2026-10-05T10:00:00.000Z";
const MARTES_10 = "2026-10-06T08:00:00.000Z";

test("el fin de semana no cuenta", () => {
  // Viernes de 18:00 a medianoche (6 h) y lunes de 00:00 a 09:00 (9 h).
  assert.equal(horasLaborables(VIERNES_18, LUNES_09), 15);
  // Un sábado entero no suma nada.
  assert.equal(horasLaborables(SABADO_10, SABADO_18), 0);
});

test("de lunes a martes cuentan todas las horas", () => {
  assert.equal(horasLaborables(LUNES_09, MARTES_10), 25);
  assert.equal(horasLaborables(LUNES_09, LUNES_12), 3);
});

test("el cambio de hora de octubre no descuadra la cuenta", () => {
  // El domingo 25 de octubre de 2026 tiene 25 horas, pero es domingo: no cuenta.
  // Viernes 23 a las 18:00 (CEST) → lunes 26 a las 09:00 (CET) = 6 h + 9 h.
  assert.equal(horasLaborables("2026-10-23T16:00:00.000Z", "2026-10-26T08:00:00.000Z"), 15);
});

test("al revés o con fechas raras no inventa horas", () => {
  assert.equal(horasLaborables(LUNES_12, LUNES_09), 0);
  assert.equal(horasLaborables(LUNES_09, LUNES_09), 0);
  assert.equal(horasLaborables("no es una fecha", LUNES_09), 0);
});

test("el primer toque es el primer cambio que lo saca de Nuevo", () => {
  assert.equal(primerToque(undefined), null);
  assert.equal(primerToque([{ newStatus: "new", changedAt: LUNES_09 }]), null);
  assert.equal(
    primerToque([
      { newStatus: "won", changedAt: MARTES_10 },
      { newStatus: "new", changedAt: VIERNES_18 },
      { newStatus: "contacted", changedAt: LUNES_12 },
    ]),
    LUNES_12,
  );
});

test("un lead atendido el mismo día está a tiempo", () => {
  const atencion = atencionDeLead({
    createdAt: LUNES_09,
    status: "contacted",
    statusHistory: [{ newStatus: "contacted", changedAt: LUNES_12 }],
  });
  assert.equal(atencion.estado, "a-tiempo");
  assert.equal(atencion.horas, 3);
});

test("el que entra el viernes por la tarde y se atiende el lunes no es tarde", () => {
  const atencion = atencionDeLead({
    createdAt: VIERNES_18,
    status: "contacted",
    statusHistory: [{ newStatus: "contacted", changedAt: LUNES_09 }],
  });
  assert.equal(atencion.estado, "a-tiempo");
  assert.equal(atencion.horas, 15);
});

test("pasado el día laborable, es tarde", () => {
  const atencion = atencionDeLead({
    createdAt: LUNES_09,
    status: "contacted",
    statusHistory: [{ newStatus: "contacted", changedAt: MARTES_10 }],
  });
  assert.equal(atencion.estado, "tarde");
  assert.ok(atencion.horas > HORAS_PARA_ATENDER);
});

test("el que sigue en Nuevo se separa entre esperando y sin atender", () => {
  assert.equal(atencionDeLead({ createdAt: LUNES_09, status: "new" }, LUNES_12).estado, "esperando");
  assert.equal(atencionDeLead({ createdAt: LUNES_09, status: "new" }, MARTES_10).estado, "sin-atender");
});

test("sin registro de cambios no se acusa a nadie", () => {
  // Leads de antes de que existiera el historial: no hay con qué medirlos.
  assert.equal(atencionDeLead({ createdAt: VIERNES_18, status: "won" }, MARTES_10).estado, "a-tiempo");
});

test("las horas se dicen en palabras", () => {
  assert.equal(horasEnPalabras(0.5), "menos de 1 h");
  assert.equal(horasEnPalabras(6), "6 h");
  assert.equal(horasEnPalabras(25), "1 día laborable");
  assert.equal(horasEnPalabras(49), "2 días laborables");
});

test("el detalle dice dias, horas y minutos", () => {
  // 3 dias laborables (72 h) + 19 h + 24 min
  assert.equal(esperaDetallada(72 + 19 + 24 / 60), "3 días laborables, 19 h y 24 min");
});

test("el detalle se salta lo que vale cero", () => {
  assert.equal(esperaDetallada(48), "2 días laborables");
  assert.equal(esperaDetallada(48 + 0.5), "2 días laborables y 30 min");
  assert.equal(esperaDetallada(5), "5 h");
  assert.equal(esperaDetallada(5 + 7 / 60), "5 h y 7 min");
});

test("el detalle habla en singular cuando toca", () => {
  assert.equal(esperaDetallada(24), "1 día laborable");
  assert.equal(esperaDetallada(25), "1 día laborable y 1 h");
});

test("el detalle no inventa 60 minutos", () => {
  assert.equal(esperaDetallada(1 - 1 / 3600), "1 h");
  assert.equal(esperaDetallada(24 - 1 / 3600), "1 día laborable");
});

test("el detalle de una espera minima", () => {
  assert.equal(esperaDetallada(0), "menos de 1 min");
  assert.equal(esperaDetallada(1 / 120), "menos de 1 min");
});
