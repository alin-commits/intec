import { test } from "node:test";
import assert from "node:assert/strict";
import { autoresVistos, origenDelAutor, repartirAutores, sugerirComercial, type FilaDeAutor } from "../src/lib/autores-albaran.ts";
import type { RepIdentity } from "../src/lib/sales-model.ts";

// Nombres inventados. Fichas: sociedad 1, comerciales 10 (Pablo), 11 (Ana) y 99 (GENERAL, comodín).
const fichas: Record<number, RepIdentity> = {
  10: { key: "PABLO SOLIS IBARRA", label: "Pablo Solís Ibarra", assigned: true, isPerson: true },
  11: { key: "ANA BELTRAN ROCA", label: "Ana Beltrán Roca", assigned: true, isPerson: true },
  99: { key: "GENERAL", label: "GENERAL", assigned: true, isPerson: false },
};
const repOf = (_company: number, code: number | null): RepIdentity =>
  code === null ? { key: "sin", label: "Sin comercial asignado", assigned: false, isPerson: false } : fichas[code];
const nombreDe = (key: string) => Object.values(fichas).find((ficha) => ficha.key === key)?.label ?? key;

const fila = (author: string, rep: number | null, documents: number, net = documents * 100, name = author): FilaDeAutor =>
  ({ month: "2026-09", company_code: 1, author, author_name: name, rep_code: rep, documents, net_amount: net });

test("lo que hace un comercial se reparte entre lo suyo, lo de otros y lo sin comercial", () => {
  const reparto = repartirAutores(
    [fila("u:24", 10, 30), fila("u:24", 11, 12), fila("u:24", null, 3), fila("u:24", 99, 2)],
    [{ author: "u:24", rep_key: "PABLO SOLIS IBARRA", is_office: false }],
    repOf, nombreDe,
  );
  // Pablo, que los hace, y Ana, que tiene doce en su facturación sin hacer ninguno.
  assert.deepEqual(reparto.comerciales.map((fila) => fila.label), ["Pablo Solís Ibarra", "Ana Beltrán Roca"]);
  const [pablo, ana] = reparto.comerciales;
  assert.deepEqual(pablo.hechos, { documentos: 47, neto: 4700 });
  assert.deepEqual(pablo.propios, { documentos: 30, neto: 3000 });
  assert.deepEqual(pablo.paraOtros, { documentos: 12, neto: 1200 });
  // Sin comercial y el comodín no se le quitan a nadie: van aparte.
  assert.deepEqual(pablo.sinComercial, { documentos: 5, neto: 500 });
  assert.deepEqual(pablo.aQuien.map((destino) => [destino.label, destino.documentos]), [["Ana Beltrán Roca", 12]]);
  // En su facturación, solo lo suyo: lo de sin comercial y el comodín no es de nadie.
  assert.deepEqual(pablo.enSuFacturacion, { documentos: 30, neto: 3000 });
  assert.deepEqual(pablo.hechosPorOtros, { documentos: 0, neto: 0 });
  assert.deepEqual(ana.hechos, { documentos: 0, neto: 0 });
  assert.deepEqual(ana.enSuFacturacion, { documentos: 12, neto: 1200 });
  assert.deepEqual(ana.hechosPorOtros, { documentos: 12, neto: 1200 });
  assert.deepEqual(ana.deQuien.map((origen) => [origen.label, origen.documentos]), [["Pablo Solís Ibarra", 12]]);
});

test("dos usuarios de Sage de la misma persona suman en una sola fila", () => {
  const reparto = repartirAutores(
    [fila("u:24", 11, 4), fila("t:1:150", 11, 6)],
    [
      { author: "u:24", rep_key: "PABLO SOLIS IBARRA", is_office: false },
      { author: "t:1:150", rep_key: "PABLO SOLIS IBARRA", is_office: false },
    ],
    repOf, nombreDe,
  );
  const pablo = reparto.comerciales.find((fila) => fila.key === "PABLO SOLIS IBARRA");
  assert.equal(pablo?.paraOtros.documentos, 10);
  assert.deepEqual(pablo?.aQuien.map((destino) => destino.documentos), [10]);
});

