import { test } from "node:test";
import assert from "node:assert/strict";
import { asciiText, buildConfirmingFile, isValidIban, type ConfirmingBatch, type ConfirmingPayment } from "../src/lib/confirming.ts";

/** Lo que hay entre dos posiciones (contando desde 1, como en los diseños del banco). */
const at = (line: string, from: number, length: number) => line.slice(from - 1, from - 1 + length);

const supplier = (overrides: Partial<ConfirmingPayment> = {}): ConfirmingPayment => ({
  supplierCode: "400001",
  supplierName: "Ferretería Núñez S.L.",
  supplierNif: "B12345678",
  address: "C/ Mayor, 1",
  city: "Alcalá",
  postalCode: "28801",
  province: "Madrid",
  countryCode: "ES",
  email: "pagos@nunez.es",
  phone: "91 123 45 67",
  iban: "ES91 2100 0418 4502 0005 1332",
  invoiceNumber: "F-2026/101",
  invoiceDate: "2026-08-01",
  dueDate: "2026-10-17",
  amount: 1234.56,
  ...overrides,
});

const batch = (format: "aef" | "bbva", payments: ConfirmingPayment[], overrides: Partial<ConfirmingBatch> = {}): ConfirmingBatch => ({
  payer: { name: "Suministros Intec S.L.", nif: "B87654321", address: "Pol. Ind. Sur, 5", city: "Getafe", postalCode: "28906", province: "Madrid" },
  contract: { format, contract: format === "bbva" ? "12345678" : "CONF-0001", suffix: "001", chargeIban: "ES7921000813610123456789", modality: "pronto_pago" },
  remittanceDate: "2026-09-29",
  sendDate: "2026-09-29",
  fileReference: "REMESA 77",
  payments,
  ...overrides,
});

test("isValidIban comprueba el dígito de control", () => {
  assert.equal(isValidIban("ES91 2100 0418 4502 0005 1332"), true);
  assert.equal(isValidIban("ES7921000813610123456789"), true);
  assert.equal(isValidIban("ES9121000418450200051333"), false);
  assert.equal(isValidIban(""), false);
  assert.equal(isValidIban(null), false);
});

test("asciiText quita tildes, eñes y lo que el banco no admite", () => {
  assert.equal(asciiText("Ferretería Núñez, S.L. «nº 3»"), "FERRETERIA NUNEZ, S.L. N 3");
  assert.equal(asciiText("pagos@núñez.es", true), "pagos@nunez.es");
});

test("formato AEF (Sabadell, Bankinter): registros de 250 con cada campo en su sitio", () => {
  const result = buildConfirmingFile(batch("aef", [
    supplier(),
    supplier({ invoiceNumber: "F-2026/102", amount: 100 }),
    supplier({ supplierCode: "400002", supplierName: "Otro Proveedor SA", supplierNif: "A11111111", iban: "ES7921000813610123456789", amount: 50.5 }),
  ]));
  assert.deepEqual(result.errors, []);
  assert.ok(result.records.every((line) => line.length === 250));
  assert.deepEqual(result.records.map((line) => line[0]), ["1", "2", "3", "4", "5", "6", "6", "3", "4", "5", "6", "7"]);
  assert.ok(result.content.endsWith("\r\n"));

  const [cabecera, domicilio, proveedor, contacto, pago, factura] = result.records;
  assert.equal(at(cabecera, 2, 50).trim(), "SUMINISTROS INTEC S.L.");
  assert.equal(at(cabecera, 52, 15).trim(), "B87654321");
  assert.equal(at(cabecera, 67, 8), "        ");
  assert.equal(at(cabecera, 75, 8), "20260929");
  assert.equal(at(cabecera, 83, 20).trim(), "CONF-0001");
  assert.equal(at(cabecera, 103, 34).trim(), "ES7921000813610123456789");
  assert.equal(at(cabecera, 137, 3), "EUR");
  assert.equal(at(cabecera, 140, 1), "2");
  assert.equal(at(cabecera, 171, 2), "FU");
  assert.equal(at(domicilio, 107, 10).trim(), "28906");

  assert.equal(at(proveedor, 2, 70).trim(), "FERRETERIA NUNEZ S.L.");
  assert.equal(at(proveedor, 72, 20).trim(), "B12345678");
  assert.equal(at(proveedor, 92, 65).trim(), "C/ MAYOR, 1");
  assert.equal(at(proveedor, 157, 40).trim(), "ALCALA");
  assert.equal(at(proveedor, 197, 10).trim(), "28801");
  assert.equal(at(proveedor, 207, 2), "ES");
  assert.equal(at(contacto, 2, 50).trim(), "pagos@nunez.es");
  assert.equal(at(contacto, 102, 15).trim(), "911234567");
  assert.equal(at(pago, 2, 1), "T");
  assert.equal(at(pago, 3, 34).trim(), "ES9121000418450200051332");

  assert.equal(at(factura, 2, 20).trim(), "F-2026/101");
  assert.equal(at(factura, 22, 1), "+");
  assert.equal(at(factura, 23, 15), "000000000123456");
  assert.equal(at(factura, 38, 8), "20260801");
  assert.equal(at(factura, 46, 8), "20261017");
  assert.equal(at(factura, 54, 8), "        ");

  const totales = result.records.at(-1) ?? "";
  assert.equal(at(totales, 2, 12), "000000000002");
  assert.equal(at(totales, 14, 15), "000000000138506");
  assert.equal(result.total, 1385.06);
  assert.equal(result.suppliers, 2);
});

