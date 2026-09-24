/*
  Repara las credenciales de banco que llegaron del gestor anterior sin
  contraseña.

  Qué pasó: en TurtlePass las fichas de tipo "banco" no guardaban la clave en el
  campo de contraseña sino en uno propio llamado PIN, que ni la API ni la
  exportación a Excel devolvían como tal. La migración lo recogió igualmente,
  pero acabó dentro de las notas, y en el campo de contraseña quedó un texto de
  aviso.

  Qué hace: para cada ficha con una línea "pin:" en las notas, mueve ese valor
  al campo de contraseña (cifrado, como cualquier otra), lo borra de las notas
  para que no quede duplicado, recalcula huella y fuerza, y lo anota en la
  auditoría. El resto de datos del banco (titular, código, IBAN) se quedan.

  Es repetible: una ficha ya arreglada no tiene línea "pin:" y se salta.
  No imprime ningún valor, solo nombres y longitudes.

  Uso:
    node scripts/vault-fix-bank-pins.mts            (solo dice qué haría)
    node scripts/vault-fix-bank-pins.mts --apply    (lo hace)
*/
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { decryptWithKey, encryptWithKey, parseVaultKey, passwordFingerprint, VAULT_ENCRYPTION_VERSION } from "../src/lib/security/vault-crypto.ts";
import { passwordStrength } from "../src/lib/vault/password-generator.ts";

const apply = process.argv.includes("--apply");

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((line) => line.includes("=") && !line.trim().startsWith("#"))
    .map((line) => [line.slice(0, line.indexOf("=")).trim(), line.slice(line.indexOf("=") + 1).trim()]),
);
const key = parseVaultKey(env.VAULT_ENCRYPTION_KEY);
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

/** Lo que la migración dejó escrito donde debería ir la contraseña. */
const PLACEHOLDER = "(sin contraseña en el gestor anterior — revisar)";
const placeholderFingerprint = passwordFingerprint(key, PLACEHOLDER);

const { data: rows, error } = await admin
  .from("vault_entries")
  .select("id, name, notes_ciphertext, notes_iv, notes_tag, encryption_version, password_fingerprint")
  .eq("is_active", true)
  .eq("password_fingerprint", placeholderFingerprint);
if (error) throw error;

console.log(`Fichas sin contraseña real: ${rows?.length ?? 0}`);
let fixed = 0;

for (const row of rows ?? []) {
  if (!row.notes_ciphertext) {
    console.log(`- ${row.name}: sin notas, no hay PIN que recuperar. Hay que meterla a mano.`);
    continue;
  }
  const notes = decryptWithKey(
    key,
    { ciphertext: row.notes_ciphertext, iv: row.notes_iv, tag: row.notes_tag, version: row.encryption_version ?? VAULT_ENCRYPTION_VERSION },
    "notes",
  );
  const lines = notes.split("\n");
  const pinLine = lines.findIndex((line) => /^\s*pin\s*:/i.test(line));
  if (pinLine === -1) {
    console.log(`- ${row.name}: no hay línea "pin" en las notas. Hay que meterla a mano.`);
    continue;
  }
  const pin = lines[pinLine].slice(lines[pinLine].indexOf(":") + 1).trim();
  if (!pin) {
    console.log(`- ${row.name}: la línea "pin" está vacía. Hay que meterla a mano.`);
    continue;
  }

  const remaining = lines.filter((_, index) => index !== pinLine).join("\n").trim();
  const strength = passwordStrength(pin).level;
  console.log(`- ${row.name}: PIN de ${pin.length} caracteres → contraseña (fuerza ${strength}); quedan ${remaining ? remaining.split("\n").length : 0} líneas de notas`);
  if (!apply) continue;

  const password = encryptWithKey(key, pin, "password");
  const encryptedNotes = remaining ? encryptWithKey(key, remaining, "notes") : null;
  const { error: updateError } = await admin
    .from("vault_entries")
    .update({
      password_ciphertext: password.ciphertext,
      password_iv: password.iv,
      password_tag: password.tag,
      password_fingerprint: passwordFingerprint(key, pin),
      password_strength: strength,
      encryption_version: VAULT_ENCRYPTION_VERSION,
      notes_ciphertext: encryptedNotes?.ciphertext ?? null,
      notes_iv: encryptedNotes?.iv ?? null,
      notes_tag: encryptedNotes?.tag ?? null,
      // has_notes no se toca: la calcula la propia base de datos.
    })
    .eq("id", row.id);
  if (updateError) {
    console.log(`  ERROR al guardar: ${updateError.message}`);
    continue;
  }
  // Sin user_id: no lo hace una persona desde la aplicación, sino este arreglo.
  await admin.from("vault_audit_log").insert({
    user_id: null,
    vault_entry_id: row.id,
    entry_name: row.name,
    action: "IMPORT",
    metadata: { arreglo: "pin-de-banco-a-contraseña", origen: "notas de la migración de TurtlePass" },
  });
  fixed++;
}

console.log(apply ? `\nArregladas: ${fixed}` : "\nEn seco: no se ha tocado nada. Repite con --apply.");
