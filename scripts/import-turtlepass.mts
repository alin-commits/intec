/**
 * Imports a TurtlePass CSV export into the vault, encrypting every password on
 * the way in. Runs on your machine, never on the server:
 *
 *   node scripts/import-turtlepass.mts "C:\\ruta\\export.csv" --owner tu@correo.com
 *   node scripts/import-turtlepass.mts "C:\\ruta\\export.csv" --owner tu@correo.com --commit
 *
 * Without --commit it only reports what it would do. It never prints a password.
 * Reads SUPABASE_SERVICE_ROLE_KEY and VAULT_ENCRYPTION_KEY from .env.local.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { encryptWithKey, parseVaultKey } from "../src/lib/security/vault-crypto.ts";

const [, , csvPath, ...flags] = process.argv;
const commit = flags.includes("--commit");
const ownerEmail = flags[flags.indexOf("--owner") + 1];
if (!csvPath || !ownerEmail || ownerEmail.startsWith("--")) {
  console.error('Uso: node scripts/import-turtlepass.mts "<ruta.csv>" --owner <correo> [--commit]');
  process.exit(1);
}

// ---------- environment ----------

const env = new Map<string, string>();
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (match) env.set(match[1], match[2].replace(/^["']|["']$/g, ""));
}
const url = env.get("NEXT_PUBLIC_SUPABASE_URL");
const serviceRole = env.get("SUPABASE_SERVICE_ROLE_KEY");
const vaultKey = parseVaultKey(env.get("VAULT_ENCRYPTION_KEY"));
if (!url || !serviceRole) throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local");
const supabase = createClient(url, serviceRole, { auth: { persistSession: false } });

// ---------- CSV ----------

function parseCsv(input: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"') { if (input[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) { row.push(field); field = ""; }
    else if (char === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (char !== "\r") field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const raw = readFileSync(csvPath);
const text = raw[0] === 0xff && raw[1] === 0xfe ? raw.toString("utf16le") : raw.toString("utf8").replace(/^\uFEFF/, "");
const rows = parseCsv(text, ";").filter((row) => row.some((cell) => cell.trim() !== ""));
const headers = rows[0];
const data = rows.slice(1);
const index = (name: string) => headers.indexOf(name);

// TurtlePass does not quote fields that contain ";" or line breaks, so those rows
// arrive with the columns shifted. They are reported instead of guessed.
const clean = data.filter((row) => row.length === headers.length);
const broken = data.filter((row) => row.length !== headers.length);

// ---------- mapping ----------

const ICON_CATEGORIES: Record<string, string> = {
  "fa-wordpress": "Web y CMS",
  "fa-google": "Correo",
  "fa-envelope": "Correo",
  "fa-server": "Servidores y NAS",
  "fa-wifi": "Red y routers",
  "fa-instagram": "Marketing y RRSS",
  "fa-linkedin": "Marketing y RRSS",
  "fa-bandcamp": "Marketing y RRSS",
  "fa-skype": "Marketing y RRSS",
  "fa-trello": "Marketing y RRSS",
  "fa-sellsy": "ERP y gestión",
  "fa-dashboard": "ERP y gestión",
  "fa-user-circle": "Otros",
  "fa-key": "Otros",
  "fa-asterisk": "Otros",
};

const EXTRA_FIELDS: [string, string][] = [
  ["password_bankname", "Banco"],
  ["password_accountholder", "Titular"],
  ["password_bankcode", "Código bancario"],
  ["password_accountnumber", "Nº de cuenta"],
  ["password_iban", "IBAN"],
  ["password_bankpin", "PIN"],
  ["password_mailhost", "Servidor de correo"],
  ["password_mailport", "Puerto"],
  ["password_authmethod", "Autenticación"],
  ["password_smtphost", "SMTP"],
  ["password_smtpport", "Puerto SMTP"],
  ["password_smtpusername", "Usuario SMTP"],
  ["password_serverhost", "Servidor"],
  ["password_serverport", "Puerto servidor"],
  ["password_validfrom", "Válido desde"],
  ["password_licensekey", "Licencia"],
];

function safeUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

const { data: categories } = await supabase.from("vault_categories").select("id, name");
const categoryIdByName = new Map((categories ?? []).map((row) => [row.name as string, row.id as string]));

const { data: owner } = await supabase.from("profiles").select("id, full_name").eq("email", ownerEmail).maybeSingle();
if (!owner) throw new Error(`No hay ningún usuario con el correo ${ownerEmail}`);

const { data: existing } = await supabase.from("vault_entries").select("legacy_id").eq("legacy_source", "turtlepass");
const alreadyImported = new Set((existing ?? []).map((row) => String(row.legacy_id)));

type Prepared = { name: string; row: Record<string, unknown> };
const prepared: Prepared[] = [];
const skipped: string[] = [];

for (const row of clean) {
  const legacyId = row[index("password_id")].trim();
  const name = row[index("password_name")].trim();
  if (alreadyImported.has(legacyId)) { skipped.push(`${name} (ya importada)`); continue; }
  const password = row[index("password_password")];
  if (!password) { skipped.push(`${name} (sin contraseña)`); continue; }

  const extras = EXTRA_FIELDS
    .map(([column, label]) => ({ label, value: (row[index(column)] ?? "").trim() }))
    .filter((field) => field.value !== "")
    .map((field) => `${field.label}: ${field.value}`);
  const notice = (row[index("password_notice")] ?? "").trim();
  const notes = [notice, ...extras].filter(Boolean).join("\n");

  const encryptedPassword = encryptWithKey(vaultKey, password, "password");
  const encryptedNotes = notes ? encryptWithKey(vaultKey, notes, "notes") : null;
  const type = (row[index("password_password_type")] ?? "plain").trim();
  const createdAt = row[index("password_createdate")].trim();

  prepared.push({
    name,
    row: {
      name: name.slice(0, 160),
      url: safeUrl(row[index("password_url")] ?? ""),
      username: (row[index("password_username")] ?? "").trim() || null,
      password_ciphertext: encryptedPassword.ciphertext,
      password_iv: encryptedPassword.iv,
      password_tag: encryptedPassword.tag,
      notes_ciphertext: encryptedNotes?.ciphertext ?? null,
      notes_iv: encryptedNotes?.iv ?? null,
      notes_tag: encryptedNotes?.tag ?? null,
      category_id: categoryIdByName.get(ICON_CATEGORIES[(row[index("password_icon")] ?? "").trim()] ?? "Otros") ?? null,
      visibility: "shared",
      entry_type: ["plain", "email", "server"].includes(type) ? type : "other",
      created_by: owner.id,
      created_at: /^\d{4}-\d{2}-\d{2}/.test(createdAt) ? new Date(createdAt).toISOString() : new Date().toISOString(),
      encryption_version: encryptedPassword.version,
      legacy_source: "turtlepass",
      legacy_id: legacyId,
    },
  });
}

console.log(`Filas en el CSV: ${data.length}`);
console.log(`Listas para importar: ${prepared.length}`);
console.log(`Omitidas: ${skipped.length}${skipped.length ? ` → ${skipped.join(" · ")}` : ""}`);
if (broken.length) {
  console.log(`\nMal formadas en el export (hay que meterlas a mano), ${broken.length}:`);
  for (const row of broken) console.log(`  · ${row[index("password_name")] ?? "(sin nombre)"}`);
}

if (!commit) {
  console.log("\nSimulación: no se ha guardado nada. Repite con --commit para importar de verdad.");
  process.exit(0);
}

const { error } = await supabase.from("vault_entries").insert(prepared.map((item) => item.row));
if (error) {
  console.error("No se pudo importar:", error.message);
  process.exit(1);
}
await supabase.from("vault_audit_log").insert({
  user_id: owner.id,
  action: "IMPORT",
  entry_name: null,
  metadata: { source: "turtlepass", imported: prepared.length, skipped: skipped.length, malformed: broken.length },
});
console.log(`\nImportadas ${prepared.length} credenciales. Borra el CSV cuando lo compruebes.`);
