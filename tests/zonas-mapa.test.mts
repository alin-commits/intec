import { test } from "node:test";
import assert from "node:assert/strict";
import { NOMBRES_DE_PROVINCIA, intensidadDeColor } from "../src/lib/zonas-mapa.ts";
import { MAPA_ALTO, MAPA_ANCHO, PROVINCIAS_SVG } from "../src/lib/zonas-svg.ts";

/*
  La guardia que importa: una provincia que falte en el mapa no da ningún
  error, simplemente no se dibuja. Nadie echa de menos Soria hasta que
  pregunta por qué no tiene clientes allí.

  Y como zonas-svg.ts es un fichero generado, esto es lo que avisa si alguien
  lo vuelve a generar con otra fuente y se deja provincias por el camino.
*/
test("el mapa trae las 52 provincias, una sola vez cada una", () => {
  assert.equal(PROVINCIAS_SVG.length, 52);
  const codigos = PROVINCIAS_SVG.map((p) => p.code);
  assert.equal(new Set(codigos).size, 52, "hay códigos repetidos");
  for (let n = 1; n <= 52; n++) {
    const code = String(n).padStart(2, "0");
    assert.ok(codigos.includes(code), `falta la provincia ${code} en el mapa`);
  }
});

test("cada trazado del mapa tiene su nombre", () => {
  for (const p of PROVINCIAS_SVG) {
    assert.ok(NOMBRES_DE_PROVINCIA[p.code], `la provincia ${p.code} no tiene nombre`);
  }
  assert.equal(Object.keys(NOMBRES_DE_PROVINCIA).length, 52);
});

test("ningún trazado está vacío ni se sale del lienzo", () => {
  for (const p of PROVINCIAS_SVG) {
    assert.ok(p.d.startsWith("M"), `${p.code} no empieza por un movimiento`);
    assert.ok(p.d.endsWith("Z"), `${p.code} no cierra su contorno`);
    assert.ok(p.d.length > 40, `${p.code} tiene un contorno sospechosamente corto`);
    for (const par of p.d.matchAll(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)) {
      const x = Number(par[1]), y = Number(par[2]);
      assert.ok(x >= -1 && x <= MAPA_ANCHO + 1, `${p.code} se sale por x=${x}`);
      assert.ok(y >= -1 && y <= MAPA_ALTO + 1, `${p.code} se sale por y=${y}`);
    }
  }
});

/*
  Canarias va en su recuadro, abajo a la izquierda. Si alguien regenera el
  mapa y se le olvida moverla, las islas se van a 1.000 km al suroeste y el
  lienzo se llena de mar: se nota porque el mapa se vuelve mucho más ancho.
*/
test("el lienzo tiene una forma razonable para España con Canarias recuadrada", () => {
  const proporcion = MAPA_ANCHO / MAPA_ALTO;
  assert.ok(proporcion > 0.8 && proporcion < 1.6, `proporción rara: ${proporcion.toFixed(2)}`);
});

test("el color sube con el valor, y nada se queda fuera de 0 a 1", () => {
  assert.equal(intensidadDeColor(0, 100), 0, "sin clientes, sin color");
  assert.equal(intensidadDeColor(100, 100), 1, "el máximo, del todo");
  assert.ok(intensidadDeColor(50, 100) > intensidadDeColor(10, 100));
  // Lo que motiva la raíz: con cinco clientes de 1.208 se tiene que notar algo.
  assert.ok(intensidadDeColor(5, 1208) > 0.06, "cinco clientes no pueden salir en blanco");
  assert.ok(intensidadDeColor(200, 100) <= 1, "nunca se pasa de 1");
});

test("un dato que no es un número no rompe el mapa", () => {
  assert.equal(intensidadDeColor(Number.NaN, 100), 0);
  assert.equal(intensidadDeColor(10, 0), 0);
  assert.equal(intensidadDeColor(-5, 100), 0);
});
