/**
 * Figures out how to talk to the old TurtlePass API: which authentication header
 * it accepts and which endpoints exist. Read-only, prints no credential.
 *
 *   node scripts/turtlepass-discover.mts
 *
 * Needs TURTLEPASS_BASE_URL and TURTLEPASS_API_KEY in .env.local.
 */
import { readFileSync } from "node:fs";

const env = new Map<string, string>();
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (match) env.set(match[1], match[2].replace(/^["']|["']$/g, ""));
}
const base = (env.get("TURTLEPASS_BASE_URL") ?? "").replace(/\/+$/, "");
const apiKey = env.get("TURTLEPASS_API_KEY") ?? "";
if (!base || !apiKey) throw new Error("Faltan TURTLEPASS_BASE_URL o TURTLEPASS_API_KEY en .env.local");

const HEADER_CANDIDATES: [string, Record<string, string>][] = [
  ["X-API-KEY", { "X-API-KEY": apiKey }],
  ["X-Api-Key", { "X-Api-Key": apiKey }],
  ["apikey", { apikey: apiKey }],
  ["api-key", { "api-key": apiKey }],
  ["Authorization: Bearer", { Authorization: `Bearer ${apiKey}` }],
  ["Authorization: token", { Authorization: apiKey }],
  ["X-AUTH-TOKEN", { "X-AUTH-TOKEN": apiKey }],
];

async function tryFetch(path: string, headers: Record<string, string>) {
  try {
    const response = await fetch(`${base}${path}`, { headers: { Accept: "application/json", ...headers }, redirect: "manual" });
    const text = await response.text();
    return { status: response.status, type: response.headers.get("content-type") ?? "", body: text.slice(0, 200) };
  } catch (cause) {
    return { status: 0, type: "", body: cause instanceof Error ? cause.message : "sin respuesta" };
  }
}

console.log(`Base: ${base}\n`);

// 1. Which header does it accept? /api/version is the harmless probe.
let working: Record<string, string> | null = null;
for (const [label, headers] of HEADER_CANDIDATES) {
  const result = await tryFetch("/api/version", headers);
  const ok = result.status === 200 && result.type.includes("json");
  console.log(`${ok ? "OK   " : "     "} ${label.padEnd(22)} HTTP ${result.status} ${result.type.split(";")[0]}`);
  if (ok && !working) working = headers;
}
if (!working) {
  console.log("\nNinguna cabecera ha funcionado. Pásame una captura de la sección Token de la documentación y lo ajusto.");
  process.exit(0);
}

// 2. What does the API offer? Swagger describes it if it is published.
for (const path of ["/api/doc.json", "/api/swagger.json", "/swagger.json", "/api/docs.json"]) {
  const result = await tryFetch(path, working);
  if (result.status === 200 && result.type.includes("json")) {
    const doc = JSON.parse(await (await fetch(`${base}${path}`, { headers: { Accept: "application/json", ...working } })).text()) as { paths?: Record<string, Record<string, unknown>> };
    console.log(`\nEndpoints publicados en ${path}:`);
    for (const [route, methods] of Object.entries(doc.paths ?? {})) console.log(`  ${Object.keys(methods).join(",").toUpperCase().padEnd(18)} ${route}`);
    break;
  }
}

// 3. Groups and passwords: how many, and what shape do they have.
for (const path of ["/api/passwordgroups", "/api/password-groups", "/api/passwords"]) {
  const result = await tryFetch(path, working);
  console.log(`\nGET ${path} → HTTP ${result.status} ${result.type.split(";")[0]}`);
  if (result.status === 200 && result.type.includes("json")) {
    const data = JSON.parse(await (await fetch(`${base}${path}`, { headers: { Accept: "application/json", ...working } })).text());
    const items = Array.isArray(data) ? data : (data.items ?? data.data ?? data.hydra ?? []);
    const list = Array.isArray(items) ? items : [];
    console.log(`  elementos: ${list.length}`);
    if (list[0] && typeof list[0] === "object") console.log(`  campos: ${Object.keys(list[0]).join(", ")}`);
    // Group names are not secrets and are what we need to mirror.
    if (path.includes("group")) {
      const names = list.map((item: Record<string, unknown>) => item.name ?? item.groupname ?? item.title).filter(Boolean);
      if (names.length) console.log(`  nombres: ${names.join(" · ")}`);
    }
  }
}
