import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRepIdentities, externasDelFiltro, externasPorMes, makeRepOf, noFilters, type Rep, type SalesFilters, type VentaDeFuera } from "../src/lib/sales-model.ts";

const con = (patch: Partial<SalesFilters>): SalesFilters => ({ ...noFilters, ...patch });

/*
  Dos fichas con el mismo número en sociedades distintas: es justo por eso que
  la venta de fuera guarda la pareja y no el código suelto.
*/
const REPS: Rep[] = [
  { company_code: 2, code: 136, name: "Juana Pérez", is_person: true },
  { company_code: 1, code: 136, name: "Otra Persona", is_person: true },
];
const repOf = makeRepOf(REPS, buildRepIdentities(REPS));
const DE_ELLA = "JUANA PEREZ";

/*
  Las ventas que no pasaron por Sage: empresas del grupo que se llevaron
  fuera hasta que entraron. Jender hasta octubre de 2025; Blizcool todavía,
  y por eso no tiene sociedad.
*/
const FILAS: VentaDeFuera[] = [
  { month: "2025-01-01", company_code: 2, rep_code: 136, net_amount: 9604 },
  { month: "2025-02-01", company_code: 2, rep_code: 136, net_amount: 33753 },
  { month: "2025-02-01", company_code: 2, rep_code: 136, net_amount: 1000 },
  { month: "2026-02-01", company_code: null, rep_code: null, net_amount: 25000 },
];

test("sin filtro de sociedad cuentan todas, también la que no tiene sociedad", () => {
  assert.equal(externasDelFiltro(FILAS, noFilters, repOf).length, 4);
});

/*
  Lo que esto evita: con Sumifluid marcada, su cifra llevaba dentro lo de
  Jender, y el total no cuadraba con nada.
*/
test("con una sociedad marcada solo cuentan las suyas", () => {
  const soloJender = externasDelFiltro(FILAS, con({ companies: [2] }), repOf);
  assert.equal(soloJender.length, 3);
  assert.ok(soloJender.every((f) => f.company_code === 2));
});

test("la empresa sin sociedad desaparece al mirar una concreta", () => {
  // Blizcool no está en Sage, así que no se la puede colgar de ninguna.
  assert.equal(externasDelFiltro(FILAS, con({ companies: [1] }), repOf).length, 0);
  assert.equal(externasDelFiltro(FILAS, con({ companies: [2] }), repOf).some((f) => f.company_code === null), false);
});

test("por mes se suma lo del mismo mes y la clave es YYYY-MM", () => {
  const mapa = externasPorMes(FILAS, noFilters, repOf);
  assert.equal(mapa.get("2025-01"), 9604);
  assert.equal(mapa.get("2025-02"), 34753, "dos cifras del mismo mes se suman");
  assert.equal(mapa.get("2026-02"), 25000);
  assert.equal(mapa.get("2025-03"), undefined, "un mes sin nada no inventa un cero");
});

test("el filtro de sociedad también manda en el reparto por meses", () => {
  const mapa = externasPorMes(FILAS, con({ companies: [2] }), repOf);
  assert.equal(mapa.get("2026-02"), undefined, "Blizcool no es de la sociedad 2");
  assert.equal(mapa.get("2025-02"), 34753);
});

test("sin filas, un mapa vacío y no un error", () => {
  assert.equal(externasPorMes([], noFilters, repOf).size, 0);
  assert.equal(externasDelFiltro([], con({ companies: [1, 2] }), repOf).length, 0);
});

/*
  El fallo que esto cierra: de estas cifras solo se sabe el mes y la sociedad.
  Con un comercial marcado se le sumaban igual, así que los 253.264 € de
  Blizcool de 2026 aparecían dentro del año de cada comercial del grupo.
*/
test("con un canal, una familia o un proveedor marcado no se suma nada", () => {
  // Eso no existe detrás de una suma al mes por empresa: repartirlo sería
  // inventárselo.
  for (const patch of [
    { channels: ["A"] },
    { families: ["11"] },
    { subfamilies: ["11:003"] },
    { suppliers: ["7"] },
  ] satisfies Partial<SalesFilters>[]) {
    assert.deepEqual(externasDelFiltro(FILAS, con(patch), repOf), [], JSON.stringify(patch));
    assert.equal(externasPorMes(FILAS, con(patch), repOf).size, 0, JSON.stringify(patch));
  }
});

/*
  Cada cifra va con su comercial: en el cuadro de dirección cada bloque tiene
  su agente, así que mirando a quien la vendió tiene que aparecer.
*/
test("con su comercial marcado, la cifra sigue sumando", () => {
  const suyas = externasDelFiltro(FILAS, con({ repKeys: [DE_ELLA] }), repOf);
  assert.equal(suyas.length, 3);
  assert.ok(suyas.every((f) => f.rep_code === 136));
  assert.equal(externasPorMes(FILAS, con({ repKeys: [DE_ELLA] }), repOf).get("2025-02"), 34753);
});

/*
  Y el fallo que esto cierra: se sumaban mirando solo la sociedad, así que los
  253.264 € de Blizcool de 2026 —que no tenía ni sociedad ni comercial—
  aparecían dentro del año de todos y cada uno de los comerciales.
*/
test("con otro comercial marcado no se le suma lo que no es suyo", () => {
  assert.deepEqual(externasDelFiltro(FILAS, con({ repKeys: ["OTRA PERSONA"] }), repOf), []);
  // El mismo número en otra sociedad no es la misma persona.
  assert.deepEqual(externasDelFiltro(FILAS, con({ companies: [1], repKeys: ["OTRA PERSONA"] }), repOf), []);
  // Y una cifra sin comercial no es de nadie: no entra en ninguna vista por persona.
  const sinNadie: VentaDeFuera[] = [{ month: "2026-02-01", company_code: null, rep_code: null, net_amount: 25000 }];
  assert.deepEqual(externasDelFiltro(sinNadie, con({ repKeys: [DE_ELLA] }), repOf), []);
});

/*
  Mientras la migración que añade la columna no esté puesta, las filas llegan
  sin ella: la cifra no puede ser de nadie, y lo que no puede pasar es que
  pase a ser de todos.
*/
test("una fila que llega sin comercial no suma en una vista por comercial", () => {
  const vieja = [{ month: "2025-01-01", company_code: 2, net_amount: 9604 }] satisfies VentaDeFuera[];
  assert.equal(externasDelFiltro(vieja, noFilters, repOf).length, 1, "en el total sí cuenta");
  assert.deepEqual(externasDelFiltro(vieja, con({ repKeys: [DE_ELLA] }), repOf), []);
});
