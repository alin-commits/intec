// Lo que manda el agente de Sage (scripts/sage/agente-sage.ps1) y cómo se pasa
// a la base de datos. Aparte de la ruta para poder probarlo sin servidor.
import { z } from "zod";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const month = z.string().regex(/^\d{4}-\d{2}-01$/);
const amount = z.number().finite();
const count = z.number().int().nonnegative();
/** Nulo cuando el documento no tiene comercial asignado; se enseña como «sin asignar». */
const repCode = z.number().int().nullable().default(null);
/** Un texto que puede faltar; vacío cuenta como que falta. */
const optionalText = (max: number) => z.string().trim().max(max).nullable().default(null).transform((value) => (value ? value : null));
const optionalDay = day.nullable().default(null);
const code = z.string().trim().max(40);
/** Un importe que el agente antiguo no manda: nulo quiere decir «no se leyó», no cero. */
const optionalAmount = amount.nullable().default(null);

const salesRow = z.object({
  companyCode: z.number().int(),
  basis: z.enum(["albaran", "factura"]),
  day,
  series: z.string().trim().max(20).default(""),
  repCode,
  documents: count,
  netAmount: amount,
  costAmount: amount,
  vatAmount: amount,
  /** Parte de netAmount sin coste grabado. Por defecto cero, para que un agente
      antiguo que todavía no lo manda siga funcionando. */
  netWithoutCost: amount.default(0),
  /** Líneas de los albaranes, para los artículos medios por venta. */
  lines: count.default(0),
  /** Para el director comercial: el bruto antes de descuentos, el descuento de
      línea (el que pone el comercial), el rappel y la comisión que calcula Sage. */
  grossAmount: optionalAmount,
  lineDiscountAmount: optionalAmount,
  rappelAmount: optionalAmount,
  commissionAmount: optionalAmount,
});

/** Ofertas y pedidos comparten forma: totales por día, serie y comercial. */
const documentRow = z.object({
  companyCode: z.number().int(),
  day,
  series: z.string().trim().max(20).default(""),
  repCode,
  documents: count,
  netAmount: amount,
});

