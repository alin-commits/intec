/**
 * Fills in the fingerprint and strength of credentials saved before the health
 * check existed. Runs locally, decrypts each password in memory only to measure
 * it, and never prints or stores anything readable.
 *
 *   node scripts/vault-backfill-health.mts          → says how many are missing
 *   node scripts/vault-backfill-health.mts --commit → fills them in
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { decryptWithKey, parseVaultKey, passwordFingerprint } from "../src/lib/security/vault-crypto.ts";
import { passwordStrength } from "../src/lib/vault/password-generator.ts";

const commit = process.argv.includes("--commit");
const env = new Map<string, string>();
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (match) env.set(match[1], match[2].replace(/^["']|["']$/g, ""));
}
const key = parseVaultKey(env.get("VAULT_ENCRYPTION_KEY"));
const supabase = createClient(env.get("NEXT_PUBLIC_SUPABASE_URL")!, env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

const { data: entries, error } = await supabase
  .from("vault_entries")
  .select("id, name, password_ciphertext, password_iv, password_tag, encryption_version, password_fingerprint")
  .eq("is_active", true)
  .is("password_fingerprint", null);
if (error) throw new Error(`No se pudieron leer las credenciales: ${error.message}`);

console.log(`Credenciales sin huella: ${entries?.length ?? 0}`);
if (!commit) {
  console.log("Simulación: no se ha escrito nada. Repite con --commit.");
  process.exit(0);
}

let updated = 0;
let unreadable = 0;
for (const entry of entries ?? []) {
  let plaintext: string;
  try {
    plaintext = decryptWithKey(key, { ciphertext: entry.password_ciphertext, iv: entry.password_iv, tag: entry.password_tag, version: entry.encryption_version }, "password");
  } catch {
    unreadable++;
    console.log(`  · no se pudo descifrar: ${entry.name}`);
    continue;
  }
  const { error: updateError } = await supabase
    .from("vault_entries")
    .update({ password_fingerprint: passwordFingerprint(key, plaintext), password_strength: passwordStrength(plaintext).level })
    .eq("id", entry.id);
  if (updateError) throw new Error(`No se pudo actualizar ${entry.name}: ${updateError.message}`);
  updated++;
}
console.log(`Actualizadas: ${updated}${unreadable ? ` · ilegibles: ${unreadable}` : ""}`);
