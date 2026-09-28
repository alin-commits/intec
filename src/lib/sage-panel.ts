// Reglas del panel de Ventas que no dependen de React, para poder probarlas.

/**
 * Hasta el cambio de series en Sage (16/10/2025) los albaranes no guardaban la
 * fecha de factura: por fecha de factura no hay nada antes. Lo miden los datos:
 * el primer día con factura es el 16 y los meses anteriores salen vacíos.
 */
export const INVOICE_DATES_FROM = "2025-10-16";
const INVOICE_FIRST_YEAR = Number(INVOICE_DATES_FROM.slice(0, 4));

/** Los años que tienen algo por fecha de factura. */
export function invoiceYears(years: number[]): number[] {
  return years.filter((year) => year >= INVOICE_FIRST_YEAR);
}

/**
 * Si se puede comparar un año con el anterior por fecha de factura. 2026 contra
 * 2025 no: 2025 solo tiene factura desde mediados de octubre y la comparación
 * saldría contra casi nada, con un +400 % que no significa nada.
 */
export function invoiceComparisonAvailable(year: number): boolean {
  return `${year - 1}-01-01` >= INVOICE_DATES_FROM;
}

/** "2024-03" + n meses. */
export function addMonths(month: string, count: number): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const index = year * 12 + (monthNumber - 1) + count;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/**
 * Desde qué mes "cliente nuevo" quiere decir algo. En los primeros meses del
 * histórico todos parecen nuevos porque antes no hay datos en Sage; con un año
 * de historia detrás, el que aparece por primera vez sí es nuevo de verdad.
 */
export function trustedNewCustomersFrom(firstMonth: string | null): string | null {
  return firstMonth ? addMonths(firstMonth.slice(0, 7), 12) : null;
}

/** El último mes entero de un año: el anterior al de hoy si es el año en curso. */
export function lastCompleteMonth(year: number, today: Date): string | null {
  if (year < today.getFullYear()) return `${year}-12`;
  if (year > today.getFullYear() || today.getMonth() === 0) return null;
  return `${year}-${String(today.getMonth()).padStart(2, "0")}`;
}

export type SnapshotRow = {
  taken_on: string;
  company_code: number;
  metric: "pedidos_pendientes" | "clientes_dormidos";
  rep_code: number | null;
  count: number;
  amount: number;
};

/** Las filas de la foto más reciente de una métrica. */
export function latestSnapshot(rows: SnapshotRow[], metric: SnapshotRow["metric"]): { takenOn: string | null; rows: SnapshotRow[] } {
  const own = rows.filter((row) => row.metric === metric);
  const takenOn = own.reduce<string | null>((latest, row) => (latest === null || row.taken_on > latest ? row.taken_on : latest), null);
  return { takenOn, rows: own.filter((row) => row.taken_on === takenOn) };
}

/**
 * El margen de una familia sobre la parte que tiene coste fiable: desde el
 * cambio de series y sin las líneas que no llevan coste grabado. Null cuando no
 * hay nada que medir, en vez de un 100 % que parecería un milagro.
 */
export function familyMargin(row: { trusted_net: number; trusted_cost: number; trusted_without_cost: number }): number | null {
  const base = Number(row.trusted_net) - Number(row.trusted_without_cost);
  const cost = Number(row.trusted_cost);
  if (base <= 0 || cost <= 0) return null;
  return ((base - cost) / base) * 100;
}
