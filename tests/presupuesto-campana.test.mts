import { test } from "node:test";
import assert from "node:assert/strict";
import { presupuestoDeCampana } from "../src/lib/publicidad/presupuesto.ts";

const campana = (status: string, started: string, diario: number | null, total: number | null = null) =>
  ({ status, started_at: started, daily_budget: diario, lifetime_budget: total });

test("el caso real: una tanda parada y otra viva, las dos de 20 €/día", () => {
  const resultado = presupuestoDeCampana([
    campana("PAUSED", "2026-09-28", 20),
    campana("ACTIVE", "2026-10-14", 20),
  ]);
  // Nunca hubo 40 €/día: solo corre una.
  assert.equal(resultado.diario, 20);
});

test("cuando ya no corre ninguna, vale la última tanda", () => {
  const resultado = presupuestoDeCampana([
    campana("PAUSED", "2026-09-28", 20),
    campana("PAUSED", "2026-10-14", 35),
  ]);
  assert.equal(resultado.diario, 35);
});

test("las que arrancaron juntas sí se suman: esas corrían a la vez", () => {
  const resultado = presupuestoDeCampana([
    campana("ACTIVE", "2026-10-14", 20),
    campana("ACTIVE", "2026-10-14", 15),
  ]);
  assert.equal(resultado.diario, 35);
});

test("una activa manda sobre las paradas aunque sea más antigua", () => {
  const resultado = presupuestoDeCampana([
    campana("ACTIVE", "2026-01-01", 10),
    campana("PAUSED", "2026-10-14", 99),
  ]);
  assert.equal(resultado.diario, 10);
});

test("el presupuesto total sí suma todas las tandas", () => {
  const resultado = presupuestoDeCampana([
    campana("PAUSED", "2026-09-28", null, 30),
    campana("ACTIVE", "2026-10-14", null, 45),
  ]);
  // El gasto que se compara también suma las dos, así que el tope también.
  assert.equal(resultado.total, 75);
  assert.equal(resultado.diario, null);
});

test("sin presupuesto en la plataforma, nada que enseñar", () => {
  assert.deepEqual(presupuestoDeCampana([]), { diario: null, total: null });
  assert.deepEqual(presupuestoDeCampana([campana("ACTIVE", "2026-10-14", null)]), { diario: null, total: null });
});

test("un estado raro o una fecha vacía no rompen la cuenta", () => {
  const resultado = presupuestoDeCampana([
    { status: null, started_at: null, daily_budget: "12.5", lifetime_budget: null },
    { status: "DELETED", started_at: "", daily_budget: 7, lifetime_budget: null },
  ]);
  // Ninguna viva y las dos "sin fecha": cuentan como la misma tanda.
  assert.equal(resultado.diario, 19.5);
});
