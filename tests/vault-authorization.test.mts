import { test } from "node:test";
import assert from "node:assert/strict";
import { canDeleteEntry, canEditEntry, canGrantTo, canManagePermissions, canViewEntry } from "../src/lib/vault/authorization.ts";

const alin = { userId: "alin", isVaultAdmin: true };
const pierre = { userId: "pierre", isVaultAdmin: true };
const raul = { userId: "raul", isVaultAdmin: false };
const victor = { userId: "victor", isVaultAdmin: false };

const shared = { createdBy: "alin", visibility: "shared" as const };
const personalOfRaul = { createdBy: "raul", visibility: "personal" as const };
const restricted = { createdBy: "alin", visibility: "restricted" as const };

const viewGrant = { userId: "victor", canView: true, canEdit: false, canDelete: false, canManagePermissions: false };
const editGrant = { ...viewGrant, canEdit: true };

test("shared credentials are visible to everyone with vault access", () => {
  assert.ok(canViewEntry(shared, raul));
  assert.ok(canViewEntry(shared, victor));
  // But only the owner or a vault admin may change them.
  assert.ok(!canEditEntry(shared, raul));
  assert.ok(canEditEntry(shared, pierre));
  assert.ok(canEditEntry(shared, alin));
});

test("a personal credential belongs to its owner only — not even to vault admins", () => {
  assert.ok(canViewEntry(personalOfRaul, raul));
  assert.ok(!canViewEntry(personalOfRaul, alin));
  assert.ok(!canViewEntry(personalOfRaul, pierre));
  assert.ok(!canEditEntry(personalOfRaul, alin));
  assert.ok(!canDeleteEntry(personalOfRaul, alin));
  // There is nobody to share it with, so it cannot be granted either.
  assert.ok(!canManagePermissions(personalOfRaul, alin));
  assert.ok(!canGrantTo(personalOfRaul, alin, "victor"));
});

test("restricted credentials need an explicit grant", () => {
  assert.ok(!canViewEntry(restricted, victor));
  assert.ok(canViewEntry(restricted, victor, viewGrant));
  assert.ok(!canEditEntry(restricted, victor, viewGrant));
  assert.ok(canEditEntry(restricted, victor, editGrant));
  // A grant for one person never helps another.
  assert.ok(!canViewEntry(restricted, raul, viewGrant));
  assert.ok(canViewEntry(restricted, pierre));
});

test("nobody can widen their own access", () => {
  assert.ok(!canGrantTo(restricted, alin, "alin"));
  assert.ok(canGrantTo(restricted, alin, "victor"));
  assert.ok(!canGrantTo(restricted, victor, "raul", viewGrant));
});

test("an entry with no owner left is still governed by its visibility", () => {
  const orphan = { createdBy: null, visibility: "shared" as const };
  assert.ok(canViewEntry(orphan, raul));
  assert.ok(!canEditEntry(orphan, raul));
  assert.ok(canEditEntry(orphan, alin));
  const orphanPersonal = { createdBy: null, visibility: "personal" as const };
  assert.ok(!canViewEntry(orphanPersonal, raul));
  assert.ok(!canViewEntry(orphanPersonal, alin));
});