/*
  Todo es opcional salvo la ventana de fechas. Si una parte no viene, no se toca
  lo que ya hay de ella: así funciona el agente antiguo, que solo manda ventas,
  el nuevo cuando no puede leer alguna tabla de Sage, y los envíos parciales
  (solo los meses, solo el repaso de ofertas...) que hace el agente nuevo.
*/
export const sageIngestSchema = z.object({
  coveredFrom: day,
  coveredTo: day,
  /** El día de las fotos (cartera, clientes dormidos), en la hora del servidor de Sage. */
  takenOn: day.optional(),
  companies: z.array(z.object({
    code: z.number().int(),
    name: z.string().trim().min(1).max(160),
    isActive: z.boolean().default(true),
  })).max(50).default([]),
  reps: z.array(z.object({
    companyCode: z.number().int(),
    code: z.number().int(),
    name: z.string().trim().min(1).max(160),
    isPerson: z.boolean().default(true),
    /** Jefe de ventas, de quién depende y si sigue en la empresa. */
    isManager: z.boolean().default(false),
    managerCode: z.number().int().nullable().default(null),
    isActive: z.boolean().default(true),
    leftOn: optionalDay,
  })).max(500).default([]),
  sales: z.array(salesRow).max(20000).optional(),
  offers: z.array(documentRow).max(20000).optional(),
  orders: z.array(documentRow).max(20000).optional(),
  families: z.array(z.object({
    companyCode: z.number().int(),
    code,
    name: z.string().trim().min(1).max(160),
  })).max(5000).optional(),
  subfamilies: z.array(z.object({
    companyCode: z.number().int(),
    familyCode: code,
    code,
    name: z.string().trim().min(1).max(160),
  })).max(10000).optional(),
  familySales: z.array(z.object({
    companyCode: z.number().int(),
    day,
    familyCode: code.default(""),
    units: amount.default(0),
    netAmount: amount,
    costAmount: amount.default(0),
    /** Parte de netAmount de líneas sin coste grabado, que el margen deja fuera. */
    netWithoutCost: amount.default(0),
    grossAmount: optionalAmount,
  })).max(40000).optional(),
  customers: z.array(z.object({
    companyCode: z.number().int(),
    month,
    activeCustomers: count,
    newCustomers: count,
  })).max(2000).optional(),
  backlog: z.array(z.object({
    companyCode: z.number().int(),
    repCode,
    count,
    amount,
  })).max(2000).optional(),
  dormant: z.array(z.object({
    companyCode: z.number().int(),
    count,
    amount,
  })).max(50).optional(),
  /** Solo nombres de tablas y columnas de Sage, para poder ampliar la lectura. */
  schema: z.array(z.object({
    table: z.string().trim().min(1).max(128),
    column: z.string().trim().min(1).max(128),
    type: z.string().trim().max(64).default(""),
  })).max(15000).optional(),

  // ----- El detalle -----
  /** Clientes con nombre y contacto: Dirección lo pidió para poder actuar sobre las listas. */
  customerList: z.array(z.object({
    companyCode: z.number().int(),
    code,
    name: z.string().trim().min(1).max(200),
    tradeName: optionalText(200),
    repCode,
    province: optionalText(80),
    municipality: optionalText(80),
    postalCode: optionalText(20),
    activity: optionalText(120),
    customerType: optionalText(40),
    customerGroup: optionalText(40),
    phone: optionalText(40),
    email: optionalText(160),
    createdOn: optionalDay,
    lastActionOn: optionalDay,
    leaveReason: optionalText(80),
    leftOn: optionalDay,
    /** Códigos de la ficha: el nombre de cada uno está en las tablas de códigos. */
    zoneCode: optionalText(40),
    channelCode: optionalText(40),
    sectorCode: optionalText(40),
    paymentMethod: optionalText(40),
    /** Para Administración: el límite de riesgo del cliente y si está bloqueado. */
    creditLimit: optionalAmount,
    isBlocked: z.boolean().default(false),
  })).max(20000).optional(),
  customerDays: z.array(z.object({
    companyCode: z.number().int(),
    customerCode: code,
    day,
    series: z.string().trim().max(20).default(""),
    repCode,
    documents: count,
    lines: count.default(0),
    netAmount: amount,
    costAmount: amount.default(0),
    netWithoutCost: amount.default(0),
    grossAmount: optionalAmount,
    lineDiscountAmount: optionalAmount,
  })).max(30000).optional(),
  customerFamilies: z.array(z.object({
    companyCode: z.number().int(),
    customerCode: code,
    month,
    familyCode: code.default(""),
    netAmount: amount,
    costAmount: amount.default(0),
    netWithoutCost: amount.default(0),
    grossAmount: optionalAmount,
  })).max(40000).optional(),
  articleList: z.array(z.object({
    companyCode: z.number().int(),
    code,
    name: z.string().trim().min(1).max(200),
    familyCode: optionalText(40),
    subfamilyCode: optionalText(40),
    brand: optionalText(80),
    supplierCode: optionalText(40),
    manufacturer: optionalText(80),
    abc: optionalText(10),
    createdOn: optionalDay,
    obsolete: z.boolean().default(false),
  })).max(40000).optional(),
  articleSales: z.array(z.object({
    companyCode: z.number().int(),
    month,
    articleCode: code.default(""),
    familyCode: code.default(""),
    subfamilyCode: code.default(""),
    units: amount.default(0),
    documents: count.default(0),
    netAmount: amount,
    costAmount: amount.default(0),
    netWithoutCost: amount.default(0),
    grossAmount: optionalAmount,
  })).max(40000).optional(),
  offerDocuments: z.array(z.object({
    companyCode: z.number().int(),
    year: z.number().int(),
    series: z.string().trim().max(20).default(""),
    number: z.number().int(),
    offerDate: day,
    presentedOn: optionalDay,
    validUntil: optionalDay,
    expectedClose: optionalDay,
    customerCode: optionalText(40),
    repCode,
    status: z.number().int().nullable().default(null),
    probability: optionalText(40),
    rejectReason: optionalText(120),
    lossDetail: optionalText(300),
    netAmount: amount,
    lines: count.default(0),
    orderedAmount: amount.default(0),
    firstOrderOn: optionalDay,
  })).max(20000).optional(),
  orderDocuments: z.array(z.object({
    companyCode: z.number().int(),
    year: z.number().int(),
    series: z.string().trim().max(20).default(""),
    number: z.number().int(),
    orderDate: day,
    neededOn: optionalDay,
    deliveryOn: optionalDay,
    customerCode: optionalText(40),
    repCode,
    status: z.number().int().nullable().default(null),
    netAmount: amount,
    pendingAmount: amount.default(0),
    lines: count.default(0),
    fromOffer: z.boolean().default(false),
    deliveredAmount: amount.default(0),
    firstDeliveryOn: optionalDay,
  })).max(20000).optional(),
  incidents: z.array(z.object({
    companyCode: z.number().int(),
    day,
    kind: z.enum(["abono", "incidencia"]),
    reason: z.string().trim().max(120).default(""),
    series: z.string().trim().max(20).default(""),
    repCode,
    documents: count,
    netAmount: amount,
  })).max(10000).optional(),
  /** Tablas de códigos de Sage (motivos, tipos de cliente...): código y nombre. */
  lookups: z.array(z.object({
    table: z.string().trim().min(1).max(128),
    code: z.string().trim().min(1).max(60),
    name: z.string().trim().min(1).max(200),
    /** La columna de código (CodigoZona...): la tabla se llama distinto en cada Sage. */
    column: optionalText(128),
  })).max(20000).optional(),
  /** Las personas de contacto de cada cliente. Llegan enteras por la noche. */
  customerContacts: z.array(z.object({
    companyCode: z.number().int(),
    customerCode: code,
    position: z.number().int(),
    name: z.string().trim().min(1).max(200),
    roleCode: optionalText(40),
    areaCode: optionalText(40),
    phone: optionalText(40),
    phone2: optionalText(40),
    phone3: optionalText(40),
    email: optionalText(160),
    isCommercial: z.boolean().default(false),
    isAdmin: z.boolean().default(false),
    isOperational: z.boolean().default(false),
  })).max(20000).optional(),
  /** El primer trozo de contactos borra los anteriores; los demás se suman. */
  customerContactsReplace: z.boolean().optional(),
  /** Lo que el agente quiere que conste: qué no pudo leer y por qué. */
  notes: z.array(z.string().trim().max(300)).max(30).optional(),

  // ---- Pagos a proveedores (van a sage_ingest_payments) ----
  /** NIF y domicilio de cada sociedad: el ordenante del fichero de confirming. */
  companyDetails: z.array(z.object({
    companyCode: z.number().int(),
    nif: optionalText(30),
    address: optionalText(200),
    postalCode: optionalText(20),
    city: optionalText(100),
    province: optionalText(100),
  })).max(100).optional(),
  suppliers: z.array(z.object({
    companyCode: z.number().int(),
    code,
    name: z.string().trim().min(1).max(200),
    tradeName: optionalText(200),
    nif: optionalText(30),
    address: optionalText(200),
    postalCode: optionalText(20),
    city: optionalText(100),
    province: optionalText(100),
    country: optionalText(60),
    phone: optionalText(40),
    email: optionalText(160),
  })).max(20000).optional(),
  /** Las remesas de pagos de Sage: cada una llega entera (cabecera y efectos). */
  paymentRemittances: z.array(z.object({
    companyCode: z.number().int(),
    number: z.number().int(),
    remittanceDate: optionalDay,
    valueDate: optionalDay,
    bankCode: z.string().trim().max(40).default(""),
    remittanceType: optionalText(20),
    csbNorm: optionalText(20),
    total: amount.default(0),
    effects: count.default(0),
    provisional: z.boolean().default(false),
  })).max(5000).optional(),
  paymentItems: z.array(z.object({
    companyCode: z.number().int(),
    remittanceNumber: z.number().int(),
    movementId: z.string().trim().min(1).max(60),
    effectNumber: z.number().int().nullable().default(null),
    supplierCode: code,
    invoiceNumber: optionalText(40),
    invoiceDate: optionalDay,
    dueDate: optionalDay,
    amount: amount.default(0),
    pending: amount.default(0),
    iban: optionalText(40),
  })).max(20000).optional(),
  /** La cartera pendiente de cobros y pagos. Llega por trozos: el primero borra la foto anterior. */
  openItems: z.array(z.object({
    companyCode: z.number().int(),
    kind: z.enum(["cobro", "pago"]),
    movementId: optionalText(60),
    counterpartCode: code,
    invoiceNumber: optionalText(40),
    invoiceDate: optionalDay,
    dueDate: optionalDay,
    amount: amount.default(0),
    pending: amount.default(0),
    remittanceNumber: z.number().int().nullable().default(null),
    bankCode: optionalText(40),
    effectType: optionalText(20),
    /** Recibo devuelto por el banco, y cuándo. */
    isReturned: z.boolean().default(false),
    returnedOn: optionalDay,
  })).max(20000).optional(),
  openItemsReplace: z.boolean().optional(),
  /** Los albaranes sin facturar del último año. Llegan enteros; el primer trozo sustituye a los anteriores. */
  uninvoicedNotes: z.array(z.object({
    companyCode: z.number().int(),
    year: z.number().int(),
    series: z.string().trim().max(20).default(""),
    number: z.number().int(),
    noteDate: day,
    customerCode: optionalText(40),
    repCode,
    netAmount: amount.default(0),
    billingPeriod: optionalText(20),
  })).max(20000).optional(),
  uninvoicedNotesReplace: z.boolean().optional(),
  /** Las cuentas de los bancos, con la línea de riesgo y lo dispuesto. */
  bankAccounts: z.array(z.object({
    companyCode: z.number().int(),
    accountCode: z.string().trim().min(1).max(40),
    bankCode: optionalText(20),
    bankName: optionalText(120),
    description: optionalText(160),
    iban: optionalText(40),
    creditLimit: optionalAmount,
    creditUsed: optionalAmount,
  })).max(500).optional(),
  /** El saldo de cada cuenta día a día. Llega entero; el primer trozo sustituye al anterior. */
  bankBalances: z.array(z.object({
    companyCode: z.number().int(),
    accountCode: z.string().trim().min(1).max(40),
    day,
    balance: amount.default(0),
    movement: amount.default(0),
  })).max(20000).optional(),
  bankBalancesReplace: z.boolean().optional(),
});

