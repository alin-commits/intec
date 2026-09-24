/**
 * Full migration from the old TurtlePass manager, folders included. Reads through
 * the app's own API reusing the session you opened by hand, encrypts every
 * password locally and writes it to the vault.
 *
 *   node scripts/turtlepass-migrate.mts --session <ruta-session.json>
 *   node scripts/turtlepass-migrate.mts --session <ruta-session.json> --commit
 *
 * Without --commit nothing is written. No password is ever printed.
 * Needs NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VAULT_ENCRYPTION_KEY
 * in .env.local, plus --owner <correo> for who owns the imported entries.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createClient } from "@supabase/supabase-js";
import { encryptWithKey, parseVaultKey } from "../src/lib/security/vault-crypto.ts";

const require = createRequire(import.meta.url);
const { chromium } = require("C:/Users/Tienda/AppData/Roaming/npm/node_modules/playwright") as typeof import("playwright");

const args = process.argv.slice(2);
const flag = (name: string) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const commit = args.includes("--commit");
const sessionPath = flag("--session");
const ownerEmail = flag("--owner") ?? "alin@suministrointec.com";
const BASE = flag("--base") ?? "https://induxperience.com/passwords/web";
/** Bank-type entries keep their data in fields the API does not expose; the CSV export does have them. */
const csvPath = flag("--csv");
if (!sessionPath) throw new Error("Falta --session <ruta al session.json guardado al iniciar sesión>");

