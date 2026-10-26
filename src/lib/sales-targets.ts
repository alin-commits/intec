/*
  Repartir un objetivo entre los meses que le tocan.

  Presupuestar no es dividir entre doce: agosto no vende como marzo, y un
  trimestre tampoco se parte en tres partes iguales. Lo que se hace aquí es
  repartir un importe —el del año o el de un trimestre— con la forma que tuvo
  la venta del año anterior, que es la única pista real de temporalidad que
  hay. Si de ese tramo no se vendió nada, se reparte a partes iguales, que es
  lo que se hacía antes y al menos no inventa una estacionalidad falsa.

  Sin red ni base de datos: son cuentas, y así se pueden probar.
*/

/** Los trimestres, con los meses que caen en cada uno (0 = enero). */
export const TRIMESTRES = [
  { nombre: "T1", meses: [0, 1, 2], etiqueta: "ene-mar" },
  { nombre: "T2", meses: [3, 4, 5], etiqueta: "abr-jun" },
  { nombre: "T3", meses: [6, 7, 8], etiqueta: "jul-sep" },
  { nombre: "T4", meses: [9, 10, 11], etiqueta: "oct-dic" },
] as const;

/**
 * Reparte un importe entre varios huecos con la forma que dicen los pesos.
 *
 * Los céntimos que deja el redondeo no se pierden ni se cuelan de más: lo que
 * sobra o falta va al hueco de más peso, así que la suma del reparto es
 * exactamente el importe que se pidió repartir. Un presupuesto que no cuadra
 * con su propio total es un presupuesto que nadie se cree.
 *
 * Los pesos negativos —una devolución que deja el mes en rojo— cuentan como
 * cero: un mes que no vendió no se lleva parte del objetivo, pero tampoco
 * resta del de los demás.
 */
export function repartirPorPesos(importe: number, pesos: number[]): number[] {
  if (pesos.length === 0) return [];
  const limpios = pesos.map((peso) => (Number.isFinite(peso) && peso > 0 ? peso : 0));
  const suma = limpios.reduce((total, peso) => total + peso, 0);
  // Sin nada de donde sacar la forma, a partes iguales.
  const reparto = suma > 0
    ? limpios.map((peso) => Math.round((importe * peso) / suma))
    : limpios.map(() => Math.round(importe / limpios.length));

  const sobra = Math.round(importe) - reparto.reduce((total, valor) => total + valor, 0);
  if (sobra !== 0) {
    // Al de más peso, que es donde menos se nota; sin pesos, al primero.
    let destino = 0;
    for (let indice = 1; indice < limpios.length; indice += 1) {
      if (limpios[indice] > limpios[destino]) destino = indice;
    }
    reparto[destino] += sobra;
  }
  return reparto;
}

/**
 * El objetivo de cada mes del año, repartiendo el total con la temporalidad
 * del año anterior.
 *
 * `anterior` son los doce meses del año pasado. Si no hay —el panel todavía no
 * los ha traído, o es el primer año—, sale el reparto de siempre: a doceavas.
 */
export function repartirElAno(importe: number, anterior: number[] | null): number[] {
  return repartirPorPesos(importe, anterior ?? Array.from({ length: 12 }, () => 1));
}

/**
 * Mete el objetivo de un trimestre en sus tres meses, con la temporalidad del
 * año anterior, y deja los demás meses como estaban.
 *
 * Los meses llegan y salen como el texto que hay escrito en cada casilla: esta
 * función no sabe de euros ni de formatos, solo de en qué orden van.
 */
export function repartirTrimestre(input: {
  meses: (number | null)[];
  trimestre: number;
  importe: number;
  anterior: number[] | null;
}): (number | null)[] {
  const tramo = TRIMESTRES[input.trimestre];
  if (!tramo) return input.meses;
  const pesos = tramo.meses.map((mes) => input.anterior?.[mes] ?? 1);
  const reparto = repartirPorPesos(input.importe, pesos);
  const siguiente = [...input.meses];
  tramo.meses.forEach((mes, posicion) => { siguiente[mes] = reparto[posicion]; });
  return siguiente;
}

/** Lo que suman unos meses, contando como cero los que están sin poner. */
export function sumaDe(meses: (number | null)[], cuales?: readonly number[]): number {
  const indices = cuales ?? meses.map((_, indice) => indice);
  return indices.reduce<number>((total, indice) => total + (meses[indice] ?? 0), 0);
}

/**
 * Lo que sube o baja el objetivo respecto al año anterior, en porcentaje.
 *
 * Null cuando no hay con qué compararlo: el año pasado no vendió nada en ese
 * tramo, o todavía no se sabe lo que vendió. Un «+100 %» sobre cero no dice
 * nada y encima parece un dato.
 */
export function variacionSobreAnterior(objetivo: number, anterior: number | null): number | null {
  if (anterior === null || anterior <= 0) return null;
  return ((objetivo - anterior) / anterior) * 100;
}
