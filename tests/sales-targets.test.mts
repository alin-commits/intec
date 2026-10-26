import { test } from "node:test";
import assert from "node:assert/strict";
import { repartirElAno, repartirPorPesos, repartirTrimestre, sumaDe, TRIMESTRES, variacionSobreAnterior } from "../src/lib/sales-targets.ts";

test("el reparto sigue la forma de los pesos", () => {
  // Un trimestre de 300.000 con un mes que vendió el doble que los otros dos.
  assert.deepEqual(repartirPorPesos(300_000, [100_000, 50_000, 50_000]), [150_000, 75_000, 75_000]);
});

test("lo repartido suma exactamente lo que se pidió repartir", () => {
  // Los pesos de este reparto no dan números redondos: el céntimo que deja el
  // redondeo va al mes de más peso en vez de perderse.
  const reparto = repartirPorPesos(100_000, [1, 1, 1]);
  assert.equal(reparto.reduce((total, valor) => total + valor, 0), 100_000);
  assert.deepEqual(reparto, [33_334, 33_333, 33_333]);

  const otro = repartirPorPesos(1_000_001, [7, 3]);
  assert.equal(otro.reduce((total, valor) => total + valor, 0), 1_000_001);
});

test("sin venta el año pasado se reparte a partes iguales", () => {
  assert.deepEqual(repartirPorPesos(90_000, [0, 0, 0]), [30_000, 30_000, 30_000]);
  // Y un mes en rojo cuenta como cero, no resta del de los demás.
  assert.deepEqual(repartirPorPesos(100_000, [-500, 50, 50]), [0, 50_000, 50_000]);
});

test("el año entero se reparte con la temporalidad del anterior", () => {
  const anterior = [10, 10, 20, 10, 10, 10, 5, 5, 10, 10, 10, 10].map((peso) => peso * 1000);
  const reparto = repartirElAno(1_200_000, anterior);
  assert.equal(sumaDe(reparto), 1_200_000);
  // Marzo pesa el doble que enero, y agosto la mitad.
  assert.ok(reparto[2] > reparto[0], "marzo lleva más que enero");
  assert.ok(reparto[7] < reparto[0], "agosto lleva menos que enero");
  // Sin datos del año pasado, a doceavas y sin perder un euro.
  const plano = repartirElAno(1_200_000, null);
  assert.deepEqual(plano, Array.from({ length: 12 }, () => 100_000));
});

test("un trimestre reparte en sus tres meses y no toca los demás", () => {
  const meses: (number | null)[] = Array.from({ length: 12 }, (_, index) => (index === 11 ? 999 : null));
  const anterior = [60_000, 20_000, 20_000, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const siguiente = repartirTrimestre({ meses, trimestre: 0, importe: 200_000, anterior });

  assert.deepEqual(siguiente.slice(0, 3), [120_000, 40_000, 40_000], "enero pesaba el triple");
  assert.equal(sumaDe(siguiente, TRIMESTRES[0].meses), 200_000);
  assert.deepEqual(siguiente.slice(3, 11), Array.from({ length: 8 }, () => null), "los demás, intactos");
  assert.equal(siguiente[11], 999, "y lo que ya estaba puesto se queda");
});

test("el trimestre sin venta el año pasado se parte en tres", () => {
  const meses: (number | null)[] = Array.from({ length: 12 }, () => null);
  const siguiente = repartirTrimestre({ meses, trimestre: 2, importe: 90_000, anterior: null });
  assert.deepEqual(siguiente.slice(6, 9), [30_000, 30_000, 30_000]);
});

test("la suma cuenta como cero lo que está sin poner", () => {
  const meses = [1000, null, 500, null, null, null, null, null, null, null, null, null];
  assert.equal(sumaDe(meses), 1500);
  assert.equal(sumaDe(meses, TRIMESTRES[1].meses), 0);
});

test("no se compara contra un año anterior que no vendió nada", () => {
  assert.equal(variacionSobreAnterior(100_000, 80_000), 25);
  assert.equal(variacionSobreAnterior(80_000, 100_000), -20);
  // Ni «+100 %» sobre cero, ni porcentajes sacados de lo que aún no se sabe.
  assert.equal(variacionSobreAnterior(100_000, 0), null);
  assert.equal(variacionSobreAnterior(100_000, null), null);
});
