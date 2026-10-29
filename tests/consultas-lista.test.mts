import { test } from "node:test";
import assert from "node:assert/strict";
import { filtrarConsultas, hayFiltrosPuestos, listaDeConsultas, ordenarConsultas, type ComoSeOrdena, type FiltrosDeConsultas, type NombresYValores } from "../src/lib/consultas-lista.ts";
import type { InquiryRecord } from "../src/lib/types.ts";

const SIN_FILTROS: FiltrosDeConsultas = { texto: "", marca: "all", canal: "all", estado: "all", comercial: "all" };

const MARCAS: Record<string, string> = { u1: "Sumifluid", u2: "Suministros Intec" };
const nombres: NombresYValores = {
  marcaDe: (id) => MARCAS[id] ?? "",
  canalDe: (canal) => ({ phone: "Teléfono", chat: "Chat", email_form: "Email/Formulario", whatsapp: "Whatsapp", portal_rrss: "Portal/RRSS" }[canal] ?? canal),
  estadoDe: (estado) => ({ contactado: "Contactado", ganado: "Ganado", perdido: "Perdido" }[estado] ?? estado),
  comercialDe: (id) => (id ? PERSONAS[id] ?? "" : ""),
  valorDe: (record) => VALORES[record.id] ?? 0,
};
const VALORES: Record<string, number> = {};
// Nombres inventados.
const PERSONAS: Record<string, string> = { p1: "Pablo Solís", p2: "Ana Beltrán" };

function consulta(partes: Partial<InquiryRecord> & { id: string }): InquiryRecord {
  return {
    businessUnitId: "u1",
    inquiryType: "phone",
    entryMode: "single",
    weekStart: null,
    count: 1,
    createdAt: "2026-10-27T10:00:00.000Z",
    status: "contactado",
    ...partes,
  } as InquiryRecord;
}

test("el buscador mira todos los campos de la ficha, sin distinguir mayúsculas", () => {
  const filas = [
    consulta({ id: "a", contactName: "Ana Deprueba" }),
    consulta({ id: "b", companyName: "Empresa de Ejemplo S.L." }),
    consulta({ id: "c", productInterest: "Bomba de ejemplo con racor" }),
    consulta({ id: "d", contactName: "Nadie" }),
  ];
  assert.deepEqual(filtrarConsultas(filas, { ...SIN_FILTROS, texto: "deprueba" }).map((f) => f.id), ["a"]);
  assert.deepEqual(filtrarConsultas(filas, { ...SIN_FILTROS, texto: "EMPRESA DE EJ" }).map((f) => f.id), ["b"]);
  assert.deepEqual(filtrarConsultas(filas, { ...SIN_FILTROS, texto: "racor" }).map((f) => f.id), ["c"]);
  assert.equal(filtrarConsultas(filas, { ...SIN_FILTROS, texto: "   " }).length, 4, "en blanco no filtra nada");
});

test("cada filtro de cabecera se queda con lo suyo", () => {
  const filas = [
    consulta({ id: "a", businessUnitId: "u1", inquiryType: "phone", createdBy: "p1" }),
    consulta({ id: "b", businessUnitId: "u2", inquiryType: "whatsapp", createdBy: "p2" }),
    consulta({ id: "c", businessUnitId: "u2", inquiryType: "phone", entryMode: "weekly", count: 7, status: undefined, createdBy: "p1" }),
  ];
  assert.deepEqual(filtrarConsultas(filas, { ...SIN_FILTROS, marca: "u2" }).map((f) => f.id), ["b", "c"]);
  assert.deepEqual(filtrarConsultas(filas, { ...SIN_FILTROS, canal: "whatsapp" }).map((f) => f.id), ["b"]);
  // Quién la añadió: las suyas, individuales y semanales.
  assert.deepEqual(filtrarConsultas(filas, { ...SIN_FILTROS, comercial: "p1" }).map((f) => f.id), ["a", "c"]);
  assert.deepEqual(filtrarConsultas(filas, { ...SIN_FILTROS, comercial: "p2" }).map((f) => f.id), ["b"]);
});

/*
  La esquina que importa: un recuento semanal no tiene estado, así que pedir
  un estado tiene que dejarlo fuera. Si no, buscar las ganadas devolvía
  también las semanales, que no son ni ganadas ni perdidas: son una cifra.
*/
test("filtrar por estado deja fuera los recuentos semanales", () => {
  const filas = [
    consulta({ id: "a", status: "ganado" }),
    consulta({ id: "b", status: "perdido" }),
    consulta({ id: "c", entryMode: "weekly", count: 9, status: undefined }),
  ];
  assert.deepEqual(filtrarConsultas(filas, { ...SIN_FILTROS, estado: "ganado" }).map((f) => f.id), ["a"]);
  assert.deepEqual(filtrarConsultas(filas, { ...SIN_FILTROS, estado: "contactado" }).map((f) => f.id), [],
    "la semanal no cuenta como «contactado» aunque no tenga estado");
  assert.equal(filtrarConsultas(filas, SIN_FILTROS).length, 3, "sin filtro de estado sí sale");
});

