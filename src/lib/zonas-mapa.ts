/*
  El mapa de España por provincias, en rejilla.

  No es el contorno real: es un mapa de casillas, de los que usan los
  periódicos para los resultados electorales. Cada provincia ocupa lo mismo,
  así que Soria se ve igual que Badajoz y el color dice cuánto hay, no cuántos
  kilómetros cuadrados tiene. Para «dónde tengo clientes» eso es lo que se
  quiere; y además no obliga a meter en el repositorio un SVG de geografía con
  su licencia detrás.

  Está aquí y no en la pantalla porque es un dato con una regla que se puede
  comprobar: que estén las 52 y que ninguna pise a otra.
*/

export type CasillaDeProvincia = {
  /** El código de provincia, el mismo que los dos primeros dígitos del CP. */
  code: string;
  /** La sigla de la matrícula, que es como se conoce a cada provincia aquí. */
  corto: string;
  col: number;
  fila: number;
};

export const COLUMNAS_DEL_MAPA = 10;

export const CUADRICULA_DE_ESPANA: CasillaDeProvincia[] = [
  { code: "15", corto: "C", col: 1, fila: 1 }, { code: "27", corto: "LU", col: 2, fila: 1 },
  { code: "33", corto: "O", col: 3, fila: 1 }, { code: "39", corto: "S", col: 4, fila: 1 },
  { code: "48", corto: "BI", col: 5, fila: 1 }, { code: "20", corto: "SS", col: 6, fila: 1 },
  { code: "36", corto: "PO", col: 1, fila: 2 }, { code: "32", corto: "OU", col: 2, fila: 2 },
  { code: "24", corto: "LE", col: 3, fila: 2 }, { code: "34", corto: "P", col: 4, fila: 2 },
  { code: "09", corto: "BU", col: 5, fila: 2 }, { code: "01", corto: "VI", col: 6, fila: 2 },
  { code: "31", corto: "NA", col: 7, fila: 2 }, { code: "22", corto: "HU", col: 8, fila: 2 },
  { code: "17", corto: "GI", col: 10, fila: 2 },
  { code: "49", corto: "ZA", col: 3, fila: 3 }, { code: "47", corto: "VA", col: 4, fila: 3 },
  { code: "42", corto: "SO", col: 5, fila: 3 }, { code: "26", corto: "LO", col: 6, fila: 3 },
  { code: "50", corto: "Z", col: 7, fila: 3 }, { code: "25", corto: "L", col: 8, fila: 3 },
  { code: "08", corto: "B", col: 9, fila: 3 },
  { code: "37", corto: "SA", col: 3, fila: 4 }, { code: "40", corto: "SG", col: 4, fila: 4 },
  { code: "19", corto: "GU", col: 6, fila: 4 }, { code: "44", corto: "TE", col: 7, fila: 4 },
  { code: "43", corto: "T", col: 8, fila: 4 },
  { code: "10", corto: "CC", col: 3, fila: 5 }, { code: "05", corto: "AV", col: 4, fila: 5 },
  { code: "28", corto: "M", col: 5, fila: 5 }, { code: "16", corto: "CU", col: 6, fila: 5 },
  { code: "12", corto: "CS", col: 7, fila: 5 },
  { code: "06", corto: "BA", col: 3, fila: 6 }, { code: "45", corto: "TO", col: 4, fila: 6 },
  { code: "13", corto: "CR", col: 5, fila: 6 }, { code: "02", corto: "AB", col: 6, fila: 6 },
  { code: "46", corto: "V", col: 7, fila: 6 },
  { code: "21", corto: "H", col: 2, fila: 7 }, { code: "41", corto: "SE", col: 3, fila: 7 },
  { code: "14", corto: "CO", col: 4, fila: 7 }, { code: "23", corto: "J", col: 5, fila: 7 },
  { code: "30", corto: "MU", col: 6, fila: 7 }, { code: "03", corto: "A", col: 7, fila: 7 },
  { code: "11", corto: "CA", col: 2, fila: 8 }, { code: "29", corto: "MA", col: 3, fila: 8 },
  { code: "18", corto: "GR", col: 4, fila: 8 }, { code: "04", corto: "AL", col: 5, fila: 8 },
  { code: "51", corto: "CE", col: 1, fila: 9 }, { code: "52", corto: "ML", col: 2, fila: 9 },
  { code: "38", corto: "TF", col: 4, fila: 9 }, { code: "35", corto: "GC", col: 5, fila: 9 },
  { code: "07", corto: "PM", col: 9, fila: 9 },
];

/**
 * Cuánto se tiñe una casilla, de 0 a 1.
 *
 * Con raíz cuadrada y no con el valor a secas: Alicante tiene 2.658 clientes y
 * la mayoría de provincias no llegan a 50, así que en escala lineal todo lo
 * que no es Alicante sale blanco y el mapa no dice nada. Así se distingue
 * tener cinco clientes de no tener ninguno, que es lo que se busca.
 */
export function intensidadDeColor(valor: number, maximo: number): number {
  if (!Number.isFinite(valor) || !Number.isFinite(maximo)) return 0;
  if (valor <= 0 || maximo <= 0) return 0;
  return Math.min(1, Math.sqrt(valor / maximo));
}
