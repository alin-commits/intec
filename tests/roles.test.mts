import { test } from "node:test";
import assert from "node:assert/strict";
import * as constantes from "../src/lib/constants.ts";
import { ALL_APP_ROLES, CARDS_ROLES, CONSULTAS_EDIT_ROLES, CONSULTAS_ROLES, CONTRASENAS_ROLES, DASHBOARD_ROLES, SALES_ROLES, UNITS_ROLES, USER_MANAGER_ROLES, hasAnyRole, roleLabels } from "../src/lib/constants.ts";
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

test("la agencia solo alcanza las consultas, y solo para mirarlas", () => {
  const agencia: AppRole[] = ["agency"];
  assert.equal(hasAnyRole(agencia, CONSULTAS_ROLES), true, "tiene que ver las consultas");
  assert.equal(hasAnyRole(agencia, CONSULTAS_EDIT_ROLES), false, "pero no tocarlas");
  assert.equal(hasAnyRole(agencia, DASHBOARD_ROLES), false, "ni el panel de inicio");
  assert.equal(hasAnyRole(agencia, CONTRASENAS_ROLES), false, "ni el gestor de contraseñas");
  assert.equal(roleLabels.agency, "Agencia");
  assert.ok(USER_MANAGER_ROLES.includes("agency"), "y se tiene que poder asignar");
});

/*
  La guardia de verdad: que no se cuele en ninguna lista nueva.

  Es gente de fuera de la casa, y la forma de darle de más no es una decisión,
  es un descuido — añadir un rol a una lista de permisos mientras se trabaja en
  otra cosa. Esto recorre TODAS las listas de roles del fichero, así que una
  pantalla que se cree mañana también queda cubierta.
*/
test("la agencia no entra en ninguna otra lista de permisos", () => {
  const permitidas = new Set(["ALL_APP_ROLES", "CONSULTAS_ROLES", "USER_MANAGER_ROLES"]);
  const coladas: string[] = [];
  for (const [nombre, valor] of Object.entries(constantes)) {
    if (!nombre.endsWith("_ROLES") || !Array.isArray(valor)) continue;
    if (permitidas.has(nombre)) continue;
    if ((valor as AppRole[]).includes("agency")) coladas.push(nombre);
  }
  assert.deepEqual(coladas, [], `la agencia no debería estar en: ${coladas.join(", ")}`);
});
