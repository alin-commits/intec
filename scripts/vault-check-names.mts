/*
  Compara el nombre de cada credencial del gestor con el que tiene en TurtlePass
  y, si se lo pides, lo deja exactamente igual que allí.

  Por qué hace falta: la migración (turtlepass-migrate.mts) copia el campo `name`
  tal cual, pero con dos filtros que sí pueden cambiarlo: corta a 160 caracteres,
  que es lo que admite la columna, y cuando no le llega nombre escribe "Sin
  nombre". Además lo sacó de la ficha de detalle de la API, que no tiene por qué
  coincidir con el nombre que se ve en el listado de TurtlePass. Este script
  compara contra ese listado, que es lo que tú ves, y dice qué no cuadra y por qué.

  Cada credencial guarda su `legacy_id`, así que el emparejamiento es por id, no
  por nombre: no hay adivinanzas.

  De TurtlePass solo lee la lista de carpetas y los nombres que hay dentro. No
  pide ninguna ficha de detalle, así que ninguna contraseña del gestor antiguo
  llega a salir de allí.

  Con --deep compara además el usuario y la dirección web de cada credencial.
  Eso obliga a abrir la ficha de detalle de cada una, que es la que trae también
  la contraseña: el script no la lee, ni la imprime, ni la guarda, pero conviene
  saber que esa lectura es más invasiva que la normal. --apply no toca estos dos
  campos, solo los nombres: si hay que cambiarlos, lo hablamos antes.

  Lo que NO toca solo: si el nombre que hay en el gestor es el de OTRA ficha de
  TurtlePass, eso no es un nombre mal copiado sino dos fichas cruzadas, y entonces
  la contraseña también puede estar en la ficha equivocada. Esas se listan aparte
  para mirarlas a mano; cambiarles el nombre solo taparía el problema.

  Uso, leyendo del propio TurtlePass (hace falta la sesión de turtlepass-session.mts):
    node scripts/vault-check-names.mts --session "C:\\ruta\\session.json"
    node scripts/vault-check-names.mts --session "C:\\ruta\\session.json" --apply

  Uso, leyendo de una exportación a CSV:
    node scripts/vault-check-names.mts "C:\\ruta\\export.csv"
    node scripts/vault-check-names.mts "C:\\ruta\\export.csv" --apply

  Con --dump guarda lo leído de TurtlePass (id, nombre y carpeta, nunca
  contraseñas) para no tener que volver a entrar en la próxima comprobación.

  No imprime ninguna contraseña: solo nombres, que es lo que se está comparando.
*/
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createClient } from "@supabase/supabase-js";

const require = createRequire(import.meta.url);

const args = process.argv.slice(2);
const VALUE_FLAGS = new Set(["--session", "--dump", "--base"]);
const flag = (name: string) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const positional: string[] = [];
for (let i = 0; i < args.length; i++) {
  const item = args[i];
  if (VALUE_FLAGS.has(item)) { i++; continue; }
  if (!item.startsWith("--")) positional.push(item);
}
const apply = args.includes("--apply");
const deep = args.includes("--deep");
const sessionPath = flag("--session");
const dumpPath = flag("--dump");
const BASE = flag("--base") ?? "https://induxperience.com/passwords/web";
const csvPath = positional[0];
if (!sessionPath && !csvPath) {
  console.error('Uso: node scripts/vault-check-names.mts --session "<session.json>" [--apply]');
  console.error('  o: node scripts/vault-check-names.mts "<export.csv>" [--apply]');
  process.exit(1);
}

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((line) => line.includes("=") && !line.trim().startsWith("#"))
    .map((line) => [line.slice(0, line.indexOf("=")).trim(), line.slice(line.indexOf("=") + 1).trim()]),
);
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

type Original = { name: string; folder: string; username?: string | null; url?: string | null };
const originalById = new Map<string, Original>();
let malformed = 0;

// ---------- fuente: el propio TurtlePass ----------

type Json = Record<string, unknown>;
function listOf(value: unknown): Json[] {
  if (Array.isArray(value)) return value as Json[];
  if (!value || typeof value !== "object") return [];
  const record = value as Json;
  if (Array.isArray(record.items)) return record.items as Json[];
  for (const inner of Object.values((record._embedded as Json) ?? {})) if (Array.isArray(inner)) return inner as Json[];
  return [];
}

