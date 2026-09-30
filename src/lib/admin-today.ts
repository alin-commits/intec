// Los cálculos de «Hoy en Administración», sin React, para poder probarlos.
// Sin imports, para que los tests de node lo carguen tal cual.

/** Un recibo de cobro pendiente, con los datos del cliente para reclamarlo. */
export type Receivable = {
  company_code: number;
  customer_code: string;
  customer_name: string;
  rep_code: number | null;
  phone: string | null;
  email: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  credit_limit: number | null;
  is_blocked: boolean;
  invoice_number: string | null;
  invoice_date: string | null;
  due_date: string | null;
  amount: number;
  pending: number;
  remittance_number: number | null;
  effect_type: string | null;
  is_returned: boolean;
  returned_on: string | null;
};

/** Un pago pendiente a un proveedor. */
export type Payable = {
  company_code: number;
  supplier_code: string;
  supplier_name: string;
  phone: string | null;
  email: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  due_date: string | null;
  amount: number;
  pending: number;
  remittance_number: number | null;
  bank_code: string | null;
  effect_type: string | null;
};

/** Un albarán servido y todavía sin facturar. */
export type UninvoicedNote = {
  company_code: number;
  year: number;
  series: string;
  number: number;
  note_date: string;
  customer_code: string | null;
  customer_name: string;
  rep_code: number | null;
  net_amount: number;
  billing_period: string | null;
  taken_on: string;
};

export type BankAccount = {
  company_code: number;
  account_code: string;
  bank_code: string | null;
  bank_name: string | null;
  description: string | null;
  iban: string | null;
  credit_limit: number | null;
  credit_used: number | null;
};
export type BankBalance = { company_code: number; account_code: string; day: string; balance: number; movement: number };

