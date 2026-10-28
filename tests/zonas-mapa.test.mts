import { test } from "node:test";
import assert from "node:assert/strict";
import { COLUMNAS_DEL_MAPA, CUADRICULA_DE_ESPANA, intensidadDeColor } from "../src/lib/zonas-mapa.ts";

/*
  La guardia que importa: una provincia que falte en la cuadrícula no da ningún
  error, simplemente no se dibuja. Nadie echa de menos Soria en un mapa hasta
  que alguien pregunta por qué no tiene clientes allí.
*/
test("están las 52 provincias, una sola vez cada una", () => {
  assert.equal(CUADRICULA_DE_ESPANA.length, 52);
  const codigos = CUADRICULA_DE_ESPANA.map((casilla) => casilla.code);
  assert.equal(new Set(codigos).size, 52, "hay códigos repetidos");
  for (let n = 1; n <= 52; n++) {
    const code = String(n).padStart(2, "0");
    assert.ok(codigos.includes(code), `falta la provincia ${code}`);
  }
});

test("ninguna casilla se pisa con otra", () => {
  const sitios = CUADRICULA_DE_ESPANA.map((casilla) => `${casilla.col}x${casilla.fila}`);
  assert.equal(new Set(sitios).size, sitios.length, "dos provincias en la misma casilla");
});

test("ninguna casilla se sale de la rejilla", () => {
  for (const casilla of CUADRICULA_DE_ESPANA) {
    assert.ok(casilla.col >= 1 && casilla.col <= COLUMNAS_DEL_MAPA, `${casilla.code} fuera por la columna ${casilla.col}`);
    assert.ok(casilla.fila >= 1, `${casilla.code} fuera por la fila ${casilla.fila}`);
  }
});

test("las siglas no se repiten: son lo único que se lee en el mapa", () => {
  const siglas = CUADRICULA_DE_ESPANA.map((casilla) => casilla.corto);
  assert.equal(new Set(siglas).size, siglas.length);
});

test("el color sube con el valor, y nada se queda fuera de 0 a 1", () => {
  assert.equal(intensidadDeColor(0, 100), 0, "sin clientes, sin color");
  assert.equal(intensidadDeColor(100, 100), 1, "el máximo, del todo");
  assert.ok(intensidadDeColor(50, 100) > intensidadDeColor(10, 100));
  // Lo que motiva la raíz: con cinco clientes de 2.658 se tiene que notar algo.
  assert.ok(intensidadDeColor(5, 2658) > 0.04, "cinco clientes no pueden salir en blanco");
  assert.ok(intensidadDeColor(200, 100) <= 1, "nunca se pasa de 1");
});

test("un dato que no es un número no rompe el mapa", () => {
  assert.equal(intensidadDeColor(Number.NaN, 100), 0);
  assert.equal(intensidadDeColor(10, 0), 0);
  assert.equal(intensidadDeColor(-5, 100), 0);
});
