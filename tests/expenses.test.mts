import { test } from "node:test";
import assert from "node:assert/strict";
import { addMonthsToKey, chargeDates, monthlyCost, nextRenewal, spentBetween, type MarketingExpense } from "../src/lib/expenses.ts";

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
