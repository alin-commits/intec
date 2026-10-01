// Lo que se calcula en la ficha de un cliente del panel de Ventas, sin React.
// Sin imports, para que los tests de node lo carguen tal cual.

const DAY_MS = 86_400_000;
const toUtc = (key: string) => {
  const [year, month, day] = key.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
};
const addDays = (key: string, count: number) => new Date(toUtc(key) + count * DAY_MS).toISOString().slice(0, 10);
const daysBetween = (from: string, to: string) => Math.round((toUtc(to) - toUtc(from)) / DAY_MS);

export type OfferDocument = {
  offer_date: string;
  valid_until: string | null;
  ordered_amount: number | string | null;
  reject_reason: string | null;
  loss_detail: string | null;
};
export type OfferState = "convertida" | "rechazada" | "viva" | "caducada";

/**
 * En qué está una oferta, con la misma regla que las listas del panel
 * (sage_offer_list): convertida si ya tiene pedido; rechazada si lleva motivo;
 * si no, viva mientras no pase su validez (o 90 días si no la tiene) y
 * caducada después.
 */
export function offerState(offer: OfferDocument, today: string): { state: OfferState; reason: string } {
  const reason = (offer.reject_reason ?? "").trim() || (offer.loss_detail ?? "").trim();
  if (Number(offer.ordered_amount ?? 0) > 0) return { state: "convertida", reason: "" };
  if (reason) return { state: "rechazada", reason };
  const until = offer.valid_until ?? addDays(offer.offer_date, 90);
  return { state: until >= today ? "viva" : "caducada", reason: "" };
}

export type OrderDocument = {
  needed_on: string | null;
  first_delivery_on: string | null;
  pending_amount: number | string | null;
};
export type OrderState = "pendiente" | "retrasado" | "servido" | "servido_tarde";

/**
 * En qué está un pedido: con algo por servir, pendiente (o retrasado si ya pasó
 * la fecha que pidió el cliente); servido del todo, a tiempo o tarde.
 */
export function orderState(order: OrderDocument, today: string): OrderState {
  if (Number(order.pending_amount ?? 0) > 0) return order.needed_on && order.needed_on < today ? "retrasado" : "pendiente";
  if (order.needed_on && order.first_delivery_on && order.first_delivery_on > order.needed_on) return "servido_tarde";
  return "servido";
}

/**
 * Cada cuánto compra un cliente y si lleva demasiado sin hacerlo.
 *
 * El ritmo es la media de días entre compras del último año, y solo se da con
 * tres compras o más: con dos, una media no dice nada. "Tarde" es llevar más
 * del doble de lo normal sin comprar, y al menos dos semanas: a quien compra
 * cada tres días no se le avisa por pasar una semana fuera.
 */
export function purchaseRhythm(days: string[], today: string): {
  first: string;
  last: string;
  daysSinceLast: number;
  purchaseDaysLastYear: number;
  every: number | null;
  late: boolean;
} | null {
  const unique = [...new Set(days)].filter((day) => day <= today).sort();
  if (unique.length === 0) return null;
  const last = unique[unique.length - 1];
  const daysSinceLast = daysBetween(last, today);
  const yearAgo = addDays(today, -365);
  const recent = unique.filter((day) => day > yearAgo);
  const gaps = recent.slice(1).map((day, index) => daysBetween(recent[index], day));
  const every = gaps.length >= 2 ? gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length : null;
  return {
    first: unique[0],
    last,
    daysSinceLast,
    purchaseDaysLastYear: recent.length,
    every,
    late: every !== null && daysSinceLast >= 14 && daysSinceLast > every * 2,
  };
}
