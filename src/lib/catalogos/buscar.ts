import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/*
  Buscar en los catálogos.

  El orden importa, y no es el que parece. Probando con los datos de verdad
  quedó claro que las dos mitades sirven para cosas distintas:

    los catálogos (PDF)   describen con palabras: «GENESIS 7,5 500l 8 bar».
                          Aquí se busca por características.

    las tarifas (Excel)   son códigos comerciales: «C45PRO X/196UT-C45PRO+196
                          HERRAMIENTAS». Nadie escribe eso. Aquí se busca por
                          referencia o por modelo, no por características.

  Así que «necesito un compresor de 8 bar» se resuelve en dos pasos: primero
  el catálogo dice qué modelos lo cumplen y con qué referencia, y después la
  tarifa pone el precio a esas referencias. Al revés no encuentra nada: de
  347.345 precios cargados, solo dos contienen la palabra «compresor».
*/

/** Siempre en español: el índice está en español y buscar en otra lengua no
 *  encuentra nada, sin dar error. */
const IDIOMA = "spanish";

export type TrozoEncontrado = {
  proveedor: string;
  fichero: string;
  pagina: number | null;
  año: number | null;
  texto: string;
};

export type PrecioEncontrado = {
  proveedor: string;
  referencia: string | null;
  ean: string | null;
  descripcion: string | null;
  precio: number | null;
  fichero: string;
  año: number | null;
};

type FilaFichero = { supplier: string; file_name: string; year_hint: number | null };

/**
 * Las referencias que aparecen en un trozo de catálogo.
 *
 * Lo que busca son códigos de artículo: seguidos de 6 a 14 cifras, o mezclas
 * de letras y números como «N7TN801NUA». Se queda corto a propósito —no vale
 * para todos los proveedores— pero con lo que saca ya se puede ir a la tarifa
 * a por el precio, y lo que no reconozca lo sigue viendo el modelo en el
 * texto.
 */
export function referenciasDe(texto: string): string[] {
  const encontradas = new Set<string>();
  for (const m of texto.matchAll(/\b(\d{6,14})\b/g)) encontradas.add(m[1]);
  for (const m of texto.matchAll(/\b([A-Z]{1,3}\d[A-Z0-9]{4,12})\b/g)) encontradas.add(m[1]);
  return [...encontradas].slice(0, 40);
}

/** Lo que el buscador de Postgres no puede digerir. */
function limpiar(consulta: string): string {
  return consulta.replace(/["'\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
}

/**
 * Páginas de catálogo que hablan de lo que se pregunta.
 *
 * Va en dos pasadas. La primera exige todas las palabras, que es lo que da
 * las respuestas buenas. Si no sale nada —y con cuatro o cinco palabras pasa
 * a menudo, porque basta que una no esté— se repite pidiendo cualquiera de
 * ellas, ordenando por las que más coincidan. Más vale una lista regular que
 * un «no he encontrado nada» cuando el producto está en el catálogo.
 */
export async function buscarEnCatalogos(
  db: SupabaseClient, consulta: string, limite = 8,
): Promise<TrozoEncontrado[]> {
  const texto = limpiar(consulta);
  if (!texto) return [];

  const pedir = async (termino: string, tipo: "websearch" | "plain") => {
    const { data, error } = await db
      .from("catalog_chunks")
      .select("page, content, catalog_files!inner(supplier, file_name, year_hint)")
      .textSearch("search", termino, { type: tipo, config: IDIOMA })
      .limit(limite);
    if (error) {
      console.error("Catálogos: falló la búsqueda en catálogos", error);
      return [];
    }
    return (data ?? []).map((fila) => {
      const f = fila.catalog_files as unknown as FilaFichero;
      return {
        proveedor: f.supplier, fichero: f.file_name, año: f.year_hint,
        pagina: fila.page as number | null, texto: String(fila.content),
      };
    });
  };

  const exacta = await pedir(texto, "websearch");
  if (exacta.length > 0) return exacta;

  const palabras = texto.split(" ").filter((p) => p.length > 2);
  if (palabras.length < 2) return exacta;
  return pedir(palabras.join(" or "), "websearch");
}

/** Productos de tarifa que encajan con lo que se escribe. */
export async function buscarEnTarifas(
  db: SupabaseClient, consulta: string, limite = 10,
): Promise<PrecioEncontrado[]> {
  const texto = limpiar(consulta);
  if (!texto) return [];

  const { data, error } = await db
    .from("catalog_prices")
    .select("supplier, reference, ean, description, price, catalog_files!inner(file_name, year_hint)")
    .textSearch("search", texto, { type: "websearch", config: IDIOMA })
    .limit(limite);
  if (error) {
    console.error("Catálogos: falló la búsqueda en tarifas", error);
    return [];
  }
  return (data ?? []).map(filaAPrecio);
}

/**
 * El precio de unas referencias concretas.
 *
 * Es el segundo paso: el catálogo ha dicho qué modelos sirven y con qué
 * referencia, y aquí se les pone precio. Con ABAC cruzaron las 97 de 97.
 */
export async function preciosDeReferencias(
  db: SupabaseClient, referencias: string[], limite = 60,
): Promise<PrecioEncontrado[]> {
  const limpias = [...new Set(referencias.map((r) => r.trim()).filter(Boolean))].slice(0, 80);
  if (limpias.length === 0) return [];

  const { data, error } = await db
    .from("catalog_prices")
    .select("supplier, reference, ean, description, price, catalog_files!inner(file_name, year_hint)")
    .or(`reference.in.(${limpias.join(",")}),ean.in.(${limpias.join(",")})`)
    .limit(limite);
  if (error) {
    console.error("Catálogos: falló el cruce por referencia", error);
    return [];
  }
  return (data ?? []).map(filaAPrecio);
}

function filaAPrecio(fila: Record<string, unknown>): PrecioEncontrado {
  const f = fila.catalog_files as unknown as { file_name: string; year_hint: number | null };
  return {
    proveedor: String(fila.supplier ?? ""),
    referencia: (fila.reference as string | null) ?? null,
    ean: (fila.ean as string | null) ?? null,
    descripcion: (fila.description as string | null) ?? null,
    precio: fila.price === null || fila.price === undefined ? null : Number(fila.price),
    fichero: f?.file_name ?? "",
    año: f?.year_hint ?? null,
  };
}

/**
 * Todo junto, que es como lo usa el chat.
 *
 * Primero el catálogo, después el precio de lo que el catálogo haya nombrado,
 * y también una búsqueda directa en tarifa por si lo que se escribe es una
 * referencia o un modelo.
 */
export async function buscarTodo(db: SupabaseClient, consulta: string) {
  const [trozos, porTexto] = await Promise.all([
    buscarEnCatalogos(db, consulta),
    buscarEnTarifas(db, consulta),
  ]);

  const referencias = trozos.flatMap((t) => referenciasDe(t.texto));
  const porReferencia = await preciosDeReferencias(db, referencias);

  // Sin repetir: un mismo producto puede venir por los dos caminos.
  const vistos = new Set<string>();
  const precios: PrecioEncontrado[] = [];
  for (const p of [...porTexto, ...porReferencia]) {
    const llave = `${p.proveedor}|${p.referencia ?? p.descripcion}`;
    if (vistos.has(llave)) continue;
    vistos.add(llave);
    precios.push(p);
  }

  return { trozos, precios };
}
