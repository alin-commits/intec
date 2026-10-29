import { test } from "node:test";
import assert from "node:assert/strict";
import { strToU8, zipSync } from "fflate";
import { _columnas, xlsxATexto } from "../src/lib/xlsx-a-texto.ts";

/** Un .xlsx mínimo, con lo que guarda Excel de verdad: textos compartidos, estilos y relaciones. */
function excel(hojas: { nombre: string; xml: string; oculta?: boolean }[], compartidos: string[], estilos: string) {
  const ficheros: Record<string, Uint8Array> = {
    "xl/workbook.xml": strToU8(`<?xml version="1.0"?><workbook xmlns:r="r"><sheets>${hojas.map((hoja, indice) =>
      `<sheet name="${hoja.nombre}" sheetId="${indice + 1}"${hoja.oculta ? " state=\"hidden\"" : ""} r:id="rId${indice + 1}"/>`).join("")}</sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<Relationships>${hojas.map((_, indice) =>
      `<Relationship Id="rId${indice + 1}" Type="worksheet" Target="worksheets/sheet${indice + 1}.xml"/>`).join("")}</Relationships>`),
    "xl/sharedStrings.xml": strToU8(`<sst>${compartidos.map((texto) => (texto === "" ? "<si/>" : `<si><t>${texto}</t></si>`)).join("")}</sst>`),
    "xl/styles.xml": strToU8(estilos),
  };
  hojas.forEach((hoja, indice) => { ficheros[`xl/worksheets/sheet${indice + 1}.xml`] = strToU8(`<worksheet><sheetData>${hoja.xml}</sheetData></worksheet>`); });
  return zipSync(ficheros);
}

// Estilo 0: general. Estilo 1: un formato propio de mes ("mmm-yy"). Estilo 2: moneda, que no es fecha.
const ESTILOS = `<styleSheet><numFmts count="2"><numFmt numFmtId="164" formatCode="[$-C0A]mmm\\-yy;@"/><numFmt numFmtId="165" formatCode="#,##0.00\\ &quot;€&quot;"/></numFmts>
<cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="164" applyNumberFormat="1"/><xf numFmtId="165" applyNumberFormat="1"/></cellXfs></styleSheet>`;

test("cada celda con su columna; las cabeceras de mes, como fecha; la moneda, como número", () => {
  const libro = excel([{
    nombre: "Presupuesto 2026",
    xml: `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" s="1"><v>46023</v></c><c r="C1" s="1"><v>46054</v></c></row>`
      + `<row r="2"/>`
      + `<row r="3"><c r="A3" t="s"><v>1</v></c><c r="B3" s="2"><v>500</v></c><c r="C3" s="2"><v>500.00000000001</v></c></row>`
      + `<row r="4"><c r="A4" t="inlineStr"><is><t>Google Ads &amp; Meta</t></is></c><c r="C4"><f>SUM(C1:C3)</f><v>1250.5</v></c></row>`,
  }], ["Concepto", "SEO"], ESTILOS);
  const { texto, hojas, celdas, recortado } = xlsxATexto(libro);
  assert.equal(hojas, 1);
  assert.equal(recortado, false);
  assert.equal(celdas, 8);
  assert.equal(texto, [
    "## Hoja «Presupuesto 2026»",
    "Fila 1 · A: Concepto · B: 2026-01-01 · C: 2026-02-01",
    "Fila 3 · A: SEO · B: 500 · C: 500",
    "Fila 4 · A: Google Ads & Meta · C: 1250.5",
  ].join("\n"));
});

test("una fila vacía autocerrada no se queda con la de después, ni un texto vacío con el siguiente", () => {
  const libro = excel([{ nombre: "H", xml: `<row r="1"/><row r="2"><c r="A2" t="s"><v>1</v></c></row>` }], ["", "Segundo"], ESTILOS);
  assert.equal(xlsxATexto(libro).texto, "## Hoja «H»\nFila 2 · A: Segundo");
});

test("varias hojas, y la oculta se dice", () => {
  const libro = excel([
    { nombre: "Intec", xml: `<row r="1"><c r="A1"><v>1</v></c></row>` },
    { nombre: "Cálculos", oculta: true, xml: `<row r="1"><c r="A1" t="b"><v>1</v></c></row>` },
  ], [], ESTILOS);
  const { texto, hojas } = xlsxATexto(libro);
  assert.equal(hojas, 2);
  assert.match(texto, /## Hoja «Cálculos» \(oculta\)\nFila 1 · A: VERDADERO/);
});

test("lo que no es un .xlsx da un error que se entiende", () => {
  assert.throws(() => xlsxATexto(strToU8("esto no es un zip")), /Guárdalo como \.xlsx o como PDF/);
  assert.throws(() => xlsxATexto(zipSync({ "otra/cosa.txt": strToU8("hola") })), /no es un Excel/);
});

test("las letras de columna, de ida y vuelta", () => {
  for (const [letras, indice] of [["A", 0], ["Z", 25], ["AA", 26], ["AZ", 51], ["BA", 52]] as const) {
    assert.equal(_columnas.columna(`${letras}7`), indice);
    assert.equal(_columnas.letraDe(indice), letras);
  }
});
