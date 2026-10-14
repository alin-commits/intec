import { test } from "node:test";
import assert from "node:assert/strict";
import { buildXlsx, columnLetter, escapeXml, sheetName } from "../src/lib/excel-export.ts";

test("el XML no se rompe por un & ni por un carácter de control", () => {
  assert.equal(escapeXml("Pérez & Hijos <S.L.>"), "Pérez &amp; Hijos &lt;S.L.&gt;");
  assert.equal(escapeXml('dijo "sí"'), "dijo &quot;sí&quot;");
  // Un carácter de control dentro deja el archivo ilegible para Excel: se quita.
  assert.equal(escapeXml("antes\u0007después"), "antesdespués");
  // El salto de línea sí vale dentro de una celda.
  assert.equal(escapeXml("una\ndos"), "una\ndos");
});

test("las columnas se nombran como en una hoja de cálculo", () => {
  assert.equal(columnLetter(0), "A");
  assert.equal(columnLetter(25), "Z");
  assert.equal(columnLetter(26), "AA");
  assert.equal(columnLetter(51), "AZ");
  assert.equal(columnLetter(52), "BA");
});

test("el nombre de la hoja se arregla para que Excel lo acepte", () => {
  const usados = new Set<string>();
  assert.equal(sheetName("Clientes", usados), "Clientes");
  // Excel no admite / \ ? * [ ] ni más de 31 letras.
  assert.equal(sheetName("Ventas/2026 [todas]", usados), "Ventas 2026  todas");
  assert.equal(sheetName("Un nombre larguísimo que no cabe de ninguna manera", usados).length, 31);
  // Ni dos hojas con el mismo nombre.
  assert.equal(sheetName("Clientes", usados), "Clientes (2)");
  assert.equal(sheetName("Clientes", usados), "Clientes (3)");
  // Sin nombre, uno por defecto.
  assert.equal(sheetName("   ", new Set()), "Hoja");
});

test("el libro lleva todas las partes que Excel pide", () => {
  const partes = buildXlsx([{ name: "Datos", columns: [{ header: "A", value: () => 1 }], rows: [{}] }] as never[]);
  for (const ruta of ["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/worksheets/sheet1.xml"]) {
    assert.ok(partes[ruta], `falta ${ruta}`);
  }
});

test("los números van como números y el texto como texto", () => {
  const partes = buildXlsx([{
    name: "Datos",
    columns: [{ header: "Importe", value: (fila: { n: number }) => fila.n }, { header: "Nombre", value: () => "Ana" }],
    rows: [{ n: 1234.5 }],
  }] as never[]);
  const hoja = partes["xl/worksheets/sheet1.xml"];
  assert.ok(hoja.includes("<v>1234.5</v>"), "el importe debería ir como número");
  assert.ok(hoja.includes('t="inlineStr"'), "el texto debería ir como cadena");
  // La cabecera usa el estilo 1, que es el de la negrita.
  assert.ok(hoja.includes('r="A1" s="1"'), "la cabecera debería ir en negrita");
});

test("una celda vacía no ocupa sitio", () => {
  const partes = buildXlsx([{
    name: "Datos",
    columns: [{ header: "Notas", value: () => null }],
    rows: [{}],
  }] as never[]);
  assert.ok(!partes["xl/worksheets/sheet1.xml"].includes('r="A2"'), "una celda nula no debería escribirse");
});
