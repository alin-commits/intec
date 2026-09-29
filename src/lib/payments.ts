// Pagos a proveedores y tesorería: la lógica, sin React. Sin imports, para que
// los tests de node lo carguen tal cual.

export type BankName = "Sabadell" | "Bankinter" | "BBVA" | "Otro";
export const BANK_NAMES: BankName[] = ["Sabadell", "Bankinter", "BBVA", "Otro"];

/**
 * El diseño de fichero de cada banco. Sabadell y Bankinter usan el formato
 * estándar de la AEF; BBVA, su Euroconfirming. Otro banco: el estándar, que es
 * el que la AEF propone a todos.
 */
export function formatForBank(bank: BankName): "aef" | "bbva" {
  return bank === "BBVA" ? "bbva" : "aef";
}

export type BankSetting = {
  id: string;
  company_code: number;
  sage_bank_code: string;
  bank_name: BankName;
  format: "aef" | "bbva";
  contract: string;
  suffix: string | null;
  charge_iban: string | null;
  modality: "estandar" | "pronto_pago" | "otros";
  deferral_days: number | null;
  write_charge_date: boolean;
  fallback_email: string | null;
  active: boolean;
};

export const settingKey = (companyCode: number, bankCode: string) => `${companyCode}|${bankCode.trim()}`;

// ---------------------------------------------------------------------------
// IBAN cambiado
// ---------------------------------------------------------------------------

const cleanIban = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, "").toUpperCase();

/** "ES91 2100 0418 45** **** 1332": se ve de qué banco es y cómo acaba. */
export function maskIban(value: string | null | undefined): string {
  const iban = cleanIban(value);
  if (iban.length < 12) return iban || "—";
  const groups = iban.match(/.{1,4}/g) ?? [];
  return groups.map((group, index) => (index < 3 || index === groups.length - 1 ? group : "****")).join(" ");
}

export type IbanUse = { supplierCode: string; iban: string | null; date: string | null };

/**
 * Los proveedores de esta remesa cuyo IBAN no es el del último pago anterior.
 * Es la estafa de siempre: "hemos cambiado de banco, pagadnos aquí". Un aviso
 * así hay que comprobarlo por teléfono antes de mandar el fichero.
 */
export function changedIbans(current: IbanUse[], history: IbanUse[], remittanceDate: string | null): Map<string, { previous: string; current: string; since: string | null }> {
  const previous = new Map<string, { iban: string; date: string | null }>();
  for (const use of history) {
    const iban = cleanIban(use.iban);
    if (!iban) continue;
    if (remittanceDate && use.date && use.date >= remittanceDate) continue;
    const known = previous.get(use.supplierCode);
    if (!known || (use.date ?? "") > (known.date ?? "")) previous.set(use.supplierCode, { iban, date: use.date });
  }
  const changes = new Map<string, { previous: string; current: string; since: string | null }>();
  for (const use of current) {
    const iban = cleanIban(use.iban);
    const known = previous.get(use.supplierCode);
    if (iban && known && known.iban !== iban) changes.set(use.supplierCode, { previous: known.iban, current: iban, since: known.date });
  }
  return changes;
}

// ---------------------------------------------------------------------------
// Tesorería por semanas
// ---------------------------------------------------------------------------

export type OpenItem = {
  company_code: number;
  kind: "cobro" | "pago";
  counterpart_code: string;
  invoice_number: string | null;
  due_date: string | null;
  pending: number;
  remittance_number: number | null;
  bank_code: string | null;
};

const pad = (value: number) => String(value).padStart(2, "0");
const toKey = (date: Date) => `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
const fromKey = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
export const addDaysKey = (key: string, days: number) => {
  const date = fromKey(key);
  date.setUTCDate(date.getUTCDate() + days);
  return toKey(date);
};
/** El lunes de la semana de una fecha. */
export function mondayOf(key: string): string {
  const date = fromKey(key);
  const weekday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - weekday);
  return toKey(date);
}

/**
 * Cuándo sale el dinero de verdad. Un pago metido en una remesa de confirming
 * con aplazamiento no sale el día que vence: el banco paga al proveedor ese día
 * y a la empresa se lo carga los días de aplazamiento después.
 */
export function cashDate(item: OpenItem, deferralFor: (companyCode: number, bankCode: string) => number | null): string | null {
  if (!item.due_date) return null;
  if (item.kind === "pago" && item.remittance_number && item.bank_code) {
    const days = deferralFor(item.company_code, item.bank_code);
    if (days) return addDaysKey(item.due_date, days);
  }
  return item.due_date;
}

export type TreasuryWeek = {
  key: string;
  label: string;
  from: string | null;
  to: string | null;
  cobros: number;
  /** Pagos que vencen esa semana (lo que ve el proveedor). */
  pagos: number;
  /** Lo que sale de la cuenta esa semana: los pagos con el aplazamiento ya aplicado. */
  salidas: number;
  neto: number;
  acumulado: number;
  items: OpenItem[];
};

const shortDay = (key: string) => `${Number(key.slice(8, 10))}/${Number(key.slice(5, 7))}`;

/**
 * La previsión por semanas desde hoy: lo vencido y no cobrado ni pagado junto
 * al principio, trece semanas y el resto al final. El neto es cobros menos lo
 * que sale de la cuenta, y el acumulado va sumando semana a semana.
 */
export function treasuryWeeks(items: OpenItem[], today: string, deferralFor: (companyCode: number, bankCode: string) => number | null, weeks = 13): TreasuryWeek[] {
  const start = mondayOf(today);
  const buckets: TreasuryWeek[] = [
    { key: "vencido", label: "Vencido", from: null, to: addDaysKey(start, -1), cobros: 0, pagos: 0, salidas: 0, neto: 0, acumulado: 0, items: [] },
  ];
  for (let index = 0; index < weeks; index += 1) {
    const from = addDaysKey(start, index * 7);
    const to = addDaysKey(from, 6);
    buckets.push({ key: from, label: `${shortDay(from)}–${shortDay(to)}`, from, to, cobros: 0, pagos: 0, salidas: 0, neto: 0, acumulado: 0, items: [] });
  }
  const lastTo = buckets[buckets.length - 1].to as string;
  buckets.push({ key: "despues", label: "Más adelante", from: addDaysKey(lastTo, 1), to: null, cobros: 0, pagos: 0, salidas: 0, neto: 0, acumulado: 0, items: [] });

  const bucketFor = (date: string) => {
    if (date < start) return buckets[0];
    if (date > lastTo) return buckets[buckets.length - 1];
    return buckets[1 + Math.floor((fromKey(date).getTime() - fromKey(start).getTime()) / (7 * 86_400_000))];
  };

  for (const item of items) {
    if (!item.due_date || !item.pending) continue;
    const amount = Number(item.pending);
    if (item.kind === "cobro") {
      const bucket = bucketFor(item.due_date);
      bucket.cobros += amount;
      bucket.items.push(item);
      continue;
    }
    const due = bucketFor(item.due_date);
    due.pagos += amount;
    due.items.push(item);
    const cash = bucketFor(cashDate(item, deferralFor) ?? item.due_date);
    cash.salidas += amount;
    if (cash !== due) cash.items.push(item);
  }
  let running = 0;
  for (const bucket of buckets) {
    bucket.neto = bucket.cobros - bucket.salidas;
    running += bucket.neto;
    bucket.acumulado = running;
  }
  return buckets;
}
