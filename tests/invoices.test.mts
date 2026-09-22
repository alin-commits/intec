import { test } from "node:test";
import assert from "node:assert/strict";
import { INVOICE_PATH_PATTERN, invoiceSpend, matchSubscription, type MarketingInvoice } from "../src/lib/invoices.ts";

const subscriptions = [
  { id: "a", name: "Arsys", provider: "Arsys", kind: "subscription", status: "active" },
  { id: "c", name: "Canva Pro", provider: null, kind: "subscription", status: "active" },
  { id: "f", name: "Feria Climatización", provider: "IFEMA", kind: "one_off", status: "active" },
];

test("matchSubscription recognises the supplier despite legal suffixes and accents", () => {
  assert.equal(matchSubscription("ARSYS INTERNET, S.L.U.", subscriptions)?.id, "a");
  assert.equal(matchSubscription("Canva Pty Ltd", subscriptions)?.id, "c");
  assert.equal(matchSubscription("Imprenta López", subscriptions), null);
  // One-off expenses are never treated as subscriptions.
  assert.equal(matchSubscription("IFEMA", subscriptions), null);
  assert.equal(matchSubscription("SL", subscriptions), null);
});

test("invoiceSpend counts the base amount unless the invoice belongs to a subscription", () => {
  const invoice = { baseAmount: 100, vatAmount: 21, totalAmount: 121, expenseId: null } as MarketingInvoice;
  assert.equal(invoiceSpend(invoice), 100);
  assert.equal(invoiceSpend({ ...invoice, expenseId: "a" }), 0);
});

test("only app-generated storage paths are accepted", () => {
  assert.ok(INVOICE_PATH_PATTERN.test("2026/0b8f1c2e-4d5a-4c3b-9a8e-1f2d3c4b5a69.pdf"));
  assert.ok(!INVOICE_PATH_PATTERN.test("../2026/x.pdf"));
  assert.ok(!INVOICE_PATH_PATTERN.test("2026/0b8f1c2e-4d5a-4c3b-9a8e-1f2d3c4b5a69.pdf/../../secret"));
});
