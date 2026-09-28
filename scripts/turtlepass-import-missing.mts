/*
  Trae al gestor las credenciales de TurtlePass que la migración se dejó.

  Qué pasó: la migración recorrió las carpetas pidiendo /api/passwordgroups/{id}/
  passwords?limit=100. En las carpetas grandes ese listado devuelve menos fichas
  de las que él mismo dice tener —"Suministros Intec" dice 99 y entrega 34— así
  que lo que no salía en el listado no llegó nunca. No es que se perdieran
  nombres: faltan credenciales enteras.

  Cómo lo arregla: no se fía de ningún listado. Prueba las fichas por número, de
  1 en adelante, que es lo único que la API devuelve sin faltar a nadie, y se
  queda con las que el gestor todavía no tiene. La carpeta de cada una sale del
  buscador (/api/passwords/<texto>/search, que sí trae password_group) y se casa
  con la del gestor por la ruta entera, así que las que se llaman igual en
  departamentos distintos no se confunden.

  Cada contraseña se cifra aquí, en tu equipo, con la misma clave y el mismo
  método que las que ya están. No se imprime ninguna.

  Uso:
    node scripts/turtlepass-import-missing.mts --session "C:\\ruta\\session.json"
    node scripts/turtlepass-import-missing.mts --session "C:\\ruta\\session.json" --apply

  Sin --apply solo dice lo que haría. Es repetible: lo que ya está no se duplica.
*/
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { encryptWithKey, parseVaultKey, passwordFingerprint, VAULT_ENCRYPTION_VERSION } from "../src/lib/security/vault-crypto.ts";
import { passwordStrength } from "../src/lib/vault/password-generator.ts";

const require = createRequire(import.meta.url);