/** Si el envío trae algo de pagos, que va a una función aparte. */
export function hasPaymentParts(body: SageIngestBody): boolean {
  return Boolean(body.companyDetails || body.suppliers || body.paymentRemittances || body.paymentItems || body.openItems
    || body.uninvoicedNotes || body.bankAccounts || body.bankBalances);
}

/** Lo que recibe `sage_ingest_payments`. */
export function toPaymentsPayload(body: SageIngestBody): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (body.companyDetails) {
    payload.company_details = body.companyDetails.map((row) => ({
      company_code: row.companyCode, nif: row.nif, address: row.address, postal_code: row.postalCode, city: row.city, province: row.province,
    }));
  }
  if (body.suppliers) {
    payload.suppliers = body.suppliers.map((row) => ({
      company_code: row.companyCode, code: row.code, name: row.name, trade_name: row.tradeName, nif: row.nif, address: row.address,
      postal_code: row.postalCode, city: row.city, province: row.province, country: row.country, phone: row.phone, email: row.email,
    }));
  }
  if (body.paymentRemittances) {
    payload.payment_remittances = body.paymentRemittances.map((row) => ({
      company_code: row.companyCode, number: row.number, remittance_date: row.remittanceDate, value_date: row.valueDate,
      bank_code: row.bankCode, remittance_type: row.remittanceType, csb_norm: row.csbNorm, total: row.total, effects: row.effects,
      provisional: row.provisional,
    }));
  }
  if (body.paymentItems) {
    payload.payment_items = body.paymentItems.map((row) => ({
      company_code: row.companyCode, remittance_number: row.remittanceNumber, movement_id: row.movementId, effect_number: row.effectNumber,
      supplier_code: row.supplierCode, invoice_number: row.invoiceNumber, invoice_date: row.invoiceDate, due_date: row.dueDate,
      amount: row.amount, pending: row.pending, iban: row.iban,
    }));
  }
  if (body.openItems) {
    payload.open_items = body.openItems.map((row) => ({
      company_code: row.companyCode, kind: row.kind, movement_id: row.movementId, counterpart_code: row.counterpartCode,
      invoice_number: row.invoiceNumber, invoice_date: row.invoiceDate, due_date: row.dueDate, amount: row.amount, pending: row.pending,
      remittance_number: row.remittanceNumber, bank_code: row.bankCode, effect_type: row.effectType, taken_on: body.takenOn ?? null,
      is_returned: row.isReturned, returned_on: row.returnedOn,
    }));
    payload.open_items_replace = body.openItemsReplace === true;
  }
  if (body.uninvoicedNotes) {
    payload.uninvoiced_notes = body.uninvoicedNotes.map((row) => ({
      company_code: row.companyCode, year: row.year, series: row.series, number: row.number, note_date: row.noteDate,
      customer_code: row.customerCode, rep_code: row.repCode, net_amount: row.netAmount, billing_period: row.billingPeriod,
      taken_on: body.takenOn ?? null,
    }));
    payload.uninvoiced_notes_replace = body.uninvoicedNotesReplace === true;
  }
  if (body.bankAccounts) {
    payload.bank_accounts = body.bankAccounts.map((row) => ({
      company_code: row.companyCode, account_code: row.accountCode, bank_code: row.bankCode, bank_name: row.bankName,
      description: row.description, iban: row.iban, credit_limit: row.creditLimit, credit_used: row.creditUsed,
    }));
  }
  if (body.bankBalances) {
    payload.bank_balances = body.bankBalances.map((row) => ({
      company_code: row.companyCode, account_code: row.accountCode, day: row.day, balance: row.balance, movement: row.movement,
    }));
    payload.bank_balances_replace = body.bankBalancesReplace === true;
  }
  return payload;
}

