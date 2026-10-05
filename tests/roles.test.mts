import { test } from "node:test";
import assert from "node:assert/strict";
import { ALL_APP_ROLES, CARDS_ROLES, SALES_ROLES, UNITS_ROLES, USER_MANAGER_ROLES, hasAnyRole, roleLabels } from "../src/lib/constants.ts";
import type { AppRole } from "../src/lib/types.ts";

test("el propietario entra en todas las pantallas, incluso en las que no le nombran", () => {
  const propietario: AppRole[] = ["owner"];
  for (const lista of [SALES_ROLES, UNITS_ROLES, CARDS_ROLES]) {
    assert.equal(hasAnyRole(propietario, lista), true, `debería entrar en ${lista.join("/")}`);
  }
  // Y en una lista que no existe todavía, que es el caso que importa: una
  // pantalla nueva no puede dejar fuera al dueño por olvido.
  assert.equal(hasAnyRole(propietario, ["it"]), true);
  assert.equal(hasAnyRole(["admin", "owner"], ["vault_admin"]), true);
});

test("a los demás no les cambia nada", () => {
  assert.equal(hasAnyRole(["commercial"], SALES_ROLES), false);
  assert.equal(hasAnyRole(["direction"], SALES_ROLES), true);
  assert.equal(hasAnyRole(["it"], CARDS_ROLES), true);
  assert.equal(hasAnyRole(["employee"], UNITS_ROLES), false);
  assert.equal(hasAnyRole([], SALES_ROLES), false);
});

test("el rol de propietario no se puede repartir desde la pantalla de usuarios", () => {
  assert.ok(ALL_APP_ROLES.includes("owner"), "existe como rol");
  assert.equal(USER_MANAGER_ROLES.includes("owner"), false, "pero no se ofrece como opción");
  assert.equal(roleLabels.owner, "Propietario");
});
