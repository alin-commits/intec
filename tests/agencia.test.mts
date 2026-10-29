import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cifrasDe,
  cuandoEs,
  gastoDelMes,
  invertidoEn,
  invertidoPorServicio,
  mesAMes,
  mesesDe,
  mesesDelAnio,
  porConcepto,
  retornoDe,
  servicioSugerido,
  type FilaDeConsultas,
  type PartidaDeAgencia,
} from "../src/lib/agencia.ts";

const partida = (businessUnitId: string | null, concept: string, monthlyAmount: number, startMonth: string, endMonth: string | null = null): PartidaDeAgencia =>
  ({ id: `${businessUnitId}-${concept}-${startMonth}`, businessUnitId, concept, service: servicioSugerido(concept), monthlyAmount, startMonth, endMonth, notes: null });

const fila = (month: string, unit: string, inquiries: number, won = 0, wonAmount = 0, offered = 0, offeredAmount = 0): FilaDeConsultas =>
  ({ month, business_unit_id: unit, inquiries, won, won_amount: wonAmount, offered, offered_amount: offeredAmount });

test("los meses: incluidos los dos extremos y cruzando de año", () => {
  assert.deepEqual(mesesDe("2026-11", "2027-02"), ["2026-11", "2026-12", "2027-01", "2027-02"]);
  assert.deepEqual(mesesDe("2026-05", "2026-05"), ["2026-05"]);
  assert.deepEqual(mesesDe("2026-06", "2026-05"), []);
});

test("el año en curso se cuenta hasta este mes; uno pasado o uno que viene, entero", () => {
  assert.equal(mesesDelAnio(2026, "2026-10-29").length, 10);
  assert.equal(mesesDelAnio(2025, "2026-10-29").length, 12);
  assert.equal(mesesDelAnio(2027, "2026-10-29").length, 12);
});

test("una partida cuesta solo dentro de sus meses; la de una vez, solo ese mes", () => {
  const seo = partida("intec", "SEO", 500, "2026-03");
  assert.equal(gastoDelMes(seo, "2026-02"), 0);
  assert.equal(gastoDelMes(seo, "2026-03"), 500);
  assert.equal(gastoDelMes(seo, "2030-01"), 500);
  const web = partida("intec", "Web", 3000, "2026-06", "2026-06");
  assert.equal(gastoDelMes(web, "2026-06"), 3000);
  assert.equal(gastoDelMes(web, "2026-07"), 0);
});

test("lo de todas las marcas sin repartir suma en el total, no en ninguna marca", () => {
  const partidas = [partida("intec", "SEO", 500, "2026-01"), partida(null, "Cuota", 200, "2026-01")];
  const meses = mesesDe("2026-01", "2026-03");
  assert.equal(invertidoEn(partidas, meses, "intec"), 1500);
  assert.equal(invertidoEn(partidas, meses, "todas"), 2100);
  assert.equal(invertidoEn(partidas, meses, "sumi"), 0);
});

test("las cifras se quedan con sus meses y su marca, y el retorno sale de ellas", () => {
  const partidas = [partida("intec", "SEO", 500, "2026-01"), partida("intec", "SEM (gestión)", 500, "2026-01")];
  const filas = [
    fila("2026-01", "intec", 10, 1, 1500),
    fila("2026-02", "intec", 10, 2, 2500, 3, 4000),
    fila("2026-02", "sumi", 7, 1, 900),
    fila("2026-04", "intec", 5, 1, 9999),
  ];
  const cifras = cifrasDe(partidas, filas, mesesDe("2026-01", "2026-02"), "intec");
  assert.deepEqual(cifras, { invertido: 2000, consultas: 20, ganadas: 3, vendido: 4000, ofertas: 3, ofertado: 4000 });
  const retorno = retornoDe(cifras);
  assert.equal(retorno.porEuro, 2);
  assert.equal(retorno.roi, 1);
  assert.equal(retorno.diferencia, 2000);
  assert.equal(retorno.costePorConsulta, 100);
  assert.equal(retorno.conversion, 0.15);
});

