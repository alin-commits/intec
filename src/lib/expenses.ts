// Marketing expenses: labels and the date/cost maths behind the Gastos page.
// Pure functions on YYYY-MM-DD keys so they are easy to test.

export type ExpenseCategory = "software" | "advertising" | "design" | "events" | "print" | "services" | "other";
export type ExpenseKind = "subscription" | "one_off";
export type BillingPeriod = "monthly" | "quarterly" | "yearly";
export type ExpenseStatus = "active" | "cancelled";

export type MarketingExpense = {
  id: string;
  name: string;
  provider: string | null;
  category: ExpenseCategory;
  kind: ExpenseKind;
  amount: number;
  billingPeriod: BillingPeriod | null;
  startDate: string;
  status: ExpenseStatus;
  cancelledOn: string | null;
  businessUnitId: string | null;
  paymentMethod: string | null;
  url: string | null;
  notes: string | null;
};

export const expenseCategoryLabels: Record<ExpenseCategory, string> = {
  software: "Software y apps",
  advertising: "Publicidad",
  design: "Diseño y contenido",
  events: "Ferias y eventos",
  print: "Imprenta y merchandising",
  services: "Agencias y servicios",
  other: "Otros",
};

export const expenseCategoryColors: Record<ExpenseCategory, string> = {
  software: "#332c80",
  advertising: "#0ea5e9",
  design: "#a855f7",
  events: "#f59e0b",
  print: "#10b981",
  services: "#ef4444",
  other: "#94a3b8",
};

export const billingPeriodLabels: Record<BillingPeriod, string> = {
  monthly: "Mensual",
  quarterly: "Trimestral",
  yearly: "Anual",
};

const PERIOD_MONTHS: Record<BillingPeriod, number> = { monthly: 1, quarterly: 3, yearly: 12 };

export function expenseKindLabel(expense: Pick<MarketingExpense, "kind" | "billingPeriod">): string {
  return expense.kind === "one_off" ? "Puntual" : billingPeriodLabels[expense.billingPeriod ?? "monthly"];
}

/** Adds whole months to a YYYY-MM-DD key, clamping to the month's last day (31 Jan + 1 → 28/29 Feb). */
export function addMonthsToKey(key: string, months: number): string {
  const [year, month, day] = key.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

/** Days from one YYYY-MM-DD key to another (negative if `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

/** What an active subscription costs per month; one-off or cancelled expenses cost nothing recurring. */
export function monthlyCost(expense: MarketingExpense): number {
  if (expense.kind !== "subscription" || expense.status !== "active" || !expense.billingPeriod) return 0;
  return expense.amount / PERIOD_MONTHS[expense.billingPeriod];
}

/** Every date the expense is (or was) charged between two inclusive keys. */
export function chargeDates(expense: MarketingExpense, from: string, to: string): string[] {
  if (expense.kind === "one_off" || !expense.billingPeriod) {
    return expense.startDate >= from && expense.startDate <= to ? [expense.startDate] : [];
  }
  // A cancelled subscription is not charged on or after the cancellation date.
  const stop = expense.status === "cancelled" && expense.cancelledOn ? expense.cancelledOn : null;
  const step = PERIOD_MONTHS[expense.billingPeriod];
  const dates: string[] = [];
  for (let index = 0; ; index++) {
    const date = addMonthsToKey(expense.startDate, index * step);
    if (date > to || (stop && date >= stop)) break;
    if (date >= from) dates.push(date);
  }
  return dates;
}

/** Sum charged between two inclusive keys. */
export function spentBetween(expense: MarketingExpense, from: string, to: string): number {
  return chargeDates(expense, from, to).length * expense.amount;
}

/** Minimal invoice data needed to reconcile it with a subscription's charges. */
export type InvoiceCharge = { expenseId: string | null; invoiceDate: string; baseAmount: number };

// How far an invoice date may be from a charge date and still be "that month's/quarter's/year's" invoice.
const MATCH_TOLERANCE_DAYS: Record<BillingPeriod, number> = { monthly: 16, quarterly: 46, yearly: 183 };

/**
 * What a subscription cost between two dates: real invoices linked to it count
 * at their base amount, and each charge with no invoice nearby is estimated at
 * the subscription's amount. So an invoice replaces its estimate instead of
 * being added on top of it (or ignored).
 */
export function subscriptionSpend(expense: MarketingExpense, invoices: InvoiceCharge[], from: string, to: string): { actual: number; estimated: number } {
  const linked = invoices.filter((invoice) => invoice.expenseId === expense.id && invoice.invoiceDate >= from && invoice.invoiceDate <= to);
  const actual = linked.reduce((sum, invoice) => sum + invoice.baseAmount, 0);
  if (expense.kind !== "subscription" || !expense.billingPeriod) {
    return { actual, estimated: linked.length ? 0 : spentBetween(expense, from, to) };
  }
  const tolerance = MATCH_TOLERANCE_DAYS[expense.billingPeriod];
  const unused = linked.map((invoice) => invoice.invoiceDate);
  let uncovered = 0;
  for (const charge of chargeDates(expense, from, to)) {
    let best = -1;
    for (let index = 0; index < unused.length; index++) {
      const distance = Math.abs(daysBetween(charge, unused[index]));
      if (distance <= tolerance && (best === -1 || distance < Math.abs(daysBetween(charge, unused[best])))) best = index;
    }
    if (best === -1) uncovered++;
    else unused.splice(best, 1);
  }
  return { actual, estimated: uncovered * expense.amount };
}

/** Next charge date on or after `today` for an active subscription; null otherwise. */
export function nextRenewal(expense: MarketingExpense, today: string): string | null {
  if (expense.kind !== "subscription" || expense.status !== "active" || !expense.billingPeriod) return null;
  if (expense.startDate >= today) return expense.startDate;
  const step = PERIOD_MONTHS[expense.billingPeriod];
  // Jump close to today first so decades-old subscriptions don't loop for long.
  const [startYear, startMonth] = expense.startDate.split("-").map(Number);
  const [todayYear, todayMonth] = today.split("-").map(Number);
  const monthsElapsed = (todayYear - startYear) * 12 + (todayMonth - startMonth);
  let index = Math.max(0, Math.floor(monthsElapsed / step) - 1);
  let date = addMonthsToKey(expense.startDate, index * step);
  while (date < today) {
    index++;
    date = addMonthsToKey(expense.startDate, index * step);
  }
  return date;
}
