import { plataformaDeLead, type AdsPlatform } from "@/lib/publicidad/plataformas";

/**
 * Lo que cuesta traer un lead de campañas, con una sola definición para toda la
 * aplicación: Inicio, Leads y el panel de Ads lo piden aquí.
 *
 * Lo difícil no es dividir, es decidir qué gasto entra. Hay meses con gasto de
 * los que no queda ni un lead, porque la conexión con la plataforma todavía no
 * existía: en abril de 2026 Meta contó 186 leads y en la aplicación no entró
 * ninguno. Meter ese gasto carga meses enteros sobre los leads de las últimas
 * semanas y dispara el coste (29,80 € en vez de 5,92 €).
 *
 * Por eso de cada plataforma solo cuenta el gasto desde el mes de su primer
 * lead. A partir de ahí entra todo, también los meses malos: si se gasta y no
 * entra nada, tiene que notarse. Y cuando LinkedIn empiece a traer leads, su
 * gasto se suma solo desde el suyo, sin tocar ninguna pantalla.
 */

export type GastoPorMes = { platform: AdsPlatform; month: string; amountSpent: number };
export type LeadConOrigen = { createdAt: string; metaLeadId?: string | null };

export type CostePorLead = {
  /** El gasto que sí se puede comparar con los leads que hay. */
  gasto: number;
  /** Cuántos de esos leads vinieron de campañas. */
  leads: number;
  /** Euros por lead, o null si todavía no hay leads que dividir. */
  euros: number | null;
};

/**
 * @param gasto        Filas de gasto ya filtradas por marca y periodo.
 * @param leadsVisibles Los leads del periodo (los que cuenta la pantalla).
 * @param todosLosLeads Todos los leads, sin filtrar: hacen falta para saber desde
 *                      cuándo cada plataforma deja los suyos aquí.
 * @param mesDe        Cómo sacar el mes "YYYY-MM" de una fecha, en hora de Madrid.
 */
export function calcularCostePorLead(
  gasto: GastoPorMes[],
  leadsVisibles: LeadConOrigen[],
  todosLosLeads: LeadConOrigen[],
  mesDe: (iso: string) => string,
): CostePorLead {
  const primerMes = new Map<AdsPlatform, string>();
  for (const lead of todosLosLeads) {
    const plataforma = plataformaDeLead(lead);
    if (!plataforma) continue;
    const mes = mesDe(lead.createdAt);
    const actual = primerMes.get(plataforma);
    if (!actual || mes < actual) primerMes.set(plataforma, mes);
  }

  const gastoComparable = gasto.reduce((suma, fila) => {
    const desde = primerMes.get(fila.platform);
    return desde && fila.month >= desde ? suma + fila.amountSpent : suma;
  }, 0);

  const leads = leadsVisibles.filter((lead) => plataformaDeLead(lead) !== null).length;
  return { gasto: gastoComparable, leads, euros: leads > 0 ? gastoComparable / leads : null };
}

/** La línea que se enseña bajo el número de una tarjeta, o nada si no hay gasto que contar. */
export function textoCostePorLead(coste: CostePorLead, euros: (valor: number) => string): string | undefined {
  if (coste.gasto <= 0) return undefined;
  if (coste.euros === null) return `${euros(coste.gasto)} en publicidad`;
  return `${euros(coste.gasto)} · ${euros(coste.euros)} por lead`;
}

/** Lo que explica la línea al pasar el ratón. Igual en las tres pantallas. */
export const EXPLICACION_COSTE_POR_LEAD =
  "Lo gastado en publicidad dividido entre los leads que llegaron de campañas. Solo cuenta el gasto desde que cada plataforma empezó a dejar sus leads aquí: lo anterior se gastó cuando no se recogía nada y mezclarlo dispararía el coste.";
