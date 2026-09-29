// Ficheros de confirming para el banco, a partir de una remesa de pagos de Sage.
//
// Dos diseños de registro, tal como los mandaron los bancos:
//   - "aef": el formato estándar de confirming de la Asociación Española de
//     Factoring (tipo "FU"), que usan Sabadell y Bankinter. Registros de 250
//     posiciones: 1 cabecera, 2 domicilio del ordenante (opcional), 3-4-5 datos
//     de cada proveedor, 6 cada factura, 7 totales. Fechas AAAAMMDD.
//   - "bbva": Euroconfirming de BBVA net cash. Registros de 150 posiciones con
//     código de registro y de dato (010/010, 020/010...). Fechas DDMMAAAA.
//
// Sin imports, para que los tests de node lo carguen tal cual.

export type ConfirmingFormat = "aef" | "bbva";
export type ConfirmingModality = "estandar" | "pronto_pago" | "otros";

/** Quien paga: la sociedad. */
export type ConfirmingPayer = {
  name: string;
  nif: string;
  address?: string | null;
  city?: string | null;
  postalCode?: string | null;
  province?: string | null;
};

/** El contrato de confirming de esa sociedad con ese banco. */
export type ConfirmingContract = {
  format: ConfirmingFormat;
  contract: string;
  /** Sufijo del ordenante (BBVA: 3 cifras). */
  suffix?: string | null;
  chargeIban?: string | null;
  modality: ConfirmingModality;
  /** Días de aplazamiento del cargo. Solo se escribe en el fichero si `writeChargeDate`. */
  deferralDays?: number | null;
  /**
   * Escribir la fecha de cargo en cada factura. BBVA rechaza el fichero si se
   * informa sin tener firmado el anexo de aplazamiento; Sabadell solo la usa en
   * Confirming Plus. Por defecto no se escribe: el banco aplica su contrato.
   */
  writeChargeDate?: boolean;
  /** Correo que se pone al proveedor que no tiene uno en Sage (el registro 4 del formato AEF lo exige). */
  fallbackEmail?: string | null;
};

export type ConfirmingPayment = {
  supplierCode: string;
  supplierName: string;
  supplierNif: string;
  address: string | null;
  city: string | null;
  postalCode: string | null;
  province?: string | null;
  countryCode?: string | null;
  email?: string | null;
  phone?: string | null;
  iban: string | null;
  invoiceNumber: string;
  /** AAAA-MM-DD */
  invoiceDate: string;
  /** AAAA-MM-DD */
  dueDate: string;
  /** Euros; negativo para un abono. */
  amount: number;
  /** Referencia para conciliar el cargo (N43). */
  reference?: string | null;
};

export type ConfirmingBatch = {
  payer: ConfirmingPayer;
  contract: ConfirmingContract;
  /** AAAA-MM-DD */
  remittanceDate: string;
  /** AAAA-MM-DD. Hoy, si no se indica. */
  sendDate: string;
  fileReference: string;
  payments: ConfirmingPayment[];
};

export type ConfirmingResult = {
  content: string;
  records: string[];
  /** Lo que impide generar el fichero: el banco lo rechazaría. */
  errors: string[];
  /** Lo que conviene revisar pero no impide generarlo. */
  warnings: string[];
  suppliers: number;
  total: number;
};

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

/**
 * Texto en ASCII, como piden los dos diseños: sin tildes, Ñ como N y en
 * mayúsculas. Lo que no sea letra, cifra o signo corriente pasa a espacio.
 */