async function loadFromTurtlePass(session: string): Promise<void> {
  let playwright: typeof import("playwright") | null = null;
  for (const candidate of ["playwright", "C:/Users/Tienda/AppData/Roaming/npm/node_modules/playwright"]) {
    try { playwright = require(candidate) as typeof import("playwright"); break; } catch { continue; }
  }
  if (!playwright) throw new Error("No encuentro Playwright. Instálalo con: npm i -g playwright");

  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: session });
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

  async function api(path: string): Promise<Json | Json[] | null> {
    const response = await context.request.get(`${BASE}${path}`, { headers });
    if (!response.ok()) return null;
    try { return (await response.json()) as Json | Json[]; } catch { return null; }
  }

  // Las carpetas, con su ruta completa, igual que las montó la migración.
  const folders: { id: number; path: string }[] = [];
  const walk = (nodes: Json[], prefix: string) => {
    for (const node of nodes) {
      const name = String(node.name ?? `Grupo ${node.id}`).trim();
      const path = prefix ? `${prefix} / ${name}` : name;
      folders.push({ id: Number(node.id), path });
      walk(listOf(node.children), path);
    }
  };
  walk(listOf(await api("/api/passwordgroups")), "");
  console.log(`Carpetas en TurtlePass: ${folders.length}`);

  for (const folder of folders) {
    for (let pageNumber = 1; pageNumber <= 30; pageNumber++) {
      const raw = (await api(`/api/passwordgroups/${folder.id}/passwords?limit=100&page=${pageNumber}`)) as Json | null;
      const items = listOf(raw);
      for (const item of items) {
        const id = String(item.id ?? "").trim();
        if (!id) continue;
        const previous = originalById.get(id);
        // Gana la carpeta más honda: una carpeta madre lista también lo de sus hijas.
        if (!previous || folder.path.length > previous.folder.length) {
          originalById.set(id, { name: String(item.name ?? ""), folder: folder.path });
        }
      }
      const pages = Number((raw as Json | null)?.pages ?? 1);
      if (items.length === 0 || pageNumber >= pages) break;
    }
  }

  if (deep) {
    // El usuario y la dirección solo están en la ficha de detalle. De ella se leen
    // esos dos campos y ninguno más: la contraseña que trae al lado se ignora.
    let done = 0;
    for (const [id, item] of originalById) {
      const detail = (await api(`/api/passwords/${id}`)) as Json | null;
      if (detail) {
        item.username = typeof detail.username === "string" && detail.username ? detail.username : null;
        item.url = typeof detail.url === "string" && detail.url ? detail.url : null;
      }
      if (++done % 100 === 0) console.log(`  fichas leídas: ${done}/${originalById.size}`);
    }
  }
  await browser.close();
}

// ---------- fuente: la exportación a CSV ----------

