import { test } from "node:test";
import assert from "node:assert/strict";
import { estadoDeLaLectura } from "../src/lib/sage-lectura.ts";

// 09:46 UTC del 30/10/2026 son las 10:46 en Madrid (ya en horario de invierno).
const LEIDA = "2026-10-30T09:46:00Z";
const a = (iso: string) => Date.parse(iso);

test("lo reciente se dice en minutos", () => {
  assert.equal(estadoDeLaLectura(LEIDA, a("2026-10-30T09:47:00Z")).texto, "hace un momento");
  assert.equal(estadoDeLaLectura(LEIDA, a("2026-10-30T09:58:00Z")).texto, "hace 12 min");
  assert.equal(estadoDeLaLectura(LEIDA, a("2026-10-30T10:45:00Z")).texto, "hace 59 min");
});

test("el mismo día, en horas; el anterior, ayer; antes, con su fecha, y siempre en hora de Madrid", () => {
  assert.equal(estadoDeLaLectura(LEIDA, a("2026-10-30T13:00:00Z")).texto, "hace 3 h");
  assert.equal(estadoDeLaLectura(LEIDA, a("2026-10-31T08:00:00Z")).texto, "ayer a las 10:46");
  assert.equal(estadoDeLaLectura(LEIDA, a("2026-11-02T08:00:00Z")).texto, "el 30/10 a las 10:46");
  // Las 23:46 de Madrid son las 22:46 UTC: sigue siendo el mismo día allí.
  assert.equal(estadoDeLaLectura("2026-10-29T22:46:00Z", a("2026-10-30T07:00:00Z")).texto, "ayer a las 23:46");
});

test("está atrasada cuando pasan más de dos horas, que es saltarse una pasada", () => {
  assert.equal(estadoDeLaLectura(LEIDA, a("2026-10-30T10:50:00Z")).atrasada, false, "una hora y poco es lo normal");
  assert.equal(estadoDeLaLectura(LEIDA, a("2026-10-30T11:46:00Z")).atrasada, false);
  assert.equal(estadoDeLaLectura(LEIDA, a("2026-10-30T11:47:00Z")).atrasada, true);
});

test("la hora exacta lleva el día de la semana y la hora de Madrid", () => {
  const { exacta } = estadoDeLaLectura(LEIDA, a("2026-10-30T10:00:00Z"));
  assert.match(exacta, /viernes/);
  assert.match(exacta, /30\/10\/2026/);
  assert.match(exacta, /10:46/);
});

test("un reloj algo atrasado no da minutos negativos", () => {
  assert.equal(estadoDeLaLectura(LEIDA, a("2026-10-30T09:45:00Z")).texto, "hace un momento");
});