export function asciiText(value: string | null | undefined, keepCase = false): string {
  const text = (value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[ñÑ]/g, (letter) => (letter === "ñ" ? "n" : "N"))
    .replace(/[çÇ]/g, (letter) => (letter === "ç" ? "c" : "C"))
    .replace(/[ºª]/g, "")
    .replace(/[^A-Za-z0-9 .,\-/&()'@_+:;]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return keepCase ? text : text.toUpperCase();
}

/** Campo alfanumérico: a la izquierda y con espacios. */
function alpha(value: string, length: number): string {
  return value.slice(0, length).padEnd(length, " ");
}

/** Campo numérico: a la derecha y con ceros. */
function numeric(value: number | string, length: number): string {
  const digits = String(value).replace(/\D/g, "");
  return digits.slice(-length).padStart(length, "0");
}

/** Importe en céntimos, sin signo, con ceros a la izquierda. */
function amountField(euros: number, length: number): string {
  return numeric(Math.round(Math.abs(euros) * 100), length);
}

const compactIban = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, "").toUpperCase();

/** Comprueba un IBAN con su dígito de control (módulo 97). */
export function isValidIban(value: string | null | undefined): boolean {
  const iban = compactIban(value);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  const moved = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const char of moved) {
    const code = /[A-Z]/.test(char) ? String(char.charCodeAt(0) - 55) : char;
    for (const digit of code) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

const ymd = (date: string) => date.replaceAll("-", "");
const dmy = (date: string) => `${date.slice(8, 10)}${date.slice(5, 7)}${date.slice(0, 4)}`;
const addDays = (date: string, days: number) => {
  const [y, m, d] = date.split("-").map(Number);
  const value = new Date(Date.UTC(y, m - 1, d + days));
  return value.toISOString().slice(0, 10);
};

/**
 * Coloca los campos en su posición (contando desde 1, como en los diseños) y
 * rellena con espacios hasta la longitud del registro.
 */
function record(length: number, fields: [position: number, value: string][]): string {
  const chars = Array.from({ length }, () => " ");
  for (const [position, value] of fields) {
    for (let index = 0; index < value.length; index += 1) {
      const target = position - 1 + index;
      if (target < length) chars[target] = value[index];
    }
  }
  return chars.join("");
}

/** Los pagos de un mismo proveedor a una misma cuenta van juntos, en un solo bloque. */
function groupBySupplier(payments: ConfirmingPayment[]) {
  const groups = new Map<string, ConfirmingPayment[]>();
  for (const payment of payments) {
    const key = `${asciiText(payment.supplierNif)}|${compactIban(payment.iban)}`;
    const list = groups.get(key) ?? [];
    list.push(payment);
    groups.set(key, list);
  }
  return [...groups.values()];
}

// ---------------------------------------------------------------------------
// Comprobaciones comunes
// ---------------------------------------------------------------------------

function validate(batch: ConfirmingBatch): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const { payer, contract, payments } = batch;
  if (!asciiText(payer.name)) errors.push("Falta el nombre de la sociedad que paga.");
  if (!asciiText(payer.nif)) errors.push("Falta el NIF de la sociedad que paga.");
  if (!asciiText(contract.contract)) errors.push("Falta el número de contrato de confirming de este banco.");
  if (contract.format === "bbva" && asciiText(contract.contract).length > 8) {
    errors.push("En BBVA el número de contrato de confirming tiene como mucho 8 caracteres.");
  }
  if (contract.format === "bbva" && !isValidIban(contract.chargeIban)) {
    errors.push("BBVA exige el IBAN de la cuenta de cargo y el que hay no es válido.");
  } else if (contract.chargeIban && !isValidIban(contract.chargeIban)) {
    errors.push("El IBAN de la cuenta de cargo no es válido.");
  }
  if (payments.length === 0) errors.push("La remesa no tiene pagos.");

  for (const payment of payments) {
    const who = asciiText(payment.supplierName) || payment.supplierCode;
    const invoice = payment.invoiceNumber || "(sin número)";
    if (!asciiText(payment.supplierNif)) errors.push(`${who}: falta el NIF.`);
    if (!asciiText(payment.supplierName)) errors.push(`Proveedor ${payment.supplierCode}: falta el nombre.`);
    if (!asciiText(payment.address)) errors.push(`${who}: falta el domicilio.`);
    if (!asciiText(payment.city)) errors.push(`${who}: falta la población.`);
    if ((payment.countryCode ?? "ES") === "ES" && !asciiText(payment.postalCode)) errors.push(`${who}: falta el código postal.`);
    if (!isValidIban(payment.iban)) errors.push(`${who}: el IBAN ${payment.iban ? `"${payment.iban}" ` : ""}no es válido.`);
    if (contract.format === "aef" && !payment.email?.trim() && !contract.fallbackEmail?.trim()) {
      errors.push(`${who}: no tiene correo en Sage y el formato lo exige (o pon un correo por defecto en la configuración del banco).`);
    }
    if (!payment.invoiceNumber?.trim()) errors.push(`${who}: una factura no tiene número.`);
    if (!payment.amount) errors.push(`${who}, factura ${invoice}: el importe es cero.`);
    if (payment.dueDate < payment.invoiceDate) errors.push(`${who}, factura ${invoice}: vence antes de su fecha de factura.`);
    if (contract.format === "bbva" && payment.invoiceDate > batch.remittanceDate) {
      errors.push(`${who}, factura ${invoice}: BBVA no admite facturas con fecha posterior a la de la remesa.`);
    }
    if (payment.dueDate < batch.sendDate) warnings.push(`${who}, factura ${invoice}: el vencimiento (${payment.dueDate}) ya ha pasado.`);
    if (asciiText(payment.supplierName).length > (contract.format === "aef" ? 70 : 60)) warnings.push(`${who}: el nombre se corta en el fichero.`);
    if (asciiText(payment.address).length > (contract.format === "aef" ? 65 : 36)) warnings.push(`${who}: el domicilio se corta en el fichero.`);
  }

  // Los abonos no pueden superar a los pagos de un mismo proveedor, cuenta y vencimiento.
  const nets = new Map<string, { who: string; due: string; net: number; hasCredit: boolean }>();
  for (const payment of payments) {
    const key = `${asciiText(payment.supplierNif)}|${compactIban(payment.iban)}|${payment.dueDate}`;
    const entry = nets.get(key) ?? { who: asciiText(payment.supplierName) || payment.supplierCode, due: payment.dueDate, net: 0, hasCredit: false };
    entry.net += payment.amount;
    entry.hasCredit ||= payment.amount < 0;
    nets.set(key, entry);
  }
  for (const entry of nets.values()) {
    if (entry.hasCredit && entry.net <= 0) errors.push(`${entry.who}: los abonos que vencen el ${entry.due} igualan o superan a los pagos de ese día.`);
  }
  return { errors, warnings };
}

// ---------------------------------------------------------------------------
// Formato estándar AEF (Sabadell, Bankinter): registros de 250
// ---------------------------------------------------------------------------

const MODALITY_CODE: Record<ConfirmingModality, string> = { estandar: "1", pronto_pago: "2", otros: "3" };

function buildAef(batch: ConfirmingBatch): string[] {
  const { payer, contract } = batch;
  const L = 250;
  const records: string[] = [];
  records.push(record(L, [
    [1, "1"],
    [2, alpha(asciiText(payer.name), 50)],
    [52, alpha(asciiText(payer.nif), 15)],
    [75, ymd(batch.remittanceDate)],
    [83, alpha(asciiText(contract.contract), 20)],
    [103, alpha(compactIban(contract.chargeIban), 34)],
    [137, "EUR"],
    [140, MODALITY_CODE[contract.modality]],
    [141, alpha(asciiText(batch.fileReference), 30)],
    [171, "FU"],
  ]));
  if (asciiText(payer.address) || asciiText(payer.city) || asciiText(payer.postalCode)) {
    records.push(record(L, [
      [1, "2"],
      [2, alpha(asciiText(payer.address), 65)],
      [67, alpha(asciiText(payer.city), 40)],
      [107, alpha(asciiText(payer.postalCode), 10)],
    ]));
  }
  let suppliers = 0;
  let total = 0;
  for (const group of groupBySupplier(batch.payments)) {
    const first = group[0];
    suppliers += 1;
    records.push(record(L, [
      [1, "3"],
      [2, alpha(asciiText(first.supplierName), 70)],
      [72, alpha(asciiText(first.supplierNif).replace(/[\s.-]/g, ""), 20)],
      [92, alpha(asciiText(first.address), 65)],
      [157, alpha(asciiText(first.city), 40)],
      [197, alpha(asciiText(first.postalCode), 10)],
      [207, alpha(asciiText(first.countryCode ?? "ES"), 2)],
    ]));
    records.push(record(L, [
      [1, "4"],
      [2, alpha(asciiText(first.email?.trim() || contract.fallbackEmail || "", true), 50)],
      [102, alpha(asciiText(first.phone).replace(/[^\d+]/g, ""), 15)],
    ]));
    records.push(record(L, [
      [1, "5"],
      [2, "T"],
      [3, alpha(compactIban(first.iban), 34)],
    ]));
    for (const payment of group) {
      total += payment.amount;
      const charge = contract.writeChargeDate && contract.deferralDays ? ymd(addDays(payment.dueDate, contract.deferralDays)) : "";
      records.push(record(L, [
        [1, "6"],
        [2, alpha(asciiText(payment.invoiceNumber), 20)],
        [22, payment.amount < 0 ? "-" : "+"],
        [23, amountField(payment.amount, 15)],
        [38, ymd(payment.invoiceDate)],
        [46, ymd(payment.dueDate)],
        [54, alpha(charge, 8)],
        [62, alpha(asciiText(payment.reference), 16)],
      ]));
    }
  }
  records.push(record(L, [
    [1, "7"],
    [2, numeric(suppliers, 12)],
    [14, amountField(total, 15)],
  ]));
  return records;
}

// ---------------------------------------------------------------------------
// Euroconfirming BBVA: registros de 150
// ---------------------------------------------------------------------------

function buildBbva(batch: ConfirmingBatch): string[] {
  const { payer, contract } = batch;
  const L = 150;
  const nif = alpha(asciiText(payer.nif).replace(/[\s.-]/g, ""), 25);
  const suffix = numeric(contract.suffix ?? "0", 3);
  const records: string[] = [];
  // Cada registro lleva su número de dato: una secuencia desde 1 en todo el fichero.
  const push = (code: string, dato: string, fields: [number, string][], who = nif) => {
    records.push(record(L, [[1, code], [4, dato], [7, who], [32, suffix], [35, numeric(records.length + 1, 6)], ...fields]));
  };

  push("010", "010", [
    [41, dmy(batch.sendDate)],
    [49, "0182"],
    [53, alpha(asciiText(payer.name), 60)],
    [113, alpha(asciiText(batch.fileReference), 10)],
  ]);
  const payerStart = records.length;
  push("020", "010", [
    [41, dmy(batch.sendDate)],
    [49, dmy(batch.remittanceDate)],
    [57, alpha(compactIban(contract.chargeIban), 34)],
    [91, alpha(asciiText(contract.contract), 8)],
    [99, alpha(asciiText(batch.fileReference), 10)],
  ]);
  push("020", "020", [[41, alpha(asciiText(payer.name), 60)]]);
  if (asciiText(payer.address) && asciiText(payer.city)) {
    push("020", "030", [[41, alpha(asciiText(payer.address), 36)]]);
    push("020", "031", [
      [41, alpha(asciiText(payer.postalCode), 7)],
      [48, alpha(asciiText(payer.city), 28)],
      [76, alpha(asciiText(payer.province), 20)],
      [116, "ES"],
    ]);
  }

  let positive = 0;
  let negative = 0;
  for (const group of groupBySupplier(batch.payments)) {
    const first = group[0];
    push("030", "010", [
      [41, alpha(asciiText(first.supplierNif).replace(/[\s.-]/g, ""), 25)],
      [66, "000"],
      [69, alpha(asciiText(first.supplierName), 60)],
    ]);
    push("030", "020", [[41, alpha(asciiText(first.address), 36)]]);
    push("030", "021", [
      [41, alpha(asciiText(first.postalCode), 7)],
      [48, alpha(asciiText(first.city), 28)],
      [76, alpha(asciiText(first.province), 20)],
      [116, alpha(asciiText(first.countryCode ?? "ES"), 2)],
    ]);
    const phone = asciiText(first.phone).replace(/[^\d+]/g, "");
    const email = asciiText(first.email, true);
    if (phone || email) push("030", "040", [[41, alpha(phone, 15)], [71, alpha(email, 50)]]);
    push("030", "050", [[41, alpha(compactIban(first.iban), 34)]]);
    for (const payment of group) {
      if (payment.amount < 0) negative += -payment.amount;
      else positive += payment.amount;
      const charge = contract.writeChargeDate && contract.deferralDays ? dmy(addDays(payment.dueDate, contract.deferralDays)) : "";
      push("040", "020", [
        [41, alpha(asciiText(payment.reference), 18)],
        [59, alpha(asciiText(payment.invoiceNumber), 20)],
        [79, dmy(payment.invoiceDate)],
        [87, dmy(payment.dueDate)],
        [95, payment.amount < 0 ? "-" : "+"],
        [96, amountField(payment.amount, 15)],
        [111, "EUR"],
        [115, alpha(charge, 8)],
      ]);
    }
  }
  // Totales del ordenante: sus registros, desde su primera cabecera hasta este incluido.
  push("050", "090", [
    [41, numeric(records.length - payerStart + 1, 6)],
    [47, amountField(positive, 18)],
    [65, amountField(negative, 18)],
  ]);
  // Totales del fichero: todos los registros, este incluido.
  push("050", "099", [
    [41, numeric(records.length + 1, 6)],
    [47, amountField(positive, 18)],
    [65, amountField(negative, 18)],
  ]);
  return records;
}

// ---------------------------------------------------------------------------

export function buildConfirmingFile(batch: ConfirmingBatch): ConfirmingResult {
  const { errors, warnings } = validate(batch);
  const records = batch.contract.format === "bbva" ? buildBbva(batch) : buildAef(batch);
  const total = batch.payments.reduce((sum, payment) => sum + payment.amount, 0);
  return {
    // Cada registro en su línea, con salto de Windows, que es lo que esperan los bancos.
    content: `${records.join("\r\n")}\r\n`,
    records,
    errors,
    warnings,
    suppliers: groupBySupplier(batch.payments).length,
    total: Math.round(total * 100) / 100,
  };
}

/** El nombre del fichero que se descarga. */
export function confirmingFileName(bank: string, companyCode: number, remittance: number, date: string): string {
  return `confirming-${asciiText(bank).toLowerCase().replace(/\s+/g, "-")}-s${companyCode}-remesa${remittance}-${ymd(date)}.txt`;
}
