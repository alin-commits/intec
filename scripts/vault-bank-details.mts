/*
  Pasa los datos del banco de las notas a sus campos propios.

  La migración desde TurtlePass dejó el banco, el titular y el código bancario
  como líneas sueltas dentro de las notas ("bank_name: ...", "account_holder:
  ..."). Ahora esas fichas tienen campos de verdad, así que este script mueve
  cada dato a su sitio, marca la ficha como de tipo banco y deja las notas con
  lo que quede, que suele ser nada.

  Necesita la migración 202609240007 aplicada (la que añade la columna).
  Es repetible: una ficha ya arreglada no tiene esas líneas y se salta.
  No imprime valores, solo qué campos se han movido.

  Uso:
    node scripts/vault-bank-details.mts            (solo dice qué haría)
    node scripts/vault-bank-details.mts --apply    (lo hace)
*/
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { decryptWithKey, encryptWithKey, parseVaultKey, VAULT_ENCRYPTION_VERSION } from "../src/lib/security/vault-crypto.ts";

const apply = process.argv.includes("--apply");

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((line) => line.includes("=") && !line.trim().startsWith("#"))
    .map((line) => [line.slice(0, line.indexOf("=")).trim(), line.slice(line.indexOf("=") + 1).trim()]),
);
const key = parseVaultKey(env.VAULT_ENCRYPTION_KEY);
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

/** Cómo se llamaba cada cosa en el gestor anterior y cómo se llama ahora. */
const FIELD_MAP: Record<string, string> = {
  bank_name: "bankName",
  bankname: "bankName",
  bank_code: "bankCode",
  bankcode: "bankCode",
  account_holder: "accountHolder",
  accountholder: "accountHolder",
  account_number: "accountNumber",
  accountnumber: "accountNumber",
  iban: "iban",
};

// Solo las fichas que llegaron con datos de banco: las que tienen alguna de
// esas líneas. Se reconocen por el tipo que les puso la migración.
const { data: rows, error } = await admin
  .from("vault_entries")
  .select("id, name, entry_type, notes_ciphertext, notes_iv, notes_tag, encryption_version, bank_details")
  .eq("is_active", true)
  .in("entry_type", ["other", "bank"]);
if (error) throw error;

let moved = 0;
for (const row of rows ?? []) {
  const notes = row.notes_ciphertext
    ? decryptWithKey(
        key,
        { ciphertext: row.notes_ciphertext, iv: row.notes_iv, tag: row.notes_tag, version: row.encryption_version ?? VAULT_ENCRYPTION_VERSION },
        "notes",
      )
    : "";

  const details: Record<string, string> = { ...((row.bank_details as Record<string, string> | null) ?? {}) };
  const kept: string[] = [];
  const takenFields: string[] = [];
  for (const line of notes.split("\n")) {
    const at = line.indexOf(":");
    const field = at > 0 ? FIELD_MAP[line.slice(0, at).trim().toLowerCase()] : undefined;
    const value = at > 0 ? line.slice(at + 1).trim() : "";
    if (!field || !value) {
      if (line.trim()) kept.push(line);
      continue;
    }
    details[field] = value;
    takenFields.push(field);
  }

  const isBank = takenFields.length > 0 || Object.keys(details).length > 0;
  if (!isBank) continue;
  if (takenFields.length === 0 && row.entry_type === "bank") continue;

  console.log(`- ${row.name}: ${takenFields.length ? `mueve ${takenFields.join(", ")}` : "ya movido"}; tipo → banco; quedan ${kept.length} líneas de notas`);
  if (!apply) continue;

  const remaining = kept.join("\n").trim();
  const encryptedNotes = remaining ? encryptWithKey(key, remaining, "notes") : null;
  const { error: updateError } = await admin
    .from("vault_entries")
    .update({
      entry_type: "bank",
      bank_details: details,
      notes_ciphertext: encryptedNotes?.ciphertext ?? null,
      notes_iv: encryptedNotes?.iv ?? null,
      notes_tag: encryptedNotes?.tag ?? null,
    })
    .eq("id", row.id);
  if (updateError) {
    console.log(`  ERROR al guardar: ${updateError.message}`);
    continue;
  }
  await admin.from("vault_audit_log").insert({
    user_id: null,
    vault_entry_id: row.id,
    entry_name: row.name,
    action: "IMPORT",
    metadata: { arreglo: "datos-de-banco-a-sus-campos", campos: takenFields },
  });
  moved++;
}

console.log(apply ? `\nFichas actualizadas: ${moved}` : "\nEn seco: no se ha tocado nada. Repite con --apply.");
