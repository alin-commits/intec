/*
  ¿Está la base al día con el repositorio? Compara lo que hay en Supabase con
  dos fuentes: las migraciones de supabase/migrations (lo que debería existir) y
  el código de src (lo que la aplicación pide cada vez que alguien entra).

  Para qué sirve: las migraciones se ejecutan a mano, una a una, y basta con
  saltarse un fichero —o que una falle a medias— para que una pantalla deje de
  cargar en producción sin que nadie se entere hasta que alguien la abre. Esto
  lo dice antes.

  Qué comprueba:
    · Cada tabla y cada columna que crean las migraciones existe de verdad.
    · Cada tabla, columna y función que lee el código existe.
    · Los cubos de archivos están, y solo el de los logos es público.

  El esquema no se adivina: PostgREST lo publica entero en /rest/v1/, con sus
  tablas, sus columnas y sus funciones.

  Solo lee. No escribe nada, no ejecuta ninguna función de la base y no imprime
  ningún dato: solo nombres de tablas, columnas y funciones.

  Uso (desde la raíz del proyecto, con .env.local puesto):
    node scripts/check-schema.mts

  Termina con código 1 si falta algo, para poder encadenarlo con otra cosa.
*/
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((line) => line.includes("=") && !line.trim().startsWith("#"))
    .map((line) => [line.slice(0, line.indexOf("=")).trim(), line.slice(line.indexOf("=") + 1).trim()]),
);
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local.");
  process.exit(1);
}
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

/** Los cubos que usa la aplicación, y cuál de ellos puede ser público. */
const CUBOS = ["business-unit-logos", "it-notes", "marketing-invoices", "social-posts", "ticket-attachments"];
const CUBO_PUBLICO = "business-unit-logos";

let mal = 0;
const di = (titulo: string, bien: boolean, detalle: string) => {
  if (!bien) mal++;
  console.log(`  ${bien ? "OK  " : "MAL "} ${titulo}: ${detalle}`);
};

