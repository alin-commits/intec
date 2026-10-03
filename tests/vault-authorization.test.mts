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

test("restringir una carpeta madre restringe sus subcarpetas", async () => {
  const { folderListAllows } = await import("../src/lib/vault/authorization.ts");
  const folders = [
    { id: "admin", parent_id: null },
    { id: "bancos", parent_id: "admin" },
    { id: "bancos-sabadell", parent_id: "bancos" },
    { id: "marketing", parent_id: null },
    { id: "rrss", parent_id: "marketing" },
  ];
  const lists = [
    { category_id: "admin", user_id: "ana" },
    { category_id: "admin", user_id: "luis" },
    // Una subcarpeta con su propia lista manda sobre la de su madre.
    { category_id: "bancos-sabadell", user_id: "ana" },
  ];
  assert.equal(folderListAllows("bancos", "luis", folders, lists), true);
  assert.equal(folderListAllows("bancos", "pepe", folders, lists), false);
  assert.equal(folderListAllows("bancos-sabadell", "luis", folders, lists), false);
  assert.equal(folderListAllows("bancos-sabadell", "ana", folders, lists), true);
  assert.equal(folderListAllows("rrss", "pepe", folders, lists), true);
  // Un ciclo en las carpetas no lo cuelga.
  assert.equal(folderListAllows("x", "pepe", [{ id: "x", parent_id: "y" }, { id: "y", parent_id: "x" }], []), true);
});