const env = new Map<string, string>();
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (match) env.set(match[1], match[2].replace(/^["']|["']$/g, ""));
}
const vaultKey = parseVaultKey(env.get("VAULT_ENCRYPTION_KEY"));

type CsvRow = Record<string, string>;
const csvById = new Map<string, CsvRow>();
if (csvPath) {
  const raw = readFileSync(csvPath);
  const text = raw[0] === 0xff && raw[1] === 0xfe ? raw.toString("utf16le") : raw.toString("utf8").replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ";") { row.push(field); field = ""; }
    else if (char === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (char !== "\r") field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const clean = rows.filter((item) => item.some((cell) => cell.trim() !== ""));
  const headerRow = clean[0];
  for (const item of clean.slice(1)) {
    if (item.length !== headerRow.length) continue;
    const record: CsvRow = {};
    headerRow.forEach((name, index) => { record[name] = item[index]; });
    csvById.set((record.password_id ?? "").trim(), record);
  }
  console.log(`Filas del CSV disponibles como respaldo: ${csvById.size}`);
}

const CSV_EXTRA_FIELDS: [string, string][] = [
  ["password_bankname", "Banco"],
  ["password_accountholder", "Titular"],
  ["password_bankcode", "Código bancario"],
  ["password_accountnumber", "Nº de cuenta"],
  ["password_iban", "IBAN"],
  ["password_bankpin", "PIN"],
  ["password_notice", "Notas"],
];
const supabase = createClient(env.get("NEXT_PUBLIC_SUPABASE_URL")!, env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

// ---------- old manager ----------

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ storageState: sessionPath });
const page = await context.newPage();
let captured: Record<string, string> | null = null;
page.on("request", (request) => {
  if (!captured && request.url().includes("/api/passwordgroups")) captured = request.headers();
});
await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await page.goto(`${BASE}/#!/overview/group/30`, { waitUntil: "networkidle" }).catch(() => {});
await page.waitForTimeout(4000);
if (!captured) {
  await browser.close();
  throw new Error("No he podido reutilizar la sesión: vuelve a iniciar sesión y guarda el session.json.");
}
const headers: Record<string, string> = { ...(captured as Record<string, string>) };
delete headers["content-length"];

type Json = Record<string, unknown>;
async function api(path: string): Promise<Json | Json[] | null> {
  const response = await context.request.get(`${BASE}${path}`, { headers });
  if (!response.ok()) return null;
  try {
    return (await response.json()) as Json | Json[];
  } catch {
    return null;
  }
}
function listOf(value: unknown): Json[] {
  if (Array.isArray(value)) return value as Json[];
  if (!value || typeof value !== "object") return [];
  const record = value as Json;
  if (Array.isArray(record.items)) return record.items as Json[];
  for (const inner of Object.values((record._embedded as Json) ?? {})) if (Array.isArray(inner)) return inner as Json[];
  return [];
}

type Folder = { id: number; path: string };
const folders: Folder[] = [];
const walk = (nodes: Json[], prefix: string) => {
  for (const node of nodes) {
    const name = String(node.name ?? `Grupo ${node.id}`).trim();
    const path = prefix ? `${prefix} / ${name}` : name;
    folders.push({ id: Number(node.id), path });
    walk(listOf(node.children), path);
  }
};
walk(listOf(await api("/api/passwordgroups")), "");
console.log(`Carpetas en el gestor antiguo: ${folders.length}`);

/** Every entry, with the deepest folder it appears in (parents also list their children's items). */
const entryFolder = new Map<number, string>();
const entryName = new Map<number, string>();
for (const folder of folders) {
  for (let pageNumber = 1; pageNumber <= 30; pageNumber++) {
    const raw = (await api(`/api/passwordgroups/${folder.id}/passwords?limit=100&page=${pageNumber}`)) as Json | null;
    for (const item of listOf(raw)) {
      const id = Number(item.id);
      const previous = entryFolder.get(id);
      // A deeper path wins, so "Marketing / Blizzcool" beats "Marketing".
      if (!previous || folder.path.length > previous.length) entryFolder.set(id, folder.path);
      entryName.set(id, String(item.name ?? "").trim());
    }
    const pages = Number((raw as Json | null)?.pages ?? 1);
    if (pageNumber >= pages) break;
  }
}
console.log(`Credenciales encontradas: ${entryFolder.size}`);

const CATEGORY_OF_TYPE: Record<string, string> = { plain: "plain", email: "email", server: "server", "bank-account": "bank", "credit-card": "bank", "software-license": "other" };
const KNOWN_FIELDS = new Set(["access", "id", "name", "icon", "log_enabled", "url", "username", "password", "create_date", "last_update_date", "custom_fields", "password_type", "notice"]);

type Prepared = { legacyId: number; name: string; folder: string; row: Json };
const prepared: Prepared[] = [];
const failed: string[] = [];
const needsReview: string[] = [];

for (const [id, folder] of entryFolder) {
  const detail = (await api(`/api/passwords/${id}`)) as Json | null;
  if (!detail) {
    failed.push(`${entryName.get(id) ?? id} (no se pudo leer)`);
    continue;
  }
  // Bank entries come back with an empty password: their data is in the CSV export.
  const fallback = csvById.get(String(id));
  const csvExtras = fallback
    ? CSV_EXTRA_FIELDS.map(([column, label]) => ({ label, value: (fallback[column] ?? "").trim() })).filter((item) => item.value).map((item) => `${item.label}: ${item.value}`)
    : [];
  let secret = typeof detail.password === "string" && detail.password ? detail.password : "";
  if (!secret) secret = (fallback?.password_password ?? "").trim() || (fallback?.password_bankpin ?? "").trim();
  if (!secret) {
    // Nothing to protect, but the entry itself must not be lost.
    secret = "(sin contraseña en el gestor anterior — revisar)";
    needsReview.push(entryName.get(id) ?? String(id));
  }
  // Anything outside the standard fields (bank, email, server data) goes into the notes.
  const extras = Object.entries(detail)
    .filter(([key, value]) => !KNOWN_FIELDS.has(key) && value !== null && value !== "" && typeof value !== "object")
    .map(([key, value]) => `${key}: ${String(value)}`);
  const notice = typeof detail.notice === "string" ? detail.notice.trim() : "";
  const notes = [notice, ...extras, ...csvExtras].filter(Boolean).join("\n");

  const password = encryptWithKey(vaultKey, secret, "password");
  const encryptedNotes = notes ? encryptWithKey(vaultKey, notes, "notes") : null;
  const createdAt = typeof detail.create_date === "string" && /^\d{4}-\d{2}-\d{2}/.test(detail.create_date) ? new Date(detail.create_date).toISOString() : new Date().toISOString();

  prepared.push({
    legacyId: id,
    name: String(detail.name ?? entryName.get(id) ?? "Sin nombre").slice(0, 160),
    folder,
    row: {
      name: String(detail.name ?? entryName.get(id) ?? "Sin nombre").slice(0, 160),
      url: typeof detail.url === "string" && /^https?:\/\//i.test(detail.url) ? detail.url : null,
      username: typeof detail.username === "string" && detail.username ? detail.username : null,
      password_ciphertext: password.ciphertext,
      password_iv: password.iv,
      password_tag: password.tag,
      notes_ciphertext: encryptedNotes?.ciphertext ?? null,
      notes_iv: encryptedNotes?.iv ?? null,
      notes_tag: encryptedNotes?.tag ?? null,
      visibility: "shared",
      entry_type: CATEGORY_OF_TYPE[String(detail.password_type ?? "plain")] ?? "other",
      created_at: createdAt,
      encryption_version: password.version,
      legacy_source: "turtlepass",
      legacy_id: String(id),
    },
  });
}
await browser.close();

const byFolder = new Map<string, number>();
for (const item of prepared) byFolder.set(item.folder, (byFolder.get(item.folder) ?? 0) + 1);
console.log("\nA importar, por carpeta:");
for (const [folder, count] of [...byFolder.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(count).padStart(4)}  ${folder}`);
console.log(`\nTotal: ${prepared.length}${failed.length ? ` · sin poder leer: ${failed.length} → ${failed.join(" · ")}` : ""}`);
if (needsReview.length) console.log(`Para revisar a mano (datos bancarios sin contraseña): ${needsReview.join(" · ")}`);

if (!commit) {
  console.log("\nSimulación: no se ha escrito nada. Repite con --commit.");
  process.exit(0);
}

// ---------- vault ----------

const { data: owner } = await supabase.from("profiles").select("id").eq("email", ownerEmail).maybeSingle();
if (!owner) throw new Error(`No hay ningún usuario con el correo ${ownerEmail}`);

const { data: existingCategories } = await supabase.from("vault_categories").select("id, name");
const categoryIdByName = new Map((existingCategories ?? []).map((row) => [String(row.name), String(row.id)]));
let order = 10;
for (const folder of byFolder.keys()) {
  if (categoryIdByName.has(folder)) continue;
  const { data, error } = await supabase.from("vault_categories").insert({ name: folder, description: "Carpeta del gestor anterior", sort_order: order }).select("id").single();
  if (error) throw new Error(`No se pudo crear la categoría ${folder}: ${error.message}`);
  categoryIdByName.set(folder, String(data.id));
  order += 10;
}

// Replaces the previous partial import; nothing else in the vault is touched.
const { error: deleteError } = await supabase.from("vault_entries").delete().eq("legacy_source", "turtlepass");
if (deleteError) throw new Error(`No se pudo limpiar la importación anterior: ${deleteError.message}`);

const rows = prepared.map((item) => ({ ...item.row, category_id: categoryIdByName.get(item.folder) ?? null, created_by: owner.id }));
for (let index = 0; index < rows.length; index += 100) {
  const { error } = await supabase.from("vault_entries").insert(rows.slice(index, index + 100));
  if (error) throw new Error(`No se pudo insertar el bloque ${index}: ${error.message}`);
}
await supabase.from("vault_audit_log").insert({
  user_id: owner.id,
  action: "IMPORT",
  metadata: { source: "turtlepass-api", imported: rows.length, folders: byFolder.size },
});
console.log(`\nImportadas ${rows.length} credenciales en ${byFolder.size} carpetas.`);