const DAY_MS = 86_400_000;
const toTime = (day: string) => Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));
/** Días de `from` a `to` (positivo si `to` es posterior). */
export const daysBetween = (from: string, to: string) => Math.round((toTime(to) - toTime(from)) / DAY_MS);
/** El día `days` días después de `day` ("2026-09-30" + 7 → "2026-10-07"). */
export function addDays(day: string, days: number): string {
  const date = new Date(toTime(day) + days * DAY_MS);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export const AGE_BUCKETS = ["0-30", "31-60", "61-90", "+90"] as const;
export type AgeBucket = (typeof AGE_BUCKETS)[number];
/** El tramo de antigüedad de algo vencido hace `days` días. */
export function ageBucket(days: number): AgeBucket {
  if (days <= 30) return "0-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "+90";
}
const emptyBuckets = (): Record<AgeBucket, number> => ({ "0-30": 0, "31-60": 0, "61-90": 0, "+90": 0 });

/**
 * Lo que hay que reclamar: vencido, con algo pendiente y que no esté en manos
 * del banco. Un recibo en una remesa de cobro lo cobra el banco a su
 * vencimiento; si lo devuelve, vuelve a ser nuestro y sí se reclama.
 */
export const isToChase = (row: Receivable, today: string) =>
  row.pending > 0 && row.due_date !== null && row.due_date < today && (row.remittance_number === null || row.is_returned);

export type CustomerDebt = {
  key: string;
  company_code: number;
  customer_code: string;
  name: string;
  rep_code: number | null;
  contact_name: string | null;
  contact_phone: string | null;
  phone: string | null;
  email: string | null;
  /** Todo lo que debe, vencido o no, también lo que está en remesas: lo que cuenta para su riesgo. */
  exposure: number;
  /** Lo vencido que hay que reclamar. */
  overdue: number;
  /** Días del recibo vencido más antiguo (0 si no hay nada vencido). */
  oldestDays: number;
  buckets: Record<AgeBucket, number>;
  returned: number;
  returnedCount: number;
  creditLimit: number | null;
  /** Lo que pasa de su límite, o null si no tiene límite o no lo pasa. */
  overLimit: number | null;
  isBlocked: boolean;
  receipts: Receivable[];
};

/** Los recibos de cobro, cliente a cliente, con lo que hay que reclamar a cada uno. */
export function summarizeReceivables(rows: Receivable[], today: string) {
  const map = new Map<string, CustomerDebt>();
  for (const row of rows) {
    const key = `${row.company_code}-${row.customer_code}`;
    const entry = map.get(key) ?? {
      key,
      company_code: row.company_code,
      customer_code: row.customer_code,
      name: row.customer_name,
      rep_code: row.rep_code,
      contact_name: row.contact_name,
      contact_phone: row.contact_phone,
      phone: row.phone,
      email: row.contact_email || row.email,
      exposure: 0,
      overdue: 0,
      oldestDays: 0,
      buckets: emptyBuckets(),
      returned: 0,
      returnedCount: 0,
      creditLimit: row.credit_limit === null ? null : Number(row.credit_limit),
      overLimit: null,
      isBlocked: row.is_blocked,
      receipts: [],
    };
    const pending = Number(row.pending);
    entry.receipts.push(row);
    entry.exposure += pending;
    if (isToChase(row, today)) {
      const days = daysBetween(row.due_date as string, today);
      entry.overdue += pending;
      entry.oldestDays = Math.max(entry.oldestDays, days);
      entry.buckets[ageBucket(days)] += pending;
    }
    if (row.is_returned && pending > 0) {
      entry.returned += pending;
      entry.returnedCount += 1;
    }
    map.set(key, entry);
  }
  const customers = [...map.values()];
  for (const customer of customers) {
    if (customer.creditLimit !== null && customer.creditLimit > 0 && customer.exposure > customer.creditLimit) {
      customer.overLimit = customer.exposure - customer.creditLimit;
    }
  }
  const totals = {
    overdue: 0,
    overdueCustomers: 0,
    buckets: emptyBuckets(),
    returned: 0,
    returnedCount: 0,
    overLimitCustomers: 0,
    pending: 0,
  };
  for (const customer of customers) {
    totals.pending += customer.exposure;
    if (customer.overdue > 0) {
      totals.overdue += customer.overdue;
      totals.overdueCustomers += 1;
    }
    for (const bucket of AGE_BUCKETS) totals.buckets[bucket] += customer.buckets[bucket];
    totals.returned += customer.returned;
    totals.returnedCount += customer.returnedCount;
    if (customer.overLimit !== null) totals.overLimitCustomers += 1;
  }
  return { customers, totals };
}

export type SupplierDebt = {
  key: string;
  company_code: number;
  supplier_code: string;
  name: string;
  phone: string | null;
  email: string | null;
  /** Vencido y sin remesa: nadie lo está pagando. */
  overdueFree: number;
  /** Vencido pero en una remesa: el banco lo paga o ya lo ha pagado y Sage no lo ha dado por pagado. */
  overdueInRemittance: number;
  /** Lo que vence en los próximos 7 días. */
  dueThisWeek: number;
  pending: number;
  oldestDays: number;
  items: Payable[];
};

/** Los pagos pendientes, proveedor a proveedor. */
export function summarizePayables(rows: Payable[], today: string) {
  const weekEnd = addDays(today, 6);
  const map = new Map<string, SupplierDebt>();
  for (const row of rows) {
    const key = `${row.company_code}-${row.supplier_code}`;
    const entry = map.get(key) ?? {
      key, company_code: row.company_code, supplier_code: row.supplier_code, name: row.supplier_name, phone: row.phone, email: row.email,
      overdueFree: 0, overdueInRemittance: 0, dueThisWeek: 0, pending: 0, oldestDays: 0, items: [],
    };
    const pending = Number(row.pending);
    entry.items.push(row);
    entry.pending += pending;
    if (pending > 0 && row.due_date) {
      if (row.due_date < today) {
        if (row.remittance_number === null) entry.overdueFree += pending;
        else entry.overdueInRemittance += pending;
        entry.oldestDays = Math.max(entry.oldestDays, daysBetween(row.due_date, today));
      } else if (row.due_date <= weekEnd) {
        entry.dueThisWeek += pending;
      }
    }
    map.set(key, entry);
  }
  const suppliers = [...map.values()];
  const totals = { overdueFree: 0, overdueFreeSuppliers: 0, overdueInRemittance: 0, dueThisWeek: 0 };
  for (const supplier of suppliers) {
    totals.overdueFree += supplier.overdueFree;
    if (supplier.overdueFree > 0) totals.overdueFreeSuppliers += 1;
    totals.overdueInRemittance += supplier.overdueInRemittance;
    totals.dueThisWeek += supplier.dueThisWeek;
  }
  return { suppliers, totals };
}

/** Los próximos 7 días: lo que debería entrar y lo que hay que pagar cada día. */
export function nextWeek(receivables: Receivable[], payables: Payable[], today: string) {
  const days = Array.from({ length: 7 }, (_, index) => ({ day: addDays(today, index), collections: 0, payments: 0 }));
  const byDay = new Map(days.map((entry) => [entry.day, entry]));
  for (const row of receivables) {
    if (row.pending > 0 && row.due_date && byDay.has(row.due_date)) (byDay.get(row.due_date) as (typeof days)[number]).collections += Number(row.pending);
  }
  for (const row of payables) {
    if (row.pending > 0 && row.due_date && byDay.has(row.due_date)) (byDay.get(row.due_date) as (typeof days)[number]).payments += Number(row.pending);
  }
  return days;
}

export type UninvoicedCustomer = {
  key: string;
  company_code: number;
  customer_code: string | null;
  name: string;
  rep_code: number | null;
  /** De meses anteriores: ya debería estar facturado. */
  previous: number;
  previousCount: number;
  /** De este mes: puede estar esperando a la factura de fin de mes. */
  current: number;
  currentCount: number;
  oldestDays: number;
  notes: UninvoicedNote[];
};

/**
 * Los albaranes sin facturar, cliente a cliente. Lo de meses anteriores es lo
 * que se ha quedado atrás; lo del mes en curso puede estar esperando a la
 * factura mensual del cliente, así que va aparte.
 */
export function summarizeUninvoiced(rows: UninvoicedNote[], today: string) {
  const monthStart = `${today.slice(0, 7)}-01`;
  const map = new Map<string, UninvoicedCustomer>();
  for (const row of rows) {
    const key = `${row.company_code}-${row.customer_code ?? ""}`;
    const entry = map.get(key) ?? {
      key, company_code: row.company_code, customer_code: row.customer_code, name: row.customer_name, rep_code: row.rep_code,
      previous: 0, previousCount: 0, current: 0, currentCount: 0, oldestDays: 0, notes: [],
    };
    const amount = Number(row.net_amount);
    entry.notes.push(row);
    if (row.note_date < monthStart) {
      entry.previous += amount;
      entry.previousCount += 1;
    } else {
      entry.current += amount;
      entry.currentCount += 1;
    }
    entry.oldestDays = Math.max(entry.oldestDays, daysBetween(row.note_date, today));
    map.set(key, entry);
  }
  const customers = [...map.values()];
  const totals = { previous: 0, previousCount: 0, current: 0, currentCount: 0 };
  for (const customer of customers) {
    totals.previous += customer.previous;
    totals.previousCount += customer.previousCount;
    totals.current += customer.current;
    totals.currentCount += customer.currentCount;
  }
  return { customers, totals };
}

export type BankRow = BankAccount & {
  key: string;
  /** El último saldo que hay y de qué día es. */
  balance: number | null;
  balanceDay: string | null;
  /** Línea de riesgo que queda: el límite menos lo dispuesto. */
  available: number | null;
};

/** Cada cuenta con su último saldo y lo que queda de su línea. */
export function summarizeBanks(accounts: BankAccount[], balances: BankBalance[]) {
  const latest = new Map<string, BankBalance>();
  for (const row of balances) {
    const key = `${row.company_code}-${row.account_code}`;
    const current = latest.get(key);
    if (!current || row.day > current.day) latest.set(key, row);
  }
  const known = new Set<string>();
  const rows: BankRow[] = accounts.map((account) => {
    const key = `${account.company_code}-${account.account_code}`;
    known.add(key);
    const last = latest.get(key);
    const limit = account.credit_limit === null ? null : Number(account.credit_limit);
    const used = account.credit_used === null ? null : Number(account.credit_used);
    return {
      ...account,
      key,
      balance: last ? Number(last.balance) : null,
      balanceDay: last?.day ?? null,
      available: limit !== null && limit > 0 ? limit - (used ?? 0) : null,
    };
  });
  // Una cuenta con saldo pero sin ficha de banco también cuenta.
  for (const [key, last] of latest) {
    if (known.has(key)) continue;
    rows.push({
      company_code: last.company_code, account_code: last.account_code, bank_code: null, bank_name: null, description: null, iban: null,
      credit_limit: null, credit_used: null, key, balance: Number(last.balance), balanceDay: last.day, available: null,
    });
  }
  const totals = {
    balance: rows.reduce((sum, row) => sum + (row.balance ?? 0), 0),
    available: rows.reduce((sum, row) => sum + (row.available ?? 0), 0),
    withBalance: rows.filter((row) => row.balance !== null).length,
    /** El saldo más antiguo que se está sumando: si es de hace días, la tabla de Sage no está al día. */
    oldestDay: rows.reduce<string | null>((oldest, row) => (row.balanceDay && (!oldest || row.balanceDay < oldest) ? row.balanceDay : oldest), null),
  };
  return { rows, totals };
}