test("la fecha de cargo solo se escribe si se pide, con los días de aplazamiento", () => {
  const plain = buildConfirmingFile(batch("aef", [supplier()]));
  assert.equal(at(plain.records.find((line) => line[0] === "6") ?? "", 54, 8), "        ");
  const deferred = buildConfirmingFile(batch("aef", [supplier()], {
    contract: { format: "aef", contract: "X", chargeIban: null, modality: "pronto_pago", deferralDays: 90, writeChargeDate: true },
  }));
  assert.equal(at(deferred.records.find((line) => line[0] === "6") ?? "", 54, 8), "20270115");
});

test("formato BBVA: registros de 150, fechas DDMMAAAA y secuencia de datos", () => {
  const result = buildConfirmingFile(batch("bbva", [supplier(), supplier({ invoiceNumber: "AB-1", amount: -34.56 })]));
  assert.deepEqual(result.errors, []);
  assert.ok(result.records.every((line) => line.length === 150));
  const codes = result.records.map((line) => `${at(line, 1, 3)}/${at(line, 4, 3)}`);
  assert.deepEqual(codes, ["010/010", "020/010", "020/020", "020/030", "020/031", "030/010", "030/020", "030/021", "030/040", "030/050", "040/020", "040/020", "050/090", "050/099"]);
  result.records.forEach((line, index) => {
    assert.equal(at(line, 7, 25).trim(), "B87654321");
    assert.equal(at(line, 32, 3), "001");
    assert.equal(at(line, 35, 6), String(index + 1).padStart(6, "0"));
  });
  const [presentador, ordenante] = result.records;
  assert.equal(at(presentador, 41, 8), "29092026");
  assert.equal(at(presentador, 49, 4), "0182");
  assert.equal(at(ordenante, 49, 8), "29092026");
  assert.equal(at(ordenante, 57, 34).trim(), "ES7921000813610123456789");
  assert.equal(at(ordenante, 91, 8), "12345678");

  const beneficiario = result.records[5];
  assert.equal(at(beneficiario, 41, 25).trim(), "B12345678");
  assert.equal(at(beneficiario, 69, 60).trim(), "FERRETERIA NUNEZ S.L.");
  assert.equal(at(result.records[9], 41, 34).trim(), "ES9121000418450200051332");

  const abono = result.records[11];
  assert.equal(at(abono, 59, 20).trim(), "AB-1");
  assert.equal(at(abono, 79, 8), "01082026");
  assert.equal(at(abono, 87, 8), "17102026");
  assert.equal(at(abono, 95, 1), "-");
  assert.equal(at(abono, 96, 15), "000000000003456");
  assert.equal(at(abono, 111, 3), "EUR");

  const [totalOrdenante, totalFichero] = result.records.slice(-2);
  assert.equal(at(totalOrdenante, 41, 6), "000012");
  assert.equal(at(totalOrdenante, 47, 18), "000000000000123456");
  assert.equal(at(totalOrdenante, 65, 18), "000000000000003456");
  assert.equal(at(totalFichero, 41, 6), "000014");
});

test("lo que el banco rechazaría sale como error antes de generar", () => {
  const result = buildConfirmingFile(batch("aef", [
    supplier({ iban: "ES0000000000000000000000", email: null, postalCode: null }),
    supplier({ supplierNif: "", amount: 0 }),
  ], { contract: { format: "aef", contract: "", modality: "pronto_pago" } }));
  const text = result.errors.join("\n");
  assert.match(text, /contrato de confirming/);
  assert.match(text, /IBAN .* no es válido/);
  assert.match(text, /no tiene correo/);
  assert.match(text, /código postal/);
  assert.match(text, /falta el NIF/);
  assert.match(text, /importe es cero/);
});

test("un correo por defecto cubre a los proveedores sin correo en Sage", () => {
  const result = buildConfirmingFile(batch("aef", [supplier({ email: null })], {
    contract: { format: "aef", contract: "C1", modality: "pronto_pago", fallbackEmail: "administracion@intec.es" },
  }));
  assert.deepEqual(result.errors, []);
  assert.equal(at(result.records.find((line) => line[0] === "4") ?? "", 2, 50).trim(), "administracion@intec.es");
});

test("los abonos no pueden igualar a los pagos del mismo proveedor y vencimiento", () => {
  const result = buildConfirmingFile(batch("aef", [supplier({ amount: 100 }), supplier({ invoiceNumber: "AB", amount: -100 })]));
  assert.match(result.errors.join("\n"), /abonos que vencen el 2026-10-17 igualan o superan/);
});

test("BBVA: contrato de más de 8 caracteres y factura posterior a la remesa", () => {
  const result = buildConfirmingFile(batch("bbva", [supplier({ invoiceDate: "2026-09-30", dueDate: "2026-10-30" })], {
    contract: { format: "bbva", contract: "123456789", suffix: "1", chargeIban: "ES7921000813610123456789", modality: "pronto_pago" },
  }));
  const text = result.errors.join("\n");
  assert.match(text, /como mucho 8 caracteres/);
  assert.match(text, /posterior a la de la remesa/);
});
