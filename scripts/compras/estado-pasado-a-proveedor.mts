/*
  ¿Está llegando la casilla «Pasado a proveedor» de Sage?

  El aviso automático de compras dejó de reclamar los pedidos que el proveedor
  todavía no ha recibido, y eso lo decide la columna sent_to_supplier, que
  rellena el agente de Sage. Si el agente no encuentra esa casilla —cambia de
  nombre según la versión de Sage— la columna se queda en nulo y se reclama
  como siempre. Esto dice cuál de las dos cosas está pasando.

  Qué mira:
    · Cuántos pedidos tienen sí, no, o todavía no se sabe.
    · Los avisos que mandó el agente en sus últimas lecturas, por si dice que
      no encuentra la columna y con qué nombres parecidos se ha topado.

  Solo lee. No escribe nada y no imprime ningún dato de nadie: recuentos, y los
  avisos del propio agente.

  Uso (desde la raíz del proyecto, con .env.local puesto):
    node scripts/compras/estado-pasado-a-proveedor.mts
*/
import { readFileSync } from "node:fs";
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
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

/** Cuántos pedidos hay de cada estado de la casilla. */
async function contar(filtro: "true" | "false" | "null"): Promise<number | string> {
  let consulta = supabase.from("sage_purchase_orders").select("number", { count: "exact", head: true });
  consulta = filtro === "null" ? consulta.is("sent_to_supplier", null) : consulta.eq("sent_to_supplier", filtro === "true");
  const { count, error } = await consulta;
  // La columna no existe todavía: la migración 202610260003 está sin aplicar.
  if (error) return error.message.includes("sent_to_supplier") ? "falta la columna" : `error: ${error.message}`;
  return count ?? 0;
}

const [si, no, sinSaber] = await Promise.all([contar("true"), contar("false"), contar("null")]);
console.log("Pedidos a proveedor en Sage:");
console.log(`  pasados a proveedor (sí): ${si}`);
console.log(`  sin pasar (no):           ${no}`);
console.log(`  todavía no se sabe:       ${sinSaber}`);

if (typeof si === "number" && typeof no === "number" && si + no === 0) {
  console.log("\nNinguno trae el dato: o no ha corrido el agente nuevo, o no encuentra la casilla.");
}

// Los avisos del agente viajan en el resumen de cada lectura.
const { data: lecturas, error } = await supabase
  .from("sage_sync_runs")
  .select("started_at, message")
  .eq("ok", true)
  .order("started_at", { ascending: false })
  .limit(5);
if (error) {
  console.error(`\nNo se pudieron leer las lecturas de Sage: ${error.message}`);
  process.exit(1);
}

// Qué versión del agente hay en el servidor: la dice él en cada lectura desde
// la versión «2026-10-26 subfamilia-y-pasado-a-proveedor». Si no sale ninguna, la copia del
// servidor es anterior a esa.
const version = (lecturas ?? [])
  .map((fila) => /agente (\d{4}-\d{2}-\d{2}[^|]*)/.exec(String(fila.message ?? "")))
  .find(Boolean);
console.log(`\nVersión del agente en el servidor: ${version ? version[1].trim() : "no la dice: es anterior al 2026-10-26"}`);

console.log("\nAvisos del agente en las últimas lecturas:");
let alguno = false;
for (const lectura of lecturas ?? []) {
  const marca = "Avisos del agente:";
  const texto = String(lectura.message ?? "");
  const corte = texto.indexOf(marca);
  const cuando = String(lectura.started_at).slice(0, 16).replace("T", " ");
  if (corte === -1) {
    console.log(`  ${cuando}  sin avisos`);
    continue;
  }
  alguno = true;
  for (const aviso of texto.slice(corte + marca.length).split("|")) {
    console.log(`  ${cuando}  ${aviso.trim()}`);
  }
}
if (!alguno) console.log("  (ninguna lectura trae avisos: el agente no se ha quejado de nada)");
