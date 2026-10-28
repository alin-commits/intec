import { test } from "node:test";
import assert from "node:assert/strict";
import { externasDelFiltro, externasPorMes, type VentaDeFuera } from "../src/lib/sales-model.ts";

/*
  Las ventas que no pasaron por Sage: empresas del grupo que se llevaron
  fuera hasta que entraron. Jender hasta octubre de 2025; Blizcool todavía,
  y por eso no tiene sociedad.
*/
const FILAS: VentaDeFuera[] = [
  { month: "2025-01-01", company_code: 2, net_amount: 9604 },
  { month: "2025-02-01", company_code: 2, net_amount: 33753 },
  { month: "2025-02-01", company_code: 2, net_amount: 1000 },
  { month: "2026-02-01", company_code: null, net_amount: 25000 },
];

test("sin filtro de sociedad cuentan todas, también la que no tiene sociedad", () => {
  assert.equal(externasDelFiltro(FILAS, []).length, 4);
});

/*
  Lo que esto evita: con Sumifluid marcada, su cifra llevaba dentro lo de
  Jender, y el total no cuadraba con nada.
*/
test("con una sociedad marcada solo cuentan las suyas", () => {
  const soloJender = externasDelFiltro(FILAS, [2]);
  assert.equal(soloJender.length, 3);
  assert.ok(soloJender.every((f) => f.company_code === 2));
});

test("la empresa sin sociedad desaparece al mirar una concreta", () => {
  // Blizcool no está en Sage, así que no se la puede colgar de ninguna.
  assert.equal(externasDelFiltro(FILAS, [1]).length, 0);
  assert.equal(externasDelFiltro(FILAS, [2]).some((f) => f.company_code === null), false);
});

test("por mes se suma lo del mismo mes y la clave es YYYY-MM", () => {
  const mapa = externasPorMes(FILAS, []);
  assert.equal(mapa.get("2025-01"), 9604);
  assert.equal(mapa.get("2025-02"), 34753, "dos cifras del mismo mes se suman");
  assert.equal(mapa.get("2026-02"), 25000);
  assert.equal(mapa.get("2025-03"), undefined, "un mes sin nada no inventa un cero");
});

test("el filtro de sociedad también manda en el reparto por meses", () => {
  const mapa = externasPorMes(FILAS, [2]);
  assert.equal(mapa.get("2026-02"), undefined, "Blizcool no es de la sociedad 2");
  assert.equal(mapa.get("2025-02"), 34753);
});

test("sin filas, un mapa vacío y no un error", () => {
  assert.equal(externasPorMes([], []).size, 0);
  assert.equal(externasDelFiltro([], [1, 2]).length, 0);
});