test("sin inversión no hay retorno que calcular, pero la diferencia sí se dice", () => {
  const retorno = retornoDe({ invertido: 0, consultas: 0, ganadas: 0, vendido: 800, ofertas: 0, ofertado: 0 });
  assert.equal(retorno.porEuro, null);
  assert.equal(retorno.roi, null);
  assert.equal(retorno.costePorConsulta, null);
  assert.equal(retorno.conversion, null);
  assert.equal(retorno.diferencia, 800);
});

test("mes a mes acumula lo invertido y lo vendido", () => {
  const partidas = [partida("intec", "SEO", 1000, "2026-01")];
  const filas = [fila("2026-01", "intec", 4, 0, 0), fila("2026-02", "intec", 6, 1, 2500)];
  const puntos = mesAMes(partidas, filas, mesesDe("2026-01", "2026-03"), "todas");
  assert.deepEqual(puntos.map((punto) => [punto.mes, punto.invertidoAcumulado, punto.vendidoAcumulado]), [
    ["2026-01", 1000, 0],
    ["2026-02", 2000, 2500],
    ["2026-03", 3000, 2500],
  ]);
});

test("por concepto: se juntan los que se escriben igual y se ordenan de más a menos", () => {
  const partidas = [
    partida("intec", "SEO", 300, "2026-01"),
    partida("sumi", " seo ", 200, "2026-01"),
    partida("intec", "Google Ads (inversión)", 900, "2026-01"),
    partida("intec", "Web", 3000, "2025-05", "2025-05"),
  ];
  assert.deepEqual(porConcepto(partidas, ["2026-01"], "todas"), [
    { concepto: "Google Ads (inversión)", importe: 900 },
    { concepto: "SEO", importe: 500 },
  ]);
  assert.deepEqual(porConcepto(partidas, ["2026-01"], "sumi"), [{ concepto: "seo", importe: 200 }]);
});

test("cuándo es una partida, dicho para personas", () => {
  const nombre = (mes: string) => mes;
  assert.equal(cuandoEs(partida("intec", "Web", 1, "2026-06", "2026-06"), nombre), "Solo en 2026-06");
  assert.equal(cuandoEs(partida("intec", "SEO", 1, "2026-01"), nombre), "Cada mes desde 2026-01");
  assert.equal(cuandoEs(partida("intec", "SEO", 1, "2026-01", "2026-06"), nombre), "Cada mes de 2026-01 a 2026-06");
});

test("el servicio que se propone por el concepto", () => {
  assert.equal(servicioSugerido("SEO"), "seo");
  assert.equal(servicioSugerido("Posicionamiento web (20 keywords)"), "seo");
  assert.equal(servicioSugerido("SEM (gestión)"), "sem");
  assert.equal(servicioSugerido("Google Ads (inversión)"), "sem");
  assert.equal(servicioSugerido("Campañas de búsqueda"), "sem");
  assert.equal(servicioSugerido("Web"), "otro");
  // «Ads» como palabra, no dentro de otra.
  assert.equal(servicioSugerido("Leads cualificados"), "otro");
});

test("lo invertido se reparte por servicio, y suma lo mismo que el total", () => {
  const partidas = [
    partida("intec", "SEO", 450, "2026-01"),
    partida("intec", "SEM (gestión)", 300, "2026-01"),
    partida("intec", "Google Ads (inversión)", 600, "2026-03"),
    partida("intec", "Web", 3000, "2026-02", "2026-02"),
    partida(null, "Informes y consultoría", 100, "2026-01"),
  ];
  const meses = ["2026-01", "2026-02", "2026-03"];
  const reparto = invertidoPorServicio(partidas, meses, "todas");
  assert.deepEqual(reparto, { seo: 1350, sem: 1500, otro: 3300 });
  assert.equal(reparto.seo + reparto.sem + reparto.otro, invertidoEn(partidas, meses, "todas"));
  assert.deepEqual(invertidoPorServicio(partidas, meses, "intec"), { seo: 1350, sem: 1500, otro: 3000 });
});
