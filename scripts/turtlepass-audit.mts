/*
  Cuenta cuántas credenciales hay de verdad en TurtlePass y dice cuáles no
  llegaron al gestor nuevo.

  Por qué hace falta: la migración recorrió las carpetas una a una y se quedó con
  lo que cada listado devolvía. Si ese camino deja fichas fuera, el resultado sale
  incompleto y comparar con el mismo recorrido no lo detecta: da igual dos veces.
  Aquí se cuenta por caminos distintos y se contrastan entre sí.

    1. El listado global /api/passwords, si la API lo ofrece: la cuenta buena.
    2. El recorrido por carpetas, el mismo que usó la migración.
    3. La búsqueda, con la que se rescatan las que no salen en ningún listado.

  Si 1 y 2 no dan el mismo número, la diferencia son fichas que la migración no
  pudo ver, y se listan una a una con su carpeta.

  Solo lee nombres, carpetas e identificadores. No abre ninguna ficha de detalle,
  así que ninguna contraseña del gestor antiguo sale de allí.

  Uso:
    node scripts/turtlepass-audit.mts --session "C:\\ruta\\session.json"
*/
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const args = process.argv.slice(2);
const flag = (name: string) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const sessionPath = flag("--session");
const dumpPath = flag("--dump");
const BASE = flag("--base") ?? "https://induxperience.com/passwords/web";
if (!sessionPath) {
  console.error('Uso: node scripts/turtlepass-audit.mts --session "C:\\ruta\\session.json"');
  process.exit(1);
}

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((line) => line.includes("=") && !line.trim().startsWith("#"))
    .map((line) => [line.slice(0, line.indexOf("=")).trim(), line.slice(line.indexOf("=") + 1).trim()]),
);
const restBase = env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/+$/, "");
const restKey = env.SUPABASE_SERVICE_ROLE_KEY;
async function rest(path: string): Promise<Record<string, unknown>[]> {
  const response = await fetch(`${restBase}/rest/v1/${path}`, { headers: { apikey: restKey, Authorization: `Bearer ${restKey}` } });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status} ${await response.text()}`);
  return (await response.json()) as Record<string, unknown>[];
}

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
async function api(path: string): Promise<{ body: Json | Json[] | null; status: number }> {
  const response = await context.request.get(`${BASE}${path}`, { headers });
  if (!response.ok()) return { body: null, status: response.status() };
  try { return { body: (await response.json()) as Json | Json[], status: response.status() }; } catch { return { body: null, status: response.status() }; }
}
function listOf(value: unknown): Json[] {
  if (Array.isArray(value)) return value as Json[];
  if (!value || typeof value !== "object") return [];
  const record = value as Json;
  if (Array.isArray(record.items)) return record.items as Json[];
  for (const inner of Object.values((record._embedded as Json) ?? {})) if (Array.isArray(inner)) return inner as Json[];
  return [];
}

type Found = { id: string; name: string; folder: string; source: string };
const found = new Map<string, Found>();
const remember = (item: Json, folder: string, source: string) => {
  const id = String(item.id ?? "").trim();
  if (!id) return;
  const previous = found.get(id);
  if (previous && previous.folder && !folder) return;
  found.set(id, { id, name: String(item.name ?? ""), folder: folder || previous?.folder || "", source: previous ? previous.source : source });
};

// ---------- 1. el listado global ----------

let globalTotal: number | null = null;
for (const path of ["/api/passwords", "/api/passwords?limit=100"]) {
  const probe = await api(path);
  if (!probe.body) { console.log(`GET ${path} → HTTP ${probe.status}`); continue; }
  const record = probe.body as Json;
  const reported = Number(record.total ?? record.count ?? NaN);
  if (Number.isFinite(reported)) globalTotal = reported;
  let read = 0;
  for (let pageNumber = 1; pageNumber <= 60; pageNumber++) {
    const { body } = await api(`/api/passwords?limit=100&page=${pageNumber}`);
    const items = listOf(body);
    for (const item of items) remember(item, "", "listado global");
    read += items.length;
    const pages = Number((body as Json | null)?.pages ?? 0);
    if (items.length === 0 || (pages > 0 && pageNumber >= pages)) break;
  }
  console.log(`Listado global: ${read} fichas leídas${globalTotal !== null ? ` · la API dice que hay ${globalTotal}` : ""}`);
  break;
}

// ---------- 2. el recorrido por carpetas, como hizo la migración ----------

const folders: { id: number; path: string }[] = [];
const walk = (nodes: Json[], prefix: string) => {
  for (const node of nodes) {
    const name = String(node.name ?? `Grupo ${node.id}`).trim();
    const path = prefix ? `${prefix} / ${name}` : name;
    folders.push({ id: Number(node.id), path });
    walk(listOf(node.children), path);
  }
};
walk(listOf((await api("/api/passwordgroups")).body), "");

const byFolder = new Map<string, number>();
let viaFolders = 0;
for (const folder of folders) {
  // De diez en diez, que es como pagina la propia interfaz. Con limit=100 el
  // servidor contesta con menos fichas de las que dice tener y se pierden.
  let reported = 0;
  for (let pageNumber = 1; pageNumber <= 200; pageNumber++) {
    const { body } = await api(`/api/passwordgroups/${folder.id}/passwords?limit=10&page=${pageNumber}`);
    const items = listOf(body);
    reported = Number((body as Json | null)?.total ?? reported);
    for (const item of items) {
      remember(item, folder.path, "carpetas");
      viaFolders++;
      byFolder.set(folder.path, (byFolder.get(folder.path) ?? 0) + 1);
    }
    const pages = Number((body as Json | null)?.pages ?? 1);
    if (pageNumber >= pages) break;
  }
  const seen = byFolder.get(folder.path) ?? 0;
  if (reported && seen < reported) console.log(`  aviso: ${folder.path} dice tener ${reported} y solo he podido leer ${seen}`);
}
console.log(`Recorrido por carpetas: ${viaFolders} apariciones en ${folders.length} carpetas`);

// ---------- 3. la búsqueda, para lo que no sale en ningún listado ----------

const letters = "abcdefghijklmnopqrstuvwxyz0123456789".split("");
let viaSearch = 0;
for (const letter of letters) {
  const { body } = await api(`/api/passwords/${letter}/search`);
  for (const item of listOf(body)) {
    if (!found.has(String(item.id ?? ""))) viaSearch++;
    remember(item, "", "búsqueda");
  }
}
console.log(`Búsqueda letra a letra: ${viaSearch} fichas que no había visto de otra forma`);
await browser.close();

console.log(`\nFichas distintas encontradas en TurtlePass: ${found.size}`);

// ---------- contraste con el gestor ----------

const entries = await rest("vault_entries?select=name,legacy_id,category_id&legacy_source=eq.turtlepass&limit=2000");
const cats = await rest("vault_categories?select=id,name,parent_id&limit=500");
const catById = new Map(cats.map((c) => [String(c.id), c]));
const pathOf = (id: unknown) => {
  const parts: string[] = [];
  let current = id ? catById.get(String(id)) : undefined;
  while (current && parts.length < 10) {
    parts.unshift(String(current.name));
    current = current.parent_id ? catById.get(String(current.parent_id)) : undefined;
  }
  return parts.join(" / ") || "(sin carpeta)";
};
const inVault = new Map(entries.map((row) => [String(row.legacy_id ?? "").trim(), row]));
console.log(`Credenciales en el gestor: ${entries.length}`);

const missing = [...found.values()].filter((item) => !inVault.has(item.id));
const extra = entries.filter((row) => !found.has(String(row.legacy_id ?? "").trim()));

console.log(`\nEn TurtlePass y NO en el gestor: ${missing.length}`);
for (const item of missing) console.log(`  · id ${item.id} · «${item.name}» · [${item.folder || "sin carpeta conocida"}] · visto por: ${item.source}`);

console.log(`\nEn el gestor y no en TurtlePass: ${extra.length}`);
for (const row of extra.slice(0, 20)) console.log(`  · legacy ${row.legacy_id} · «${row.name}» · [${pathOf(row.category_id)}]`);

const renamed = [...found.values()].filter((item) => {
  const row = inVault.get(item.id);
  return row && String(row.name) !== item.name;
});
console.log(`\nMismo id pero distinto nombre: ${renamed.length}`);
for (const item of renamed) console.log(`  · id ${item.id}: TurtlePass «${item.name}» · gestor «${inVault.get(item.id)?.name}»`);

if (dumpPath) {
  writeFileSync(dumpPath, JSON.stringify([...found.values()], null, 2), "utf8");
  console.log(`\nVolcado guardado en ${dumpPath} (nombres y carpetas, sin contraseñas).`);
}