/** El mismo lector que usaron los importadores: TurtlePass exporta con ";" y a veces en UTF-16. */
function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const QUOTE = String.fromCharCode(34);
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === QUOTE) {
        if (input[i + 1] === QUOTE) { field += QUOTE; i++; } else quoted = false;
      } else field += char;
    } else if (char === QUOTE) quoted = true;
    else if (char === ";") { row.push(field); field = ""; }
    else if (char === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (char !== "\r") field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function loadFromCsv(path: string): void {
  const rawFile = readFileSync(path);
  const text = rawFile[0] === 0xff && rawFile[1] === 0xfe ? rawFile.toString("utf16le") : rawFile.toString("utf8").replace(/^\uFEFF/, "");
  const rows = parseCsv(text).filter((row) => row.some((cell) => cell.trim() !== ""));
  const headers = rows[0] ?? [];
  const idColumn = headers.indexOf("password_id");
  const nameColumn = headers.indexOf("password_name");
  if (idColumn < 0 || nameColumn < 0) {
    throw new Error(`El CSV no trae las columnas password_id y password_name. Cabeceras leídas: ${headers.join(", ")}`);
  }
  const body = rows.slice(1);
  // TurtlePass no entrecomilla los campos que llevan ";" dentro, así que esas
  // filas llegan con las columnas corridas y no sirven para comparar.
  const clean = body.filter((row) => row.length === headers.length);
  malformed = body.length - clean.length;
  for (const row of clean) {
    const id = row[idColumn].trim();
    if (!id) continue;
    originalById.set(id, { name: row[nameColumn], folder: "" });
  }
}

if (sessionPath) await loadFromTurtlePass(sessionPath);
else loadFromCsv(csvPath!);

if (dumpPath) {
  writeFileSync(dumpPath, JSON.stringify([...originalById].map(([id, item]) => ({ id, ...item })), null, 2), "utf8");
  console.log(`Volcado de nombres y carpetas guardado en ${dumpPath} (sin contraseñas).`);
}

const idsByName = new Map<string, string[]>();
for (const [id, item] of originalById) {
  const key = item.name.trim();
  idsByName.set(key, [...(idsByName.get(key) ?? []), id]);
}

// ---------- lo que hay ahora en el gestor ----------

type Entry = { id: string; name: string; legacy_id: string | null; username: string | null; url: string | null };
const entries: Entry[] = [];
for (let from = 0; ; from += 500) {
  const { data, error } = await admin
    .from("vault_entries")
    .select("id, name, legacy_id, username, url")
    .eq("legacy_source", "turtlepass")
    .order("legacy_id")
    .range(from, from + 499);
  if (error) throw new Error(`No se pudo leer el gestor: ${error.message}`);
  entries.push(...((data ?? []) as Entry[]));
  if (!data || data.length < 500) break;
}

console.log(`Credenciales importadas de TurtlePass: ${entries.length}`);
console.log(`Fichas leídas de TurtlePass: ${originalById.size}${malformed ? ` (${malformed} filas mal formadas, no se pueden comparar)` : ""}\n`);

// ---------- comparación ----------

type Diff = { entry: Entry; original: string; reason: string };
const identical: Entry[] = [];
const fixable: Diff[] = [];
const swapped: Diff[] = [];
const tooLong: Diff[] = [];
const orphans: Entry[] = [];

for (const entry of entries) {
  const legacyId = (entry.legacy_id ?? "").trim();
  const source = legacyId ? originalById.get(legacyId) : undefined;
  if (source === undefined) { orphans.push(entry); continue; }
  const original = source.name;
  if (entry.name === original) { identical.push(entry); continue; }

  // Por qué no coincide. El orden importa: el corte a 160 y el "Sin nombre" son
  // los dos filtros conocidos de la migración, y explican el grueso.
  let reason: string;
  if (entry.name === original.slice(0, 160)) reason = `cortado a 160 (el original tiene ${original.length})`;
  else if (entry.name === "Sin nombre") reason = "no llegó nombre al importar";
  else if (entry.name.trim() === original.trim()) reason = "solo cambian los espacios";
  else {
    const owners = idsByName.get(entry.name.trim()) ?? [];
    if (owners.length > 0 && !owners.includes(legacyId)) {
      swapped.push({ entry, original, reason: `ese nombre es el de la ficha ${owners.join(", ")} de TurtlePass` });
      continue;
    }
    reason = "distinto";
  }

  if (original.trim().length > 160) tooLong.push({ entry, original, reason });
  else if (original.trim().length === 0) swapped.push({ entry, original, reason: "en TurtlePass está vacío" });
  else fixable.push({ entry, original, reason });
}

const inVault = new Set(entries.map((entry) => (entry.legacy_id ?? "").trim()));
const missing = [...originalById.keys()].filter((id) => !inVault.has(id));

console.log(`Iguales que en TurtlePass:      ${identical.length}`);
console.log(`Se pueden dejar iguales:        ${fixable.length}`);
console.log(`Para mirar a mano:              ${swapped.length + tooLong.length}`);
console.log(`No están en TurtlePass:         ${orphans.length}`);
console.log(`En TurtlePass y no en el gestor: ${missing.length}\n`);

if (fixable.length) {
  console.log("Nombres que no coinciden y se pueden corregir:");
  for (const item of fixable) console.log(`  · «${item.entry.name}» → «${item.original}»  (${item.reason})`);
  console.log("");
}
if (tooLong.length) {
  console.log("Nombres de más de 160 caracteres: la columna no los admite enteros.");
  console.log("Hay que subir el límite de vault_entries.name antes de poder dejarlos tal cual:");
  for (const item of tooLong) console.log(`  · ${item.original.length} caracteres: «${item.original}»`);
  console.log("");
}
if (swapped.length) {
  console.log("CRUZADAS — no se tocan solas. El nombre que hay es el de otra ficha, así que");
  console.log("la contraseña de estas puede ser también la que no toca. Revísalas en TurtlePass:");
  for (const item of swapped) console.log(`  · legacy ${item.entry.legacy_id}: «${item.entry.name}» pero en TurtlePass es «${item.original}» (${item.reason})`);
  console.log("");
}
if (orphans.length) {
  console.log(`Credenciales del gestor que no aparecen en TurtlePass (puede que se creasen después): ${orphans.length}`);
  for (const item of orphans.slice(0, 20)) console.log(`  · legacy ${item.legacy_id ?? "(sin id)"}: «${item.name}»`);
  if (orphans.length > 20) console.log(`  · … y ${orphans.length - 20} más`);
  console.log("");
}
if (missing.length) {
  console.log(`Fichas de TurtlePass que no llegaron al gestor: ${missing.length}`);
  for (const id of missing.slice(0, 20)) console.log(`  · ${id}: «${originalById.get(id)?.name}»`);
  if (missing.length > 20) console.log(`  · … y ${missing.length - 20} más`);
  console.log("");
}

// ---------- usuario y dirección (solo con --deep) ----------

if (deep) {
  const norm = (value: string | null | undefined) => (value ?? "").trim();
  type FieldDiff = { entry: Entry; field: string; there: string; here: string; reason: string };
  const fieldDiffs: FieldDiff[] = [];
  let unread = 0;
  for (const entry of entries) {
    const legacyId = (entry.legacy_id ?? "").trim();
    const source = legacyId ? originalById.get(legacyId) : undefined;
    // username a undefined significa que no se pudo abrir esa ficha, no que esté vacía.
    if (!source || source.username === undefined) { unread++; continue; }
    for (const [field, there, here] of [["usuario", source.username, entry.username], ["dirección", source.url, entry.url]] as const) {
      if (norm(there) === norm(here)) continue;
      let reason: string;
      if (!norm(here)) {
        // La migración descartó las direcciones que no empezaban por http.
        reason = field === "dirección" && !/^https?:\/\//i.test(norm(there)) ? "no llegó: no empezaba por http" : "no llegó al gestor";
      } else if (!norm(there)) reason = "está en el gestor y no en TurtlePass";
      else reason = "distinto";
      fieldDiffs.push({ entry, field, there: norm(there), here: norm(here), reason });
    }
  }
  console.log(`Usuario y dirección: ${fieldDiffs.length} diferencias${unread ? ` · ${unread} fichas que no se pudieron abrir` : ""}`);
  for (const item of fieldDiffs) {
    console.log(`  · «${item.entry.name}» ${item.field}: TurtlePass «${item.there}» · gestor «${item.here}» (${item.reason})`);
  }
  console.log("");
}

// ---------- corrección ----------

if (!apply) {
  console.log(fixable.length ? "En seco: no se ha tocado nada. Repite con --apply para dejarlos como en TurtlePass." : "No hay nada que corregir automáticamente.");
  process.exit(0);
}

let fixed = 0;
for (const item of fixable) {
  const { error } = await admin.from("vault_entries").update({ name: item.original }).eq("id", item.entry.id);
  if (error) { console.log(`  ERROR en «${item.entry.name}»: ${error.message}`); continue; }
  // Sin user_id: no lo hace una persona desde la aplicación, sino este arreglo.
  await admin.from("vault_audit_log").insert({
    user_id: null,
    vault_entry_id: item.entry.id,
    entry_name: item.original,
    action: "ENTRY_UPDATE",
    metadata: { arreglo: "nombre-como-en-turtlepass", antes: item.entry.name, motivo: item.reason },
  });
  fixed++;
}
console.log(`\nNombres devueltos a como estaban en TurtlePass: ${fixed}`);
