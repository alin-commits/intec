import { test } from "node:test";
import assert from "node:assert/strict";
import { describeIngest, sageIngestSchema, toDatabasePayload } from "../src/lib/sage-ingest.ts";
import {
  addMonths,
  familyMargin,
  invoiceComparisonAvailable,
  invoiceYears,
  lastCompleteMonth,
  latestSnapshot,
  trustedNewCustomersFrom,
  type SnapshotRow,
} from "../src/lib/sage-panel.ts";

/** Lo que manda hoy el agente antiguo que corre en el servidor de Sage. */
const oldAgentBody = {
  coveredFrom: "2026-09-26",
  coveredTo: "2026-09-28",
  companies: [{ code: 1, name: "SUMINISTROS INTEC, S.L.", isActive: true }],
  reps: [{ companyCode: 1, code: 5, name: "Sergio Almodóvar", isPerson: true }],
  sales: [
    { companyCode: 1, basis: "albaran", day: "2026-09-28", series: "CRE", repCode: 5, documents: 3, netAmount: 1500.25, costAmount: 1000, vatAmount: 315.05, netWithoutCost: 0 },
    { companyCode: 1, basis: "albaran", day: "2026-09-28", series: "TK", repCode: null, documents: 1, netAmount: -20, costAmount: -12, vatAmount: -4.2 },
  ],
};

test("el envío del agente antiguo sigue valiendo y no toca los datos nuevos", () => {
  const body = sageIngestSchema.parse(oldAgentBody);
  const payload = toDatabasePayload(body);
  // Sin estas claves, la base de datos no borra lo que ya haya de ellas.
  for (const key of ["offers", "orders", "families", "family_sales", "customers", "backlog", "dormant", "schema"]) {
    assert.equal(key in payload, false, `no debería mandar ${key}`);
  }
  const sales = payload.sales as { net_without_cost: number; rep_code: number | null }[];
  assert.equal(sales[1].net_without_cost, 0, "el agente antiguo no manda la venta sin coste");
  assert.equal(sales[1].rep_code, null);
});

test("el envío nuevo pasa todo, con los nombres de columna de la base de datos", () => {
  const body = sageIngestSchema.parse({
    ...oldAgentBody,
    takenOn: "2026-09-28",
    offers: [{ companyCode: 1, day: "2026-09-28", series: "OF", repCode: 5, documents: 4, netAmount: 8200 }],
    orders: [],
    families: [{ companyCode: 1, code: "COMP", name: "Compresores" }],
    familySales: [{ companyCode: 1, day: "2026-09-28", familyCode: "COMP", units: 2, netAmount: 1400, costAmount: 950 }],
    customers: [{ companyCode: 1, month: "2026-09-01", activeCustomers: 120, newCustomers: 7 }],
    backlog: [{ companyCode: 1, repCode: null, count: 3, amount: 4200 }],
    dormant: [{ companyCode: 1, count: 14, amount: 23000.5 }],
    schema: [{ table: "CarteraEfectos", column: "ImportePendiente", type: "decimal" }],
    notes: ["ofertas: faltan SerieOferta"],
  });
  const payload = toDatabasePayload(body);
  assert.deepEqual(payload.orders, [], "una lista vacía sí se manda: ese periodo no tiene pedidos");
  assert.deepEqual((payload.family_sales as object[])[0], {
    company_code: 1, day: "2026-09-28", family_code: "COMP", units: 2, net_amount: 1400, cost_amount: 950, net_without_cost: 0,
  });
  assert.deepEqual((payload.schema as object[])[0], { table_name: "CarteraEfectos", column_name: "ImportePendiente", data_type: "decimal" });
  assert.equal(payload.taken_on, "2026-09-28");
  const summary = describeIngest(body, { sales: 2, offers: 1, orders: 0 });
  assert.match(summary, /2 filas de venta, 1 de ofertas, 0 de pedidos/);
  assert.match(summary, /Avisos del agente: ofertas: faltan SerieOferta/);
});

test("los envíos parciales del agente nuevo no tocan las ventas", () => {
  // El envío de un mes y el anexo no llevan ventas: la base de datos no debe borrarlas.
  const body = sageIngestSchema.parse({
    coveredFrom: "2026-09-01",
    coveredTo: "2026-09-30",
    customerList: [{ companyCode: 1, code: "C0001", name: "TALLERES MARTÍNEZ, S.L.", tradeName: "", phone: " 961234567 ", createdOn: "2019-03-02" }],
    articleSales: [{ companyCode: 1, month: "2026-09-01", articleCode: "CMP-100", netAmount: 9800 }],
  });
  const payload = toDatabasePayload(body);
  assert.equal("sales" in payload, false);
  assert.deepEqual(payload.companies, []);
  const customer = (payload.customer_list as Record<string, unknown>[])[0];
  assert.equal(customer.trade_name, null, "un texto vacío se guarda como que falta");
  assert.equal(customer.phone, "961234567");
  assert.equal(customer.email, null);
  assert.deepEqual((payload.article_sales as object[])[0], {
    company_code: 1, month: "2026-09-01", article_code: "CMP-100", family_code: "", subfamily_code: "",
    units: 0, documents: 0, net_amount: 9800, cost_amount: 0, net_without_cost: 0,
  });
  assert.match(describeIngest(body, { customer_list: 1, article_sales: 1 }), /1 clientes, 1 de venta por artículo/);
});