test("la oficina, los autores sin decir y los albaranes sin autor van cada uno a su sitio", () => {
  const reparto = repartirAutores(
    [fila("u:3", 10, 8), fila("u:3", null, 2), fila("u:40", 11, 5, 500, "MOSTRADOR2"), fila("desconocido", 10, 7)],
    [{ author: "u:3", rep_key: null, is_office: true }],
    repOf, nombreDe,
  );
  // Nadie es autor asignado, pero los dos tienen albaranes en su facturación.
  const pablo = reparto.comerciales.find((fila) => fila.key === "PABLO SOLIS IBARRA");
  const ana = reparto.comerciales.find((fila) => fila.key === "ANA BELTRAN ROCA");
  assert.deepEqual(pablo?.hechos, { documentos: 0, neto: 0 });
  // Ocho de oficina y siete sin usuario: los de oficina se los hizo otro; los sin usuario no se sabe.
  assert.deepEqual(pablo?.enSuFacturacion, { documentos: 15, neto: 1500 });
  assert.deepEqual(pablo?.hechosPorOtros, { documentos: 8, neto: 800 });
  assert.deepEqual(pablo?.deQuien.map((origen) => [origen.label, origen.documentos]), [["Oficina y tienda", 8]]);
  // Los de un usuario sin decir quién es tampoco cuentan como hechos por otro.
  assert.deepEqual(ana?.enSuFacturacion, { documentos: 5, neto: 500 });
  assert.deepEqual(ana?.hechosPorOtros, { documentos: 0, neto: 0 });
  assert.deepEqual(reparto.oficina.hechos, { documentos: 10, neto: 1000 });
  assert.deepEqual(reparto.oficina.aComerciales, { documentos: 8, neto: 800 });
  assert.deepEqual(reparto.oficina.sinComercial, { documentos: 2, neto: 200 });
  assert.deepEqual(reparto.sinDecir, [{ author: "u:40", nombre: "MOSTRADOR2", documentos: 5, neto: 500 }]);
  assert.deepEqual(reparto.sinAutor, { documentos: 7, neto: 700 });
  // El total es todo, también lo que no se sabe de quién es.
  assert.equal(reparto.total.documentos, 22);
});

test("los autores vistos no incluyen el «sin autor», que no se puede asignar", () => {
  const vistos = autoresVistos([fila("u:24", 10, 3), fila("u:24", 11, 2), fila("desconocido", 10, 9), fila("u:7", 10, 1)]);
  assert.deepEqual(vistos.map((autor) => [autor.author, autor.documentos]), [["u:24", 5], ["u:7", 1]]);
});

test("de dónde sale cada autor, dicho para personas", () => {
  assert.equal(origenDelAutor("u:25"), "Usuario 25 de Sage");
  assert.equal(origenDelAutor("t:1:150"), "TPV de la sociedad 1, operador 150");
});

test("la propuesta de comercial: por palabra entera, por apellido dentro del usuario, y nunca en un empate", () => {
  const personas = [
    { key: "PABLO SOLIS IBARRA", label: "Pablo Solís Ibarra" },
    { key: "ANA BELTRAN ROCA", label: "Ana Beltrán Roca" },
    { key: "ANA MARIA GIL", label: "Ana María Gil" },
  ];
  assert.equal(sugerirComercial("Pablo", personas)?.key, "PABLO SOLIS IBARRA");
  assert.equal(sugerirComercial("PSOLIS", personas)?.key, "PABLO SOLIS IBARRA");
  assert.equal(sugerirComercial("abeltran", personas)?.key, "ANA BELTRAN ROCA");
  assert.equal(sugerirComercial("Ana", personas), null);
  assert.equal(sugerirComercial("ADMIN", personas), null);
  assert.equal(sugerirComercial("", personas), null);
});
