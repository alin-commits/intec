import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_MAILBOX_KEY, INVOICE_MAILBOXES, isMailboxKey, mailboxForUnit } from "../src/lib/invoice-mailboxes.ts";

test("cada unidad de negocio va a la administración de su empresa", () => {
  assert.equal(mailboxForUnit("jender"), "jender");
  assert.equal(mailboxForUnit("cst-iberica"), "cst");
  assert.equal(mailboxForUnit("suministros-intec"), "intec");
  assert.equal(mailboxForUnit("blizzcool"), "intec");
  // Una unidad que no conocemos, o una factura general, no se inventa destino.
  assert.equal(mailboxForUnit("otra-cosa"), DEFAULT_MAILBOX_KEY);
  assert.equal(mailboxForUnit(null), DEFAULT_MAILBOX_KEY);
});

test("solo se aceptan las claves de la lista, nunca una dirección suelta", () => {
  assert.ok(isMailboxKey("toolsplace"));
  assert.ok(!isMailboxKey("otro"));
  assert.ok(!isMailboxKey("alguien@ajeno.com"));
  assert.ok(!isMailboxKey(undefined));
});

test("ninguna empresa comparte clave ni buzón con otra", () => {
  const keys = INVOICE_MAILBOXES.map((mailbox) => mailbox.key);
  const emails = INVOICE_MAILBOXES.map((mailbox) => mailbox.email);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(new Set(emails).size, emails.length);
  assert.ok(INVOICE_MAILBOXES.some((mailbox) => mailbox.key === DEFAULT_MAILBOX_KEY));
});
