import { test } from "node:test";
import assert from "node:assert/strict";
import { construirPregunta, esquemaDeLectura, limpiarLectura, TODAS_LAS_MARCAS, type LecturaDeLaIa } from "../src/lib/agencia-lector.ts";
import { partidasQueSeSolapan, type PartidaDeAgencia } from "../src/lib/agencia.ts";

const marcas = [{ id: "u-intec", name: "Suministros Intec" }, { id: "u-sumi", name: "Sumifluid" }];
const partida = (cambios: Partial<LecturaDeLaIa["partidas"][number]> = {}): LecturaDeLaIa["partidas"][number] => ({
  marca: "Suministros Intec", concepto: "SEO", importe_mensual: 450, una_vez: false, desde: "2026-11", hasta: null, notas: null, de_donde: "Hoja 1, fila 4",
  ...cambios,
});

test("la pregunta lleva nuestras marcas, nuestros conceptos y la fecha de hoy", () => {
  const pregunta = construirPregunta({ marcas: marcas.map((marca) => marca.name), conceptos: ["SEO", "SEM (gestión)"], hoy: "2026-10-29", archivo: "presupuesto.xlsx" });
  assert.match(pregunta, /«Suministros Intec», «Sumifluid»/);
  assert.match(pregunta, /«SEO», «SEM \(gestión\)»/);
  assert.match(pregunta, /Hoy es 2026-10-29/);
  assert.match(pregunta, /usa 2026-10 y dilo en avisos/);
  assert.match(pregunta, new RegExp(TODAS_LAS_MARCAS));
});

test("el esquema solo admite nuestras marcas o «todas»", () => {
  const esquema = esquemaDeLectura(marcas.map((marca) => marca.name));
  const base = { resumen: "", avisos: [], partidas: [partida()] };
  assert.equal(esquema.safeParse(base).success, true);
  assert.equal(esquema.safeParse({ ...base, partidas: [partida({ marca: TODAS_LAS_MARCAS })] }).success, true);
  assert.equal(esquema.safeParse({ ...base, partidas: [partida({ marca: "Intec" })] }).success, false);
});

test("las partidas válidas pasan con la marca del Hub y el importe redondeado", () => {
  const { partidas, avisos } = limpiarLectura({
    resumen: " Presupuesto 2026 ",
    avisos: [],
    partidas: [
      partida({ importe_mensual: 450.004, notas: "  Incluye 20 palabras clave " }),
      partida({ marca: TODAS_LAS_MARCAS, concepto: "  Informes   y consultoría ", importe_mensual: 100, desde: "2026-11", hasta: "2027-10" }),
      partida({ marca: "Sumifluid", concepto: "Web", importe_mensual: 3000, una_vez: true, desde: "2026-12", hasta: "2027-05" }),
    ],
  }, marcas);
  assert.deepEqual(avisos, []);
  assert.deepEqual(partidas, [
    { businessUnitId: "u-intec", concept: "SEO", monthlyAmount: 450, startMonth: "2026-11", endMonth: null, notes: "Incluye 20 palabras clave", deDonde: "Hoja 1, fila 4" },
    { businessUnitId: null, concept: "Informes y consultoría", monthlyAmount: 100, startMonth: "2026-11", endMonth: "2027-10", notes: null, deDonde: "Hoja 1, fila 4" },
    // Una sola vez: acaba el mismo mes que empieza, diga lo que diga «hasta».
    { businessUnitId: "u-sumi", concept: "Web", monthlyAmount: 3000, startMonth: "2026-12", endMonth: "2026-12", notes: null, deDonde: "Hoja 1, fila 4" },
  ]);
});

test("lo que no se sostiene no se propone y queda dicho en los avisos", () => {
  const { partidas, avisos } = limpiarLectura({
    resumen: "",
    avisos: ["El IVA no viene separado"],
    partidas: [
      partida({ concepto: "  " }),
      partida({ concepto: "SEM (gestión)", importe_mensual: -5 }),
      partida({ concepto: "Contenidos", desde: "noviembre" }),
      partida({ concepto: "Web", desde: "2026-11", hasta: "2026-13" }),
      partida({ concepto: "Google Ads (inversión)", desde: "2027-03", hasta: "2027-01" }),
      partida({ concepto: "Cero", importe_mensual: 0 }),
    ],
  }, marcas);
  assert.deepEqual(partidas, []);
  assert.deepEqual(avisos, [
    "El IVA no viene separado",
    "Se ha quitado una partida sin concepto.",
    "Se ha quitado «SEM (gestión)»: el importe no es válido.",
    "Se ha quitado «Contenidos»: no se entiende desde o hasta qué mes va.",
    "Se ha quitado «Web»: no se entiende desde o hasta qué mes va.",
    "Se ha quitado «Google Ads (inversión)»: acaba antes de empezar.",
  ]);
});

test("una partida nueva se solapa con la que ya hay de la misma marca y concepto en algún mes", () => {
  const ya: PartidaDeAgencia[] = [
    { id: "1", businessUnitId: "u-intec", concept: "SEO", monthlyAmount: 400, startMonth: "2026-01", endMonth: "2026-12", notes: null },
    { id: "2", businessUnitId: "u-intec", concept: "Web", monthlyAmount: 3000, startMonth: "2026-06", endMonth: "2026-06", notes: null },
    { id: "3", businessUnitId: null, concept: "SEO", monthlyAmount: 50, startMonth: "2026-01", endMonth: null, notes: null },
  ];
  const ids = (nueva: Parameters<typeof partidasQueSeSolapan>[0]) => partidasQueSeSolapan(nueva, ya).map((partida) => partida.id);
  assert.deepEqual(ids({ businessUnitId: "u-intec", concept: " seo ", startMonth: "2026-11", endMonth: null }), ["1"]);
  assert.deepEqual(ids({ businessUnitId: "u-intec", concept: "SEO", startMonth: "2027-01", endMonth: null }), []);
  assert.deepEqual(ids({ businessUnitId: "u-intec", concept: "Web", startMonth: "2026-07", endMonth: "2026-07" }), []);
  assert.deepEqual(ids({ businessUnitId: null, concept: "SEO", startMonth: "2030-01", endMonth: "2030-01" }), ["3"]);
});