export type SageIngestBody = z.infer<typeof sageIngestSchema>;

/** Lo que recibe `sage_ingest`: los nombres de las columnas de la base de datos. */
export function toDatabasePayload(body: SageIngestBody): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    covered_from: body.coveredFrom,
    covered_to: body.coveredTo,
    taken_on: body.takenOn ?? null,
    companies: body.companies.map((company) => ({ code: company.code, name: company.name, is_active: company.isActive })),
    reps: body.reps.map((rep) => ({
      company_code: rep.companyCode, code: rep.code, name: rep.name, is_person: rep.isPerson,
      is_manager: rep.isManager, manager_code: rep.managerCode, is_active: rep.isActive, left_on: rep.leftOn,
    })),
  };
  // Solo se añade lo que ha venido: una clave ausente le dice a la base de datos
  // que esa parte no se toque.
  if (body.sales) {
    payload.sales = body.sales.map((row) => ({
      company_code: row.companyCode,
      basis: row.basis,
      day: row.day,
      series: row.series,
      rep_code: row.repCode,
      documents: row.documents,
      net_amount: row.netAmount,
      cost_amount: row.costAmount,
      vat_amount: row.vatAmount,
      net_without_cost: row.netWithoutCost,
      lines: row.lines,
      gross_amount: row.grossAmount,
      line_discount_amount: row.lineDiscountAmount,
      rappel_amount: row.rappelAmount,
      commission_amount: row.commissionAmount,
    }));
  }
  const documents = (rows: z.infer<typeof documentRow>[]) => rows.map((row) => ({
    company_code: row.companyCode,
    day: row.day,
    series: row.series,
    rep_code: row.repCode,
    documents: row.documents,
    net_amount: row.netAmount,
  }));
  if (body.offers) payload.offers = documents(body.offers);
  if (body.orders) payload.orders = documents(body.orders);
  if (body.families) payload.families = body.families.map((family) => ({ company_code: family.companyCode, code: family.code, name: family.name }));
  if (body.subfamilies) {
    payload.subfamilies = body.subfamilies.map((row) => ({ company_code: row.companyCode, family_code: row.familyCode, code: row.code, name: row.name }));
  }
  if (body.familySales) {
    payload.family_sales = body.familySales.map((row) => ({
      company_code: row.companyCode,
      day: row.day,
      family_code: row.familyCode,
      units: row.units,
      net_amount: row.netAmount,
      cost_amount: row.costAmount,
      net_without_cost: row.netWithoutCost,
      gross_amount: row.grossAmount,
    }));
  }
  if (body.customers) {
    payload.customers = body.customers.map((row) => ({
      company_code: row.companyCode,
      month: row.month,
      active_customers: row.activeCustomers,
      new_customers: row.newCustomers,
    }));
  }
  if (body.backlog) payload.backlog = body.backlog.map((row) => ({ company_code: row.companyCode, rep_code: row.repCode, count: row.count, amount: row.amount }));
  if (body.dormant) payload.dormant = body.dormant.map((row) => ({ company_code: row.companyCode, count: row.count, amount: row.amount }));
  if (body.schema) payload.schema = body.schema.map((row) => ({ table_name: row.table, column_name: row.column, data_type: row.type }));
  if (body.customerList) {
    payload.customer_list = body.customerList.map((row) => ({
      company_code: row.companyCode,
      code: row.code,
      name: row.name,
      trade_name: row.tradeName,
      rep_code: row.repCode,
      province: row.province,
      municipality: row.municipality,
      postal_code: row.postalCode,
      activity: row.activity,
      customer_type: row.customerType,
      customer_group: row.customerGroup,
      phone: row.phone,
      email: row.email,
      created_on: row.createdOn,
      last_action_on: row.lastActionOn,
      leave_reason: row.leaveReason,
      left_on: row.leftOn,
      zone_code: row.zoneCode,
      channel_code: row.channelCode,
      sector_code: row.sectorCode,
      payment_method: row.paymentMethod,
      credit_limit: row.creditLimit,
      is_blocked: row.isBlocked,
    }));
  }
  if (body.customerDays) {
    payload.customer_days = body.customerDays.map((row) => ({
      company_code: row.companyCode,
      customer_code: row.customerCode,
      day: row.day,
      series: row.series,
      rep_code: row.repCode,
      documents: row.documents,
      lines: row.lines,
      net_amount: row.netAmount,
      cost_amount: row.costAmount,
      net_without_cost: row.netWithoutCost,
      gross_amount: row.grossAmount,
      line_discount_amount: row.lineDiscountAmount,
    }));
  }
  if (body.customerFamilies) {
    payload.customer_families = body.customerFamilies.map((row) => ({
      company_code: row.companyCode,
      customer_code: row.customerCode,
      month: row.month,
      family_code: row.familyCode,
      net_amount: row.netAmount,
      cost_amount: row.costAmount,
      net_without_cost: row.netWithoutCost,
      gross_amount: row.grossAmount,
    }));
  }
  if (body.articleList) {
    payload.article_list = body.articleList.map((row) => ({
      company_code: row.companyCode,
      code: row.code,
      name: row.name,
      family_code: row.familyCode,
      subfamily_code: row.subfamilyCode,
      brand: row.brand,
      supplier_code: row.supplierCode,
      manufacturer: row.manufacturer,
      abc: row.abc,
      created_on: row.createdOn,
      obsolete: row.obsolete,
    }));
  }
  if (body.articleSales) {
    payload.article_sales = body.articleSales.map((row) => ({
      company_code: row.companyCode,
      month: row.month,
      article_code: row.articleCode,
      family_code: row.familyCode,
      subfamily_code: row.subfamilyCode,
      units: row.units,
      documents: row.documents,
      net_amount: row.netAmount,
      cost_amount: row.costAmount,
      net_without_cost: row.netWithoutCost,
      gross_amount: row.grossAmount,
    }));
  }
  if (body.offerDocuments) {
    payload.offer_documents = body.offerDocuments.map((row) => ({
      company_code: row.companyCode,
      year: row.year,
      series: row.series,
      number: row.number,
      offer_date: row.offerDate,
      presented_on: row.presentedOn,
      valid_until: row.validUntil,
      expected_close: row.expectedClose,
      customer_code: row.customerCode,
      rep_code: row.repCode,
      status: row.status,
      probability: row.probability,
      reject_reason: row.rejectReason,
      loss_detail: row.lossDetail,
      net_amount: row.netAmount,
      lines: row.lines,
      ordered_amount: row.orderedAmount,
      first_order_on: row.firstOrderOn,
    }));
  }
  if (body.orderDocuments) {
    payload.order_documents = body.orderDocuments.map((row) => ({
      company_code: row.companyCode,
      year: row.year,
      series: row.series,
      number: row.number,
      order_date: row.orderDate,
      needed_on: row.neededOn,
      delivery_on: row.deliveryOn,
      customer_code: row.customerCode,
      rep_code: row.repCode,
      status: row.status,
      net_amount: row.netAmount,
      pending_amount: row.pendingAmount,
      lines: row.lines,
      from_offer: row.fromOffer,
      delivered_amount: row.deliveredAmount,
      first_delivery_on: row.firstDeliveryOn,
    }));
  }
  if (body.incidents) {
    payload.incidents = body.incidents.map((row) => ({
      company_code: row.companyCode,
      day: row.day,
      kind: row.kind,
      reason: row.reason,
      series: row.series,
      rep_code: row.repCode,
      documents: row.documents,
      net_amount: row.netAmount,
    }));
  }
  if (body.lookups) {
    payload.lookups = body.lookups.map((row) => ({ table_name: row.table, code: row.code, name: row.name, code_column: row.column }));
  }
  if (body.customerContacts) {
    payload.customer_contacts = body.customerContacts.map((row) => ({
      company_code: row.companyCode,
      customer_code: row.customerCode,
      position: row.position,
      name: row.name,
      role_code: row.roleCode,
      area_code: row.areaCode,
      phone: row.phone,
      phone2: row.phone2,
      phone3: row.phone3,
      email: row.email,
      is_commercial: row.isCommercial,
      is_admin: row.isAdmin,
      is_operational: row.isOperational,
    }));
    payload.customer_contacts_replace = body.customerContactsReplace === true;
  }
  return payload;
}