test("una consulta sin estado guardado cuenta como contactada", () => {
  const filas = [consulta({ id: "a", status: undefined })];
  assert.deepEqual(filtrarConsultas(filas, { ...SIN_FILTROS, estado: "contactado" }).map((f) => f.id), ["a"]);
});

test("ordena por lo que se lee, no por el código de debajo", () => {
  const filas = [
    consulta({ id: "a", businessUnitId: "u2" }),
    consulta({ id: "b", businessUnitId: "u1" }),
  ];
  const asc: ComoSeOrdena = { columna: "unidad", desc: false };
  assert.deepEqual(ordenarConsultas(filas, asc, nombres).map((f) => f.id), ["b", "a"], "Sumifluid antes que Suministros Intec");
  assert.deepEqual(ordenarConsultas(filas, { ...asc, desc: true }, nombres).map((f) => f.id), ["a", "b"]);
});

test("por quién la añadió ordena por su nombre", () => {
  const filas = [consulta({ id: "a", createdBy: "p1" }), consulta({ id: "b", createdBy: "p2" }), consulta({ id: "c", createdBy: null })];
  // Sin nombre va primero en orden ascendente: la cadena vacía.
  assert.deepEqual(ordenarConsultas(filas, { columna: "comercial", desc: false }, nombres).map((f) => f.id), ["c", "b", "a"], "Ana antes que Pablo");
});

test("por cantidad y por valor ordena por número, no por texto", () => {
  VALORES.a = 90; VALORES.b = 1000; VALORES.c = 200;
  const filas = [consulta({ id: "a", count: 9 }), consulta({ id: "b", count: 100 }), consulta({ id: "c", count: 20 })];
  assert.deepEqual(ordenarConsultas(filas, { columna: "cantidad", desc: false }, nombres).map((f) => f.id), ["a", "c", "b"]);
  assert.deepEqual(ordenarConsultas(filas, { columna: "valor", desc: true }, nombres).map((f) => f.id), ["b", "c", "a"]);
});

/*
  Dos consultas del mismo día no pueden bailar de sitio entre repintados: la
  fila que ibas a pulsar se movería sola.
*/
test("a igualdad, el orden es siempre el mismo", () => {
  const mismaFecha = "2026-10-27T09:00:00.000Z";
  const filas = [
    consulta({ id: "c3", createdAt: mismaFecha }),
    consulta({ id: "c1", createdAt: mismaFecha }),
    consulta({ id: "c2", createdAt: mismaFecha }),
  ];
  const orden: ComoSeOrdena = { columna: "fecha", desc: false };
  const primera = ordenarConsultas(filas, orden, nombres).map((f) => f.id);
  const segunda = ordenarConsultas(filas.slice().reverse(), orden, nombres).map((f) => f.id);
  assert.deepEqual(primera, ["c1", "c2", "c3"]);
  assert.deepEqual(segunda, primera, "da igual en qué orden lleguen");
  assert.deepEqual(ordenarConsultas(filas, { ...orden, desc: true }, nombres).map((f) => f.id), ["c3", "c2", "c1"],
    "y al invertir, la lista queda exactamente del revés");
});

test("ordenar no toca la lista que recibe", () => {
  const filas = [consulta({ id: "b" }), consulta({ id: "a" })];
  const copia = filas.map((f) => f.id);
  ordenarConsultas(filas, { columna: "contacto", desc: false }, nombres);
  assert.deepEqual(filas.map((f) => f.id), copia);
});

test("filtrar y ordenar de una vez hace las dos cosas", () => {
  const filas = [
    consulta({ id: "a", businessUnitId: "u2", count: 5 }),
    consulta({ id: "b", businessUnitId: "u2", count: 1 }),
    consulta({ id: "c", businessUnitId: "u1", count: 9 }),
  ];
  const salida = listaDeConsultas(filas, { ...SIN_FILTROS, marca: "u2" }, { columna: "cantidad", desc: true }, nombres);
  assert.deepEqual(salida.map((f) => f.id), ["a", "b"]);
});

test("el buscador no cuenta como filtro puesto: se ve solo", () => {
  assert.equal(hayFiltrosPuestos(SIN_FILTROS), false);
  assert.equal(hayFiltrosPuestos({ ...SIN_FILTROS, texto: "ana" }), false);
  assert.equal(hayFiltrosPuestos({ ...SIN_FILTROS, marca: "u1" }), true);
  assert.equal(hayFiltrosPuestos({ ...SIN_FILTROS, estado: "ganado" }), true);
  assert.equal(hayFiltrosPuestos({ ...SIN_FILTROS, comercial: "p1" }), true);
});
