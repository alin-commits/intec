import { test } from "node:test";
import assert from "node:assert/strict";
import { offerState, orderState, purchaseRhythm } from "../src/lib/customer-sheet.ts";

const today = "2026-09-30";

test("el estado de una oferta, como en las listas del panel", () => {
  const base = { offer_date: "2026-09-01", valid_until: "2026-10-15", ordered_amount: 0, reject_reason: null, loss_detail: null };
  assert.deepEqual(offerState({ ...base, ordered_amount: 1200 }, today), { state: "convertida", reason: "" });
  assert.deepEqual(offerState({ ...base, reject_reason: "  Precio " }, today), { state: "rechazada", reason: "Precio" });
  assert.deepEqual(offerState({ ...base, loss_detail: "Se fue a la competencia" }, today), { state: "rechazada", reason: "Se fue a la competencia" });
  assert.equal(offerState(base, today).state, "viva");
  assert.equal(offerState({ ...base, valid_until: "2026-09-29" }, today).state, "caducada");
  // Sin validez, se da por viva 90 días.
  assert.equal(offerState({ ...base, valid_until: null, offer_date: "2026-07-15" }, today).state, "viva");
  assert.equal(offerState({ ...base, valid_until: null, offer_date: "2026-06-15" }, today).state, "caducada");
});

test("el estado de un pedido", () => {
  assert.equal(orderState({ needed_on: "2026-10-05", first_delivery_on: null, pending_amount: 300 }, today), "pendiente");
  assert.equal(orderState({ needed_on: "2026-09-20", first_delivery_on: "2026-09-18", pending_amount: 300 }, today), "retrasado");
  assert.equal(orderState({ needed_on: "2026-09-20", first_delivery_on: "2026-09-25", pending_amount: 0 }, today), "servido_tarde");
  assert.equal(orderState({ needed_on: null, first_delivery_on: "2026-09-25", pending_amount: "0" }, today), "servido");
});

test("cada cuánto compra un cliente y si lleva demasiado sin hacerlo", () => {
  assert.equal(purchaseRhythm([], today), null);
  // Compra cada 10 días; la última hace 40: lleva el cuádruple de lo normal.
  const regular = ["2026-07-11", "2026-07-21", "2026-07-31", "2026-08-10", "2026-08-21", "2026-08-21"];
  const rhythm = purchaseRhythm(regular, today);
  assert.equal(rhythm?.last, "2026-08-21");
  assert.equal(rhythm?.daysSinceLast, 40);
  assert.equal(rhythm?.purchaseDaysLastYear, 5, "un día con dos albaranes cuenta una vez");
  assert.equal(Math.round(rhythm?.every ?? 0), 10);
  assert.equal(rhythm?.late, true);
  // Con dos compras no hay ritmo que medir.
  const two = purchaseRhythm(["2026-01-10", "2026-09-01"], today);
  assert.equal(two?.every, null);
  assert.equal(two?.late, false);
  // Quien compra cada 3 días no está "tarde" por llevar 8.
  const often = purchaseRhythm(["2026-09-01", "2026-09-04", "2026-09-07", "2026-09-10", "2026-09-13", "2026-09-22"], today);
  assert.equal(often?.late, false);
  // Lo de hace más de un año no cuenta para el ritmo, pero sí para la primera compra.
  const old = purchaseRhythm(["2024-03-01", "2026-09-01", "2026-09-10", "2026-09-20"], today);
  assert.equal(old?.first, "2024-03-01");
  assert.equal(old?.purchaseDaysLastYear, 3);
});