/** El resumen que queda apuntado en cada lectura, para saber qué llegó. */
export function describeIngest(body: SageIngestBody, counts: Record<string, number>): string {
  const parts = [`${body.companies.length} sociedades, ${body.reps.length} comerciales`];
  if (counts.sales !== undefined) parts.push(`${counts.sales} filas de venta`);
  const extra: [string, string][] = [
    ["offers", "de ofertas"],
    ["orders", "de pedidos"],
    ["family_sales", "por familia"],
    ["customers", "de clientes por mes"],
    ["backlog", "de cartera de pedidos"],
    ["dormant", "de clientes dormidos"],
    ["schema", "columnas de estructura"],
    ["customer_list", "clientes"],
    ["customer_days", "de compras por cliente"],
    ["customer_families", "de familias por cliente"],
    ["article_list", "artículos"],
    ["article_sales", "de venta por artículo"],
    ["subfamilies", "subfamilias"],
    ["offer_documents", "ofertas una a una"],
    ["order_documents", "pedidos uno a uno"],
    ["incidents", "de abonos e incidencias"],
    ["lookups", "códigos de Sage"],
    ["customer_contacts", "contactos de clientes"],
    ["company_details", "sociedades con NIF"],
    ["suppliers", "proveedores"],
    ["payment_remittances", "remesas de pagos"],
    ["payment_items", "efectos en remesas"],
    ["open_items", "de cartera pendiente"],
    ["uninvoiced_notes", "albaranes sin facturar"],
    ["bank_accounts", "cuentas de banco"],
    ["bank_balances", "saldos de banco"],
  ];
  for (const [key, label] of extra) {
    if (counts[key] !== undefined) parts.push(`${counts[key]} ${label}`);
  }
  const notes = body.notes?.filter(Boolean) ?? [];
  const text = `${parts.join(", ")}.${notes.length ? ` Avisos del agente: ${notes.join(" | ")}` : ""}`;
  return text.slice(0, 2000);
}