const args = process.argv.slice(2);
const flag = (name: string) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const apply = args.includes("--apply");
const sessionPath = flag("--session");
const ownerEmail = flag("--owner") ?? "alin@suministrointec.com";
const BASE = flag("--base") ?? "https://induxperience.com/passwords/web";
const MAX_ID = Number(flag("--max") ?? 900);
if (!sessionPath) {
  console.error('Uso: node scripts/turtlepass-import-missing.mts --session "C:\\ruta\\session.json" [--apply]');
  process.exit(1);
}

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((line) => line.includes("=") && !line.trim().startsWith("#"))
    .map((line) => [line.slice(0, line.indexOf("=")).trim(), line.slice(line.indexOf("=") + 1).trim()]),
);
const vaultKey = parseVaultKey(env.VAULT_ENCRYPTION_KEY);
const restBase = env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/+$/, "");
const restKey = env.SUPABASE_SERVICE_ROLE_KEY;
async function rest(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`${restBase}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: restKey, Authorization: `Bearer ${restKey}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status} ${await response.text()}`);
  // Al escribir con Prefer: return=minimal la respuesta viene sin cuerpo, y
  // pedirle el JSON directamente reventaba después de haber guardado las filas.
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

// ---------- el gestor antiguo ----------

let playwright: typeof import("playwright") | null = null;
for (const candidate of ["playwright", "C:/Users/Tienda/AppData/Roaming/npm/node_modules/playwright"]) {
  try { playwright = require(candidate) as typeof import("playwright"); break; } catch { continue; }
}
if (!playwright) throw new Error("No encuentro Playwright. Instálalo con: npm i -g playwright");

const browser = await playwright.chromium.launch({ headless: true });
const context = await browser.newContext({ storageState: sessionPath });
const page = await context.newPage();
let captured: Record<string, string> | null = null;
page.on("request", (request) => {
  if (!captured && request.url().includes("/api/passwordgroups")) captured = request.headers();
});
await page.goto(`${BASE}/`, { waitUntil: "networkidle" }).catch(() => {});
await page.waitForTimeout(4000);
if (!captured) {
  await browser.close();
  throw new Error("La sesión guardada ya no vale. Vuelve a pasar turtlepass-session.mts y repite.");
}
const headers: Record<string, string> = { ...(captured as Record<string, string>) };
delete headers["content-length"];

type Json = Record<string, unknown>;
async function api(path: string): Promise<Json | Json[] | null> {
  const response = await context.request.get(`${BASE}${path}`, { headers });
  if (!response.ok()) return null;
  try { return (await response.json()) as Json | Json[]; } catch { return null; }
}
function listOf(value: unknown): Json[] {
  if (Array.isArray(value)) return value as Json[];
  if (!value || typeof value !== "object") return [];
  const record = value as Json;
  if (Array.isArray(record.items)) return record.items as Json[];
  for (const inner of Object.values((record._embedded as Json) ?? {})) if (Array.isArray(inner)) return inner as Json[];
  return [];
}

/** La ruta completa de cada carpeta del gestor antiguo, por su número. */
const pathByGroupId = new Map<number, string>();
const walk = (nodes: Json[], prefix: string) => {
  for (const node of nodes) {
    const name = String(node.name ?? `Grupo ${node.id}`).trim();
    const path = prefix ? `${prefix} / ${name}` : name;
    pathByGroupId.set(Number(node.id), path);
    walk(listOf(node.children), path);
  }
};
walk(listOf(await api("/api/passwordgroups")), "");

// ---------- lo que ya está en el gestor ----------

const existing = (await rest("vault_entries?select=legacy_id&legacy_source=eq.turtlepass&limit=2000")) as { legacy_id: string | null }[];
const already = new Set(existing.map((row) => String(row.legacy_id ?? "").trim()));
console.log(`Ya en el gestor: ${already.size}`);

const categories = (await rest("vault_categories?select=id,name,parent_id&limit=500")) as { id: string; name: string; parent_id: string | null }[];
const categoryById = new Map(categories.map((row) => [row.id, row]));
const categoryIdByPath = new Map<string, string>();
for (const category of categories) {
  const parts: string[] = [];
  let current: typeof category | undefined = category;
  while (current && parts.length < 10) {
    parts.unshift(current.name);
    current = current.parent_id ? categoryById.get(current.parent_id) : undefined;
  }
  categoryIdByPath.set(parts.join(" / "), category.id);
}

const owner = (await rest(`profiles?select=id&email=eq.${encodeURIComponent(ownerEmail)}&limit=1`)) as { id: string }[];
if (owner.length === 0) throw new Error(`No hay ningún usuario con el correo ${ownerEmail}`);

// ---------- las que faltan ----------

const CATEGORY_OF_TYPE: Record<string, string> = { plain: "plain", email: "email", server: "server", "bank-account": "bank", "credit-card": "bank", "software-license": "other" };
const KNOWN_FIELDS = new Set(["access", "complete", "id", "name", "icon", "log_enabled", "url", "username", "password", "create_date", "last_update_date", "custom_fields", "password_type", "notice"]);

type Pending = { id: string; name: string; row: Record<string, unknown>; folder: string; noPassword: boolean };
const pending: Pending[] = [];
const groupOfEntry = new Map<string, number>();

/** El buscador es el único sitio que dice en qué carpeta está cada ficha. */
async function learnGroups(term: string) {
  for (const item of listOf(await api(`/api/passwords/${encodeURIComponent(term)}/search`))) {
    const group = item.password_group as Json | undefined;
    if (group?.id !== undefined) groupOfEntry.set(String(item.id), Number(group.id));
  }
}
for (const letter of "abcdefghijklmnopqrstuvwxyz0123456789".split("")) await learnGroups(letter);

let checked = 0;
for (let id = 1; id <= MAX_ID; id++) {
  if (++checked % 150 === 0) console.log(`  probadas ${checked}/${MAX_ID} · pendientes ${pending.length}`);
  if (already.has(String(id))) continue;
  const detail = (await api(`/api/passwords/${id}`)) as Json | null;
  if (!detail || detail.id === undefined) continue;

  const name = String(detail.name ?? "Sin nombre").slice(0, 160);
  // Si el buscador no la vio, se busca por su propio nombre para sacar la carpeta.
  if (!groupOfEntry.has(String(id))) await learnGroups(name.slice(0, 20));
  const folder = pathByGroupId.get(groupOfEntry.get(String(id)) ?? -1) ?? "";

  let secret = typeof detail.password === "string" && detail.password ? detail.password : "";
  const noPassword = secret === "";
  if (noPassword) secret = "(sin contraseña en el gestor anterior — revisar)";

  const extras = Object.entries(detail)
    .filter(([key, value]) => !KNOWN_FIELDS.has(key) && value !== null && value !== "" && typeof value !== "object")
    .map(([key, value]) => `${key}: ${String(value)}`);
  const notice = typeof detail.notice === "string" ? detail.notice.trim() : "";
  const notes = [notice, ...extras].filter(Boolean).join("\n");

  const password = encryptWithKey(vaultKey, secret, "password");
  const encryptedNotes = notes ? encryptWithKey(vaultKey, notes, "notes") : null;
  const createdAt = typeof detail.create_date === "string" && /^\d{4}-\d{2}-\d{2}/.test(detail.create_date)
    ? new Date(detail.create_date).toISOString()
    : new Date().toISOString();

  pending.push({
    id: String(id),
    name,
    folder,
    noPassword,
    row: {
      name,
      url: typeof detail.url === "string" && /^https?:\/\//i.test(detail.url) ? detail.url : null,
      username: typeof detail.username === "string" && detail.username ? detail.username : null,
      password_ciphertext: password.ciphertext,
      password_iv: password.iv,
      password_tag: password.tag,
      password_fingerprint: passwordFingerprint(vaultKey, secret),
      password_strength: passwordStrength(secret).level,
      notes_ciphertext: encryptedNotes?.ciphertext ?? null,
      notes_iv: encryptedNotes?.iv ?? null,
      notes_tag: encryptedNotes?.tag ?? null,
      visibility: "shared",
      entry_type: CATEGORY_OF_TYPE[String(detail.password_type ?? "plain")] ?? "other",
      category_id: categoryIdByPath.get(folder) ?? null,
      created_by: owner[0].id,
      created_at: createdAt,
      encryption_version: VAULT_ENCRYPTION_VERSION,
      legacy_source: "turtlepass",
      legacy_id: String(id),
    },
  });
}
await browser.close();

const byFolder = new Map<string, number>();
for (const item of pending) byFolder.set(item.folder || "(sin carpeta)", (byFolder.get(item.folder || "(sin carpeta)") ?? 0) + 1);

console.log(`\nCredenciales que faltaban: ${pending.length}`);
for (const [folder, count] of [...byFolder.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(count).padStart(4)}  ${folder}`);
const homeless = pending.filter((item) => item.row.category_id === null);
if (homeless.length) console.log(`\nSin carpeta que les corresponda en el gestor: ${homeless.length} (entrarán como "sin carpeta")`);
const noPassword = pending.filter((item) => item.noPassword);
if (noPassword.length) {
  console.log(`\nSin contraseña en el gestor anterior, hay que mirarlas a mano: ${noPassword.length}`);
  for (const item of noPassword) console.log(`  · ${item.name}`);
}

if (!apply) {
  console.log("\nEn seco: no se ha escrito nada. Repite con --apply para traerlas.");
  process.exit(0);
}

for (let index = 0; index < pending.length; index += 50) {
  const chunk = pending.slice(index, index + 50).map((item) => item.row);
  await rest("vault_entries", { method: "POST", body: JSON.stringify(chunk), headers: { Prefer: "return=minimal" } });
  console.log(`  guardadas ${Math.min(index + 50, pending.length)}/${pending.length}`);
}
await rest("vault_audit_log", {
  method: "POST",
  body: JSON.stringify({
    user_id: owner[0].id,
    action: "IMPORT",
    metadata: { arreglo: "credenciales-que-la-migracion-no-vio", traidas: pending.length, origen: "turtlepass-por-id" },
  }),
  headers: { Prefer: "return=minimal" },
});
console.log(`\nTraídas al gestor: ${pending.length}`);
