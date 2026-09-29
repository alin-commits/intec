import { test } from "node:test";
import assert from "node:assert/strict";
import { cashDate, changedIbans, formatForBank, maskIban, mondayOf, treasuryWeeks, type OpenItem } from "../src/lib/payments.ts";

test("formatForBank: BBVA tiene su formato; Sabadell y Bankinter, el de la AEF", () => {
  assert.equal(formatForBank("BBVA"), "bbva");
  assert.equal(formatForBank("Sabadell"), "aef");
  assert.equal(formatForBank("Bankinter"), "aef");
});

test("maskIban deja ver el banco y el final", () => {
  assert.equal(maskIban("ES91 2100 0418 4502 0005 1332"), "ES91 2100 0418 **** **** 1332");
  assert.equal(maskIban(null), "—");
});

test("changedIbans avisa del proveedor que cobraba en otra cuenta", () => {
  const history = [
    { supplierCode: "A", iban: "ES11 1111", date: "2026-05-01" },
    { supplierCode: "A", iban: "ES22 2222", date: "2026-07-01" },
    { supplierCode: "B", iban: "ES33 3333", date: "2026-07-01" },
    // Lo que es de esta misma remesa o posterior no cuenta como "antes".
    { supplierCode: "C", iban: "ES44 4444", date: "2026-09-29" },
  ];
  const current = [
    { supplierCode: "A", iban: "ES99 9999", date: "2026-09-29" },
    { supplierCode: "B", iban: "es33 3333", date: "2026-09-29" },
    { supplierCode: "C", iban: "ES55 5555", date: "2026-09-29" },
    { supplierCode: "D", iban: "ES66 6666", date: "2026-09-29" },
  ];
  const changes = changedIbans(current, history, "2026-09-29");
  assert.deepEqual([...changes.keys()], ["A"]);
  assert.deepEqual(changes.get("A"), { previous: "ES222222", current: "ES999999", since: "2026-07-01" });
});

test("mondayOf devuelve el lunes de esa semana", () => {
  assert.equal(mondayOf("2026-09-29"), "2026-09-28");
  assert.equal(mondayOf("2026-10-04"), "2026-09-28");
  assert.equal(mondayOf("2026-09-28"), "2026-09-28");
});

const item = (overrides: Partial<OpenItem>): OpenItem => ({
  company_code: 1, kind: "pago", counterpart_code: "P1", invoice_number: "F1", due_date: "2026-10-01", pending: 100,
  remittance_number: null, bank_code: null, ...overrides,
});

test("un pago en confirming con aplazamiento sale de la cuenta días después", () => {
  const deferral = (company: number, bank: string) => (company === 1 && bank === "5720001" ? 90 : null);
  assert.equal(cashDate(item({}), deferral), "2026-10-01");
  assert.equal(cashDate(item({ remittance_number: 7, bank_code: "5720001" }), deferral), "2026-12-30");
  assert.equal(cashDate(item({ kind: "cobro", remittance_number: 7, bank_code: "5720001" }), deferral), "2026-10-01");
});

test("treasuryWeeks reparte por semanas y acumula el neto", () => {
  const deferral = () => 90;
  const weeks = treasuryWeeks([
    item({ kind: "cobro", due_date: "2026-09-20", pending: 50 }),
    item({ kind: "cobro", due_date: "2026-09-30", pending: 1000 }),
    item({ due_date: "2026-10-01", pending: 300 }),
    item({ due_date: "2026-10-01", pending: 200, remittance_number: 7, bank_code: "X" }),
    item({ due_date: "2027-06-01", pending: 10 }),
  ], "2026-09-29", deferral);
  assert.equal(weeks.length, 15);
  assert.equal(weeks[0].key, "vencido");
  assert.equal(weeks[0].cobros, 50);
  const first = weeks[1];
  assert.equal(first.label, "28/9–4/10");
  assert.equal(first.cobros, 1000);
  assert.equal(first.pagos, 500);
  // El de la remesa con aplazamiento no sale esta semana.
  assert.equal(first.salidas, 300);
  assert.equal(first.neto, 700);
  assert.equal(first.acumulado, 750);
  // Sale 90 días después: el 30/12, en la semana del 28/12, que es la 14.ª y ya cae en "Más adelante".
  const last = weeks[weeks.length - 1];
  assert.equal(last.key, "despues");
  assert.equal(last.salidas, 210);
  assert.equal(last.pagos, 10);
});