test("ofertas y pedidos uno a uno llegan con su enlace y sus fechas", () => {
  const body = sageIngestSchema.parse({
    coveredFrom: "2026-09-26",
    coveredTo: "2026-09-28",
    offerDocuments: [{ companyCode: 1, year: 2026, series: "OF", number: 881, offerDate: "2026-09-28", status: 2, netAmount: 8200, orderedAmount: 8200, firstOrderOn: "2026-09-28" }],
    orderDocuments: [{ companyCode: 1, year: 2026, number: 1523, orderDate: "2026-09-28", neededOn: "2026-09-25", netAmount: 2500, pendingAmount: 1200, fromOffer: true }],
    incidents: [{ companyCode: 1, day: "2026-09-28", kind: "abono", reason: "02", documents: 1, netAmount: -340 }],
  });
  const payload = toDatabasePayload(body);
  const offer = (payload.offer_documents as Record<string, unknown>[])[0];
  assert.equal(offer.ordered_amount, 8200);
  assert.equal(offer.reject_reason, null);
  const order = (payload.order_documents as Record<string, unknown>[])[0];
  assert.equal(order.series, "", "sin serie va vacía, que es parte de la clave");
  assert.equal(order.needed_on, "2026-09-25");
  assert.equal(order.from_offer, true);
  assert.equal((payload.incidents as Record<string, unknown>[])[0].kind, "abono");
  const unknownKind = sageIngestSchema.safeParse({ coveredFrom: "2026-09-26", coveredTo: "2026-09-28", incidents: [{ companyCode: 1, day: "2026-09-28", kind: "queja", documents: 1, netAmount: 0 }] });
  assert.equal(unknownKind.success, false, "solo abonos e incidencias");
});

test("un hueco en la lista de ventas se rechaza en vez de guardarse a medias", () => {
  const result = sageIngestSchema.safeParse({ ...oldAgentBody, sales: [...oldAgentBody.sales, null] });
  assert.equal(result.success, false);
});

test("un mes de clientes tiene que ser el día 1", () => {
  const result = sageIngestSchema.safeParse({
    ...oldAgentBody,
    customers: [{ companyCode: 1, month: "2026-09-15", activeCustomers: 1, newCustomers: 0 }],
  });
  assert.equal(result.success, false);
});

test("por fecha de factura no se compara con años sin fechas de factura", () => {
  assert.equal(invoiceComparisonAvailable(2026), false, "2025 solo tiene factura desde octubre");
  assert.equal(invoiceComparisonAvailable(2027), true);
  assert.deepEqual(invoiceYears([2026, 2025, 2024, 2023]), [2026, 2025]);
});

test("los clientes nuevos cuentan desde que hay un año de historia", () => {
  assert.equal(trustedNewCustomersFrom("2022-11-01"), "2023-11");
  assert.equal(trustedNewCustomersFrom(null), null);
  assert.equal(addMonths("2025-12", 1), "2026-01");
  assert.equal(addMonths("2026-01", -1), "2025-12");
});

test("el último mes entero del año", () => {
  const today = new Date(2026, 8, 28);
  assert.equal(lastCompleteMonth(2026, today), "2026-08");
  assert.equal(lastCompleteMonth(2025, today), "2025-12");
  assert.equal(lastCompleteMonth(2027, today), null);
  assert.equal(lastCompleteMonth(2026, new Date(2026, 0, 10)), null, "en enero aún no hay ningún mes entero");
});

test("de las fotos del día se usa solo la más reciente", () => {
  const rows: SnapshotRow[] = [
    { taken_on: "2026-09-27", company_code: 1, metric: "pedidos_pendientes", rep_code: 5, count: 9, amount: 9000 },
    { taken_on: "2026-09-28", company_code: 1, metric: "pedidos_pendientes", rep_code: 5, count: 2, amount: 900 },
    { taken_on: "2026-09-28", company_code: 1, metric: "pedidos_pendientes", rep_code: null, count: 3, amount: 4200 },
    { taken_on: "2026-09-29", company_code: 1, metric: "clientes_dormidos", rep_code: null, count: 14, amount: 23000 },
  ];
  const backlog = latestSnapshot(rows, "pedidos_pendientes");
  assert.equal(backlog.takenOn, "2026-09-28");
  assert.equal(backlog.rows.length, 2);
  assert.equal(latestSnapshot([], "clientes_dormidos").takenOn, null);
});

test("el margen por familia deja fuera lo que no tiene coste", () => {
  // 1.000 € de venta, 200 € sin coste: el margen se mide sobre 800 € con 600 € de coste.
  assert.equal(familyMargin({ trusted_net: 1000, trusted_cost: 600, trusted_without_cost: 200 }), 25);
  assert.equal(familyMargin({ trusted_net: 1000, trusted_cost: 0, trusted_without_cost: 1000 }), null, "sin coste no hay margen, no un 100 %");
  assert.equal(familyMargin({ trusted_net: 0, trusted_cost: 0, trusted_without_cost: 0 }), null);
});
