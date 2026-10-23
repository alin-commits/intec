import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/*
  Buscar en los catálogos.

  Tres sitios distintos, y cada uno sirve para una cosa:

    catálogos (PDF)   describen con palabras: «GENESIS 7,5 500l 8 bar».
                      Aquí se busca por características.

    tarifas (Excel)   son códigos comerciales: «C45PRO X/196UT-C45PRO+196».
                      Nadie escribe eso. Aquí se busca por referencia del
                      proveedor o por modelo, no por características.

    Sage              lo que la casa vende de verdad, con la referencia que
                      usan los comerciales a diario. Las marcas propias
                      —Jender, BlizzCool— solo están aquí: el secador JKEP
                      1495 no aparece en ningún catálogo de proveedor.

  El orden de la respuesta sale de juntar las tres. «Un compresor de 8 bar»
  lo resuelve el catálogo; «qué es la referencia 0141000030» lo resuelve
  Sage; el precio lo pone la tarifa.

  Todo ordenado por relevancia, que es la diferencia entre encontrar algo y
  devolver lo primero que haya. Sin ella, «todos los compresores de tornillo»
  devolvía dos catálogos de expositores y ni un compresor, con 1.890 páginas
  cargadas que hablan de tornillo.
*/

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

export type ArticuloEncontrado = {
  codigo: string;
  nombre: string;
  marca: string | null;
  fabricante: string | null;
  familia: string | null;
};

/**
 * Las referencias que aparecen en un trozo de catálogo.
 *
 * Códigos de artículo: seguidos de 6 a 14 cifras, o mezclas de letras y
 * números como «N7TN801NUA». Se queda corto a propósito —no vale para todos
 * los proveedores— pero con lo que saca ya se puede ir a la tarifa a por el
 * precio, y lo que no reconozca lo sigue viendo el modelo en el texto.
 */
export function referenciasDe(texto: string): string[] {
  const encontradas = new Set<string>();
  for (const m of texto.matchAll(/\b(\d{6,14})\b/g)) encontradas.add(m[1]);
  for (const m of texto.matchAll(/\b([A-Z]{1,3}\d[A-Z0-9]{4,12})\b/g)) encontradas.add(m[1]);
  return [...encontradas].slice(0, 40);
}

function limpiar(consulta: string): string {
  return consulta.replace(/["'\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
}

/**
 * Pregunta a una de las funciones de búsqueda, primero exigiendo todas las
 * palabras y, si no sale nada, conformándose con cualquiera.
 *
 * El segundo intento sigue ordenado por relevancia, que es lo que lo hace
 * útil: de los que coinciden en algo, primero los que coinciden en más.
 */
async function buscar<T>(db: SupabaseClient, funcion: string, consulta: string, tope: number): Promise<T[]> {
  const texto = limpiar(consulta);
  if (!texto) return [];

  for (const laxo of [false, true]) {
    const { data, error } = await db.rpc(funcion, { consulta: texto, laxo, tope });
    if (error) {
      console.error(`Catálogos: falló ${funcion}`, error);
      return [];
    }
    if ((data as T[] | null)?.length) return data as T[];
  }
  return [];
}

export async function buscarEnCatalogos(db: SupabaseClient, consulta: string, tope = 10) {
  const filas = await buscar<Record<string, unknown>>(db, "buscar_en_catalogos", consulta, tope);
  return filas.map((f): TrozoEncontrado => ({
    proveedor: String(f.proveedor ?? ""),
    fichero: String(f.fichero ?? ""),
    pagina: (f.pagina as number | null) ?? null,
    año: (f.anio as number | null) ?? null,
    texto: String(f.texto ?? ""),
  }));
}

export async function buscarEnTarifas(db: SupabaseClient, consulta: string, tope = 14) {
  const filas = await buscar<Record<string, unknown>>(db, "buscar_en_tarifas", consulta, tope);
  return filas.map(filaAPrecio);
}

export async function buscarEnSage(db: SupabaseClient, consulta: string, tope = 12) {
  const filas = await buscar<Record<string, unknown>>(db, "buscar_en_sage", consulta, tope);
  return filas.map((f): ArticuloEncontrado => ({
    codigo: String(f.codigo ?? ""),
    nombre: String(f.nombre ?? ""),
    marca: (f.marca as string | null) ?? null,
    fabricante: (f.fabricante as string | null) ?? null,
    familia: (f.familia as string | null) ?? null,
  }));
}

/**
 * El precio de unas referencias concretas.
 *
 * El segundo paso: el catálogo ha dicho qué modelos sirven y con qué
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
  return (data ?? []).map((fila) => {
    const f = fila.catalog_files as unknown as { file_name: string; year_hint: number | null };
    return {
      proveedor: String(fila.supplier ?? ""),
      referencia: fila.reference ?? null,
      ean: fila.ean ?? null,
      descripcion: fila.description ?? null,
      precio: fila.price === null ? null : Number(fila.price),
      fichero: f?.file_name ?? "",
      año: f?.year_hint ?? null,
    };
  });
}

function filaAPrecio(fila: Record<string, unknown>): PrecioEncontrado {
  return {
    proveedor: String(fila.proveedor ?? ""),
    referencia: (fila.referencia as string | null) ?? null,
    ean: (fila.ean as string | null) ?? null,
    descripcion: (fila.descripcion as string | null) ?? null,
    precio: fila.precio === null || fila.precio === undefined ? null : Number(fila.precio),
    fichero: String(fila.fichero ?? ""),
    año: (fila.anio as number | null) ?? null,
  };
}

/** Todo junto, que es como lo usa el chat. */
export async function buscarTodo(db: SupabaseClient, consulta: string) {
  const [trozos, porTexto, articulos] = await Promise.all([
    buscarEnCatalogos(db, consulta),
    buscarEnTarifas(db, consulta),
    buscarEnSage(db, consulta),
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

  return { trozos, precios, articulos };
}
