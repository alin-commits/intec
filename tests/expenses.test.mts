import { test } from "node:test";
import assert from "node:assert/strict";
import { addMonthsToKey, chargeDates, monthlyCost, nextRenewal, spentBetween, subscriptionSpend, type MarketingExpense } from "../src/lib/expenses.ts";

function expense(overrides: Partial<MarketingExpense>): MarketingExpense {
  return {
    id: "e1",
    name: "Canva",
    provider: null,
    category: "software",
    kind: "subscription",
    amount: 12,
    billingPeriod: "monthly",
    startDate: "2026-01-31",
    status: "active",
    cancelledOn: null,
    businessUnitId: null,
    paymentMethod: null,
    url: null,
    notes: null,
    ...overrides,
  };
}

test("addMonthsToKey clamps to the end of shorter months", () => {
  assert.equal(addMonthsToKey("2026-01-31", 1), "2026-02-28");
  assert.equal(addMonthsToKey("2028-01-31", 1), "2028-02-29");
  assert.equal(addMonthsToKey("2026-01-31", 2), "2026-03-31");
  assert.equal(addMonthsToKey("2026-11-15", 3), "2027-02-15");
});

test("monthlyCost normalises periods and ignores cancelled or one-off expenses", () => {
  assert.equal(monthlyCost(expense({ amount: 120, billingPeriod: "yearly" })), 10);
  assert.equal(monthlyCost(expense({ amount: 30, billingPeriod: "quarterly" })), 10);
  assert.equal(monthlyCost(expense({ status: "cancelled" })), 0);
  assert.equal(monthlyCost(expense({ kind: "one_off", billingPeriod: null })), 0);
});

test("nextRenewal finds the next charge on or after today without drifting", () => {
  assert.equal(nextRenewal(expense({}), "2026-09-22"), "2026-09-30");
  assert.equal(nextRenewal(expense({}), "2026-09-30"), "2026-09-30");
  assert.equal(nextRenewal(expense({ startDate: "2024-03-10", billingPeriod: "yearly" }), "2026-09-22"), "2027-03-10");
  assert.equal(nextRenewal(expense({ startDate: "2026-10-05" }), "2026-09-22"), "2026-10-05");
  assert.equal(nextRenewal(expense({ status: "cancelled" }), "2026-09-22"), null);
});

test("chargeDates stops at the cancellation date and handles one-off expenses", () => {
  const cancelled = expense({ startDate: "2026-01-10", status: "cancelled", cancelledOn: "2026-04-10" });
  assert.deepEqual(chargeDates(cancelled, "2026-01-01", "2026-12-31"), ["2026-01-10", "2026-02-10", "2026-03-10"]);
  const oneOff = expense({ kind: "one_off", billingPeriod: null, startDate: "2026-05-20", amount: 900 });
  assert.equal(spentBetween(oneOff, "2026-01-01", "2026-12-31"), 900);
  assert.equal(spentBetween(oneOff, "2027-01-01", "2027-12-31"), 0);
  assert.equal(spentBetween(expense({ startDate: "2026-01-15", amount: 10 }), "2026-01-01", "2026-06-30"), 60);
});

test("subscriptionSpend replaces each estimated charge with its real invoice", () => {
  // Monthly 109 € from 10 Jan; by 30 Jun there are 6 charges (Jan–Jun).
  const arsys = expense({ id: "arsys", startDate: "2026-01-10", amount: 109 });
  const invoices = [
    { expenseId: "arsys", invoiceDate: "2026-01-11", baseAmount: 90.08 },
    { expenseId: "arsys", invoiceDate: "2026-02-09", baseAmount: 90.08 },
    { expenseId: "other", invoiceDate: "2026-03-10", baseAmount: 500 },
  ];
  const result = subscriptionSpend(arsys, invoices, "2026-01-01", "2026-06-30");
  assert.equal(Math.round(result.actual * 100) / 100, 180.16);
  assert.equal(result.estimated, 4 * 109);
  // Without invoices it is just the estimate.
  assert.deepEqual(subscriptionSpend(arsys, [], "2026-01-01", "2026-06-30"), { actual: 0, estimated: 6 * 109 });
});

test("an extra invoice still counts but never cancels two charges", () => {
  const arsys = expense({ id: "arsys", startDate: "2026-01-10", amount: 100 });
  const invoices = [
    { expenseId: "arsys", invoiceDate: "2026-01-10", baseAmount: 100 },
    { expenseId: "arsys", invoiceDate: "2026-01-20", baseAmount: 30 },
  ];
  const result = subscriptionSpend(arsys, invoices, "2026-01-01", "2026-02-28");
  assert.equal(result.actual, 130);
  assert.equal(result.estimated, 100);
});

test("a charge invoiced late still replaces its estimate instead of adding to it", () => {
  // La cuota de diciembre de 2025, facturada el 3 de enero: no casa con ningún
  // cargo de 2026 por fecha, pero es una cuota y no debe sumarse encima.
  const hosting = expense({ id: "hosting", startDate: "2026-01-28", amount: 50 });
  const invoices = [{ expenseId: "hosting", invoiceDate: "2026-01-03", baseAmount: 50 }];
  const result = subscriptionSpend(hosting, invoices, "2026-01-01", "2026-03-31");
  assert.equal(result.actual, 50);
  // Cargos en enero, febrero y marzo; la factura cubre uno, quedan dos.
  assert.equal(result.estimated, 100);
});

test("a subscription that has not started yet costs nothing today", () => {
  const future = expense({ id: "future", startDate: "2026-12-01", amount: 100 });
  assert.equal(monthlyCost(future, "2026-09-24"), 0);
  assert.equal(monthlyCost(future, "2026-12-01"), 100);
  assert.equal(monthlyCost(future), 100);
});