// ---------- El esquema que hay ahora mismo ----------
const respuesta = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/`, {
  headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
});
if (!respuesta.ok) {
  console.error(`No se pudo leer el esquema (${respuesta.status}).`);
  process.exit(1);
}
const spec = await respuesta.json() as { paths: Record<string, unknown>; definitions: Record<string, { properties?: Record<string, unknown> }> };
const tablas = new Map<string, Set<string>>();
for (const [nombre, definicion] of Object.entries(spec.definitions ?? {})) {
  tablas.set(nombre, new Set(Object.keys(definicion.properties ?? {})));
}
const funciones = new Set(
  Object.keys(spec.paths ?? {}).filter((ruta) => ruta.startsWith("/rpc/")).map((ruta) => ruta.slice(5)),
);
console.log(`En Supabase: ${tablas.size} tablas y ${funciones.size} funciones publicadas.\n`);

// ---------- 1. Lo que dicen las migraciones ----------
const migraciones = readdirSync("supabase/migrations").filter((nombre) => nombre.endsWith(".sql")).sort();
const deberia = new Map<string, Map<string, string>>(); // tabla -> columna -> en qué migración se creó
const apunta = (tabla: string, columna: string, fichero: string) => {
  if (!deberia.has(tabla)) deberia.set(tabla, new Map());
  deberia.get(tabla)!.set(columna, fichero);
};

/** Los tipos con los que empieza una columna; sirve para separar columnas de restricciones. */
const TIPOS = /^"?([a-z_0-9]+)"?\s+(uuid|text|integer|bigint|boolean|date|timestamptz|numeric|jsonb|json|app_role|smallint|real|double)/;

for (const fichero of migraciones) {
  // Sin comentarios: dentro hay ejemplos de SQL que no se ejecutan.
  const sql = readFileSync(join("supabase/migrations", fichero), "utf8").replace(/^\s*--.*$/gm, "");
  for (const creada of sql.matchAll(/create table (?:if not exists )?(?:public\.)?"?([a-z_0-9]+)"?\s*\(([\s\S]*?)\n\);/g)) {
    for (const linea of creada[2].split("\n")) {
      const columna = linea.trim().match(TIPOS);
      if (columna) apunta(creada[1], columna[1], fichero);
    }
  }
  for (const anadida of sql.matchAll(/alter table (?:public\.)?"?([a-z_0-9]+)"?\s+add column (?:if not exists )?"?([a-z_0-9]+)"?/g)) {
    apunta(anadida[1], anadida[2], fichero);
  }
  for (const quitada of sql.matchAll(/alter table (?:public\.)?"?([a-z_0-9]+)"?\s+drop column (?:if exists )?"?([a-z_0-9]+)"?/g)) {
    deberia.get(quitada[1])?.delete(quitada[2]);
  }
  for (const renombrada of sql.matchAll(/alter table (?:public\.)?"?([a-z_0-9]+)"?\s+rename column "?([a-z_0-9]+)"? to "?([a-z_0-9]+)"?/g)) {
    deberia.get(renombrada[1])?.delete(renombrada[2]);
    apunta(renombrada[1], renombrada[3], fichero);
  }
  for (const borrada of sql.matchAll(/drop table (?:if exists )?(?:public\.)?"?([a-z_0-9]+)"?/g)) {
    deberia.delete(borrada[1]);
  }
}

const faltanTablas: string[] = [];
const faltanColumnas: string[] = [];
for (const [tabla, columnas] of [...deberia.entries()].sort()) {
  const hay = tablas.get(tabla);
  if (!hay) { faltanTablas.push(tabla); continue; }
  for (const [columna, fichero] of columnas) {
    if (!hay.has(columna)) faltanColumnas.push(`${tabla}.${columna} (${fichero})`);
  }
}
const totalColumnas = [...deberia.values()].reduce((suma, columnas) => suma + columnas.size, 0);
console.log(`1. Las migraciones del repositorio (${migraciones.length} ficheros): ${deberia.size} tablas, ${totalColumnas} columnas`);
di("todas sus tablas están", faltanTablas.length === 0, faltanTablas.join(", ") || "no falta ninguna");
di("y todas sus columnas también", faltanColumnas.length === 0, faltanColumnas.join(" · ") || "no falta ninguna");

// ---------- 2. Lo que pide el código ----------
function fuentes(carpeta: string): string[] {
  return readdirSync(carpeta).flatMap((nombre) => {
    const ruta = join(carpeta, nombre);
    if (statSync(ruta).isDirectory()) return fuentes(ruta);
    return /\.(ts|tsx)$/.test(nombre) ? [ruta] : [];
  });
}
const codigo = fuentes("src").map((ruta) => readFileSync(ruta, "utf8")).join("\n");

const pide = new Map<string, Set<string>>();
// Solo el .select() que va pegado a su .from(), sin otro .from( por medio.
for (const trozo of codigo.matchAll(/\.from\("([a-z_0-9]+)"\)((?:(?!\.from\()[\s\S]){0,400}?)\.select\(\s*"([^"]*)"/g)) {
  // Fuera lo anidado —lead_status_history(...)—: esas columnas son de la otra
  // tabla, no de esta. Se quitan los paréntesis de dentro afuera.
  let plano = trozo[3];
  for (let antes = ""; antes !== plano;) { antes = plano; plano = plano.replace(/\([^()]*\)/g, ""); }
  const columnas = plano.split(",").map((columna) => columna.trim())
    // Lo que queda y es el nombre de otra tabla era una relación, no una columna.
    .filter((columna) => columna && !/[()*:!]/.test(columna) && columna !== "count" && !tablas.has(columna));
  if (!pide.has(trozo[1])) pide.set(trozo[1], new Set());
  for (const columna of columnas) pide.get(trozo[1])!.add(columna);
}

const tablasDelCodigo = new Set([...codigo.matchAll(/\.from\("([a-z_0-9]+)"\)/g)].map((trozo) => trozo[1]));
const sinTabla = [...tablasDelCodigo].filter((tabla) => !tablas.has(tabla)).sort();
const sinColumna: string[] = [];
for (const [tabla, columnas] of pide) {
  const hay = tablas.get(tabla);
  if (!hay) continue;
  for (const columna of columnas) if (!hay.has(columna)) sinColumna.push(`${tabla}.${columna}`);
}
const rpcDelCodigo = [...new Set([...codigo.matchAll(/rpc\(\s*"([a-zA-Z_0-9]+)"/g)].map((trozo) => trozo[1]))].sort();
const sinFuncion = rpcDelCodigo.filter((nombre) => !funciones.has(nombre));

console.log(`\n2. Lo que la aplicación lee: ${tablasDelCodigo.size} tablas y ${rpcDelCodigo.length} funciones`);
di("todas las tablas existen", sinTabla.length === 0, sinTabla.join(", ") || "no falta ninguna");
di("todas las columnas que lee existen", sinColumna.length === 0, sinColumna.join(" · ") || "no falta ninguna");
di("y todas las funciones que llama existen", sinFuncion.length === 0, sinFuncion.join(", ") || "no falta ninguna");

// ---------- 3. Los cubos de archivos ----------
const { data: cubos, error: errorCubos } = await admin.storage.listBuckets();
const nombres = (cubos ?? []).map((cubo) => cubo.name);
const sinCubo = CUBOS.filter((cubo) => !nombres.includes(cubo));
const publicosDeMas = (cubos ?? []).filter((cubo) => cubo.public && cubo.name !== CUBO_PUBLICO).map((cubo) => cubo.name);
console.log(`\n3. Los cubos de archivos`);
if (errorCubos) {
  di("se pueden listar", false, errorCubos.message);
} else {
  di(`están los ${CUBOS.length} que usa la aplicación`, sinCubo.length === 0, sinCubo.join(", ") || nombres.join(", "));
  di(`y solo «${CUBO_PUBLICO}» es público`, publicosDeMas.length === 0, publicosDeMas.join(", ") || "el resto, privados");
}

console.log(mal === 0 ? "\nTODO AL DÍA" : `\n${mal} ${mal === 1 ? "cosa" : "cosas"} que revisar: ejecuta las migraciones que falten.`);
process.exit(mal === 0 ? 0 : 1);
