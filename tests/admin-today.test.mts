import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  ageBucket,
  daysBetween,
  isToChase,
  nextWeek,
  summarizeBanks,
  summarizePayables,
  summarizeReceivables,
  summarizeUninvoiced,
  type Payable,
  type Receivable,
  type UninvoicedNote,
} from "../src/lib/admin-today.ts";

const today = "2026-09-30";
const receipt = (patch: Partial<Receivable>): Receivable => ({
  company_code: 1, customer_code: "C1", customer_name: "Talleres", rep_code: 5, phone: "96", email: null,
  contact_name: "Ana", contact_phone: "600", contact_email: "ana@t.es", credit_limit: null, is_blocked: false,
  invoice_number: "F1", invoice_date: "2026-06-01", due_date: "2026-09-01", amount: 100, pending: 100,
  remittance_number: null, effect_type: "RC", is_returned: false, returned_on: null, ...patch,
});
const payment = (patch: Partial<Payable>): Payable => ({
  company_code: 1, supplier_code: "400001", supplier_name: "Ferretería", phone: null, email: null, invoice_number: "A1",
  invoice_date: "2026-06-01", due_date: "2026-09-01", amount: 50, pending: 50, remittance_number: null, bank_code: null, effect_type: "TR", ...patch,
});

test("fechas y tramos de antigüedad", () => {
  assert.equal(daysBetween("2026-09-01", today), 29);
  assert.equal(addDays(today, 7), "2026-10-07");
  assert.equal(addDays("2028-02-28", 1), "2028-02-29");
  assert.deepEqual([ageBucket(0), ageBucket(30), ageBucket(31), ageBucket(61), ageBucket(91)], ["0-30", "0-30", "31-60", "61-90", "+90"]);
});

test("se reclama lo vencido que no está en manos del banco", () => {
  assert.equal(isToChase(receipt({}), today), true);
  assert.equal(isToChase(receipt({ due_date: "2026-10-05" }), today), false, "sin vencer");
  assert.equal(isToChase(receipt({ remittance_number: 12 }), today), false, "en una remesa lo cobra el banco");
  assert.equal(isToChase(receipt({ remittance_number: 12, is_returned: true }), today), true, "devuelto por el banco vuelve a ser nuestro");
  assert.equal(isToChase(receipt({ pending: -30 }), today), false, "un abono a su favor no se reclama");
});

test("la deuda de cada cliente: vencido por tramos, devueltos y límite de riesgo", () => {
  const { customers, totals } = summarizeReceivables([
    receipt({ pending: 100, due_date: "2026-09-10" }),
    receipt({ pending: 400, due_date: "2026-05-01", is_returned: true, returned_on: "2026-05-03" }),
    receipt({ pending: 700, due_date: "2026-11-01", remittance_number: 8 }),
    receipt({ customer_code: "C2", customer_name: "Otro", pending: 50, due_date: "2026-10-15", credit_limit: 1000 }),
  ].map((row, index) => (index < 3 ? { ...row, credit_limit: 1000 } : row)), today);
  const c1 = customers.find((customer) => customer.customer_code === "C1");
  assert.ok(c1);
  assert.equal(c1.overdue, 500);
  assert.equal(c1.oldestDays, 152);
  assert.deepEqual(c1.buckets, { "0-30": 100, "31-60": 0, "61-90": 0, "+90": 400 });
  assert.equal(c1.returned, 400);
  assert.equal(c1.exposure, 1200, "el riesgo cuenta también lo que está en la remesa");
  assert.equal(c1.overLimit, 200);
  assert.equal(c1.contact_phone, "600");
  const c2 = customers.find((customer) => customer.customer_code === "C2");
  assert.equal(c2?.overdue, 0);
  assert.equal(c2?.overLimit, null);
  assert.equal(totals.overdueCustomers, 1);
  assert.equal(totals.overLimitCustomers, 1);
  assert.equal(totals.returnedCount, 1);
});

test("los pagos: vencido sin remesa, vencido en remesa y lo de esta semana", () => {
  const { suppliers, totals } = summarizePayables([
    payment({ pending: 50, due_date: "2026-09-01" }),
    payment({ pending: 80, due_date: "2026-09-20", remittance_number: 44 }),
    payment({ pending: 30, due_date: "2026-10-03" }),
    payment({ pending: 999, due_date: "2026-10-30" }),
  ], today);
  assert.equal(suppliers.length, 1);
  assert.equal(totals.overdueFree, 50);
  assert.equal(totals.overdueInRemittance, 80);
  assert.equal(totals.dueThisWeek, 30);
  assert.equal(suppliers[0].oldestDays, 29);
});

test("la semana que viene, día a día", () => {
  const week = nextWeek([receipt({ due_date: "2026-10-02", pending: 120 })], [payment({ due_date: "2026-10-02", pending: 40 }), payment({ due_date: "2026-10-09" })], today);
  assert.equal(week.length, 7);
  assert.equal(week[0].day, today);
  assert.deepEqual(week[2], { day: "2026-10-02", collections: 120, payments: 40 });
});

test("albaranes sin facturar: los de este mes aparte de los atrasados", () => {
  const note = (patch: Partial<UninvoicedNote>): UninvoicedNote => ({
    company_code: 1, year: 2026, series: "CRE", number: 1, note_date: "2026-09-15", customer_code: "C1", customer_name: "Talleres",
    rep_code: 5, net_amount: 100, billing_period: null, taken_on: today, ...patch,
  });
  const { customers, totals } = summarizeUninvoiced([
    note({ number: 1, note_date: "2026-08-20", net_amount: 300 }),
    note({ number: 2, note_date: "2026-09-02", net_amount: 100 }),
  ], today);
  assert.equal(customers.length, 1);
  assert.deepEqual([totals.previous, totals.previousCount, totals.current, totals.currentCount], [300, 1, 100, 1]);
  assert.equal(customers[0].oldestDays, 41);
});

test("bancos: el último saldo de cada cuenta y la línea que queda", () => {
  const { rows, totals } = summarizeBanks(
    [
      { company_code: 1, account_code: "5720000014", bank_code: "0081", bank_name: "SABADELL", description: null, iban: null, credit_limit: 100000, credit_used: 40000 },
      { company_code: 1, account_code: "5720000012", bank_code: "0182", bank_name: "BBVA", description: null, iban: null, credit_limit: null, credit_used: null },
    ],
    [
      { company_code: 1, account_code: "5720000014", day: "2026-09-29", balance: 10, movement: 0 },
      { company_code: 1, account_code: "5720000014", day: "2026-09-30", balance: 15, movement: 5 },
      { company_code: 2, account_code: "5720000099", day: "2026-09-25", balance: 7, movement: 0 },
    ],
  );
  assert.equal(rows.length, 3, "una cuenta con saldo y sin ficha también sale");
  assert.equal(rows[0].balance, 15);
  assert.equal(rows[0].available, 60000);
  assert.equal(rows[1].balance, null);
  assert.equal(totals.balance, 22);
  assert.equal(totals.oldestDay, "2026-09-25");
});
