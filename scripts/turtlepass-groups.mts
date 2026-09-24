/**
 * Recovers the grouping of the old TurtlePass manager and mirrors it in the vault.
 * Read-only against the old system (only GET), and it never reads a password:
 * it just needs each entry's id and its group.
 *
 *   node scripts/turtlepass-groups.mts            → shows what it would do
 *   node scripts/turtlepass-groups.mts --commit   → creates the categories and assigns them
 *
 * Needs TURTLEPASS_BASE_URL, TURTLEPASS_API_KEY, NEXT_PUBLIC_SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY in .env.local.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const commit = process.argv.includes("--commit");

const env = new Map<string, string>();
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (match) env.set(match[1], match[2].replace(/^["']|["']$/g, ""));
}
const base = (env.get("TURTLEPASS_BASE_URL") ?? "").replace(/\/+$/, "");
const apiKey = env.get("TURTLEPASS_API_KEY") ?? "";
if (!base || !apiKey) throw new Error("Faltan TURTLEPASS_BASE_URL o TURTLEPASS_API_KEY en .env.local");
const supabase = createClient(env.get("NEXT_PUBLIC_SUPABASE_URL")!, env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

// The docs show an "api key" box but not which header carries it, so the known
// variants are tried once against the harmless /api/versions endpoint.
const HEADER_CANDIDATES: [string, Record<string, string>][] = [
  ["X-AUTH-TOKEN", { "X-AUTH-TOKEN": apiKey }],
  ["X-API-KEY", { "X-API-KEY": apiKey }],
  ["api-key", { "api-key": apiKey }],
  ["apikey", { apikey: apiKey }],
  ["Authorization: Bearer", { Authorization: `Bearer ${apiKey}` }],
  ["Authorization", { Authorization: apiKey }],
];

async function getJson(path: string, headers: Record<string, string>): Promise<{ status: number; json: unknown }> {
  const response = await fetch(`${base}${path}`, { headers: { Accept: "application/json", ...headers }, redirect: "manual" });
  const text = await response.text();
  try {
    return { status: response.status, json: JSON.parse(text) };
  } catch {
    return { status: response.status, json: null };
  }
}

let auth: Record<string, string> | null = null;
for (const [label, headers] of HEADER_CANDIDATES) {
  const probe = await getJson("/api/versions", headers);
  console.log(`${probe.status === 200 && probe.json ? "OK   " : "     "} ${label.padEnd(22)} HTTP ${probe.status}`);
  if (probe.status === 200 && probe.json && !auth) auth = headers;
}
if (!auth) {
  console.log("\nNinguna forma de autenticación ha funcionado. Comprueba la API key y la dirección base.");
  process.exit(1);
}

/** The API may answer a bare array or wrap it in items/data. */
function listOf(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value as Record<string, unknown>[];
  if (value && typeof value === "object") {
    for (const key of ["items", "data", "results", "hydra:member"]) {
      const inner = (value as Record<string, unknown>)[key];
      if (Array.isArray(inner)) return inner as Record<string, unknown>[];
    }
  }
  return [];
}
const idOf = (row: Record<string, unknown>) => String(row.id ?? row.passwordId ?? row.password_id ?? "");
const nameOf = (row: Record<string, unknown>) => String(row.name ?? row.title ?? row.groupname ?? "").trim();

const groupsResponse = await getJson("/api/passwordgroups", auth);
const groups = listOf(groupsResponse.json);
console.log(`\nGrupos encontrados: ${groups.length}`);
if (groups.length === 0) {
  console.log("La respuesta no traía grupos. Campos recibidos:", JSON.stringify(groupsResponse.json).slice(0, 300));
  process.exit(1);
}

const groupByPasswordId = new Map<string, string>();
const summary: { name: string; count: number }[] = [];
for (const group of groups) {
  const groupId = idOf(group);
  const groupName = nameOf(group) || `Grupo ${groupId}`;
  const passwords = listOf((await getJson(`/api/passwordgroups/${groupId}/passwords`, auth)).json);
  for (const password of passwords) groupByPasswordId.set(idOf(password), groupName);
  summary.push({ name: groupName, count: passwords.length });
}
for (const item of summary.sort((a, b) => b.count - a.count)) console.log(`  ${String(item.count).padStart(4)}  ${item.name}`);

// Match against what was imported, using the original id kept on every entry.
const { data: entries } = await supabase.from("vault_entries").select("id, name, legacy_id, category_id").eq("legacy_source", "turtlepass");
const matched = (entries ?? []).filter((entry) => groupByPasswordId.has(String(entry.legacy_id)));
console.log(`\nCredenciales importadas: ${entries?.length ?? 0} · con grupo conocido: ${matched.length}`);
const orphans = (entries ?? []).filter((entry) => !groupByPasswordId.has(String(entry.legacy_id)));
if (orphans.length) console.log(`Sin grupo (se quedan como están): ${orphans.map((entry) => entry.name).join(" · ")}`);

if (!commit) {
  console.log("\nSimulación: no se ha cambiado nada. Repite con --commit para aplicarlo.");
  process.exit(0);
}

// One category per group, reusing any category that already has that name.
const { data: existingCategories } = await supabase.from("vault_categories").select("id, name");
const categoryIdByName = new Map((existingCategories ?? []).map((row) => [String(row.name), String(row.id)]));
let order = 10;
for (const item of summary) {
  if (categoryIdByName.has(item.name)) continue;
  const { data: inserted, error } = await supabase.from("vault_categories").insert({ name: item.name, description: "Grupo importado del gestor anterior", sort_order: order }).select("id").single();
  if (error) throw new Error(`No se pudo crear la categoría ${item.name}: ${error.message}`);
  categoryIdByName.set(item.name, String(inserted.id));
  order += 10;
}

let updated = 0;
for (const entry of matched) {
  const categoryId = categoryIdByName.get(groupByPasswordId.get(String(entry.legacy_id))!);
  if (!categoryId || entry.category_id === categoryId) continue;
  const { error } = await supabase.from("vault_entries").update({ category_id: categoryId }).eq("id", entry.id);
  if (error) throw new Error(`No se pudo actualizar ${entry.name}: ${error.message}`);
  updated++;
}
console.log(`\nCategorías del gestor: ${categoryIdByName.size} · credenciales reclasificadas: ${updated}`);
