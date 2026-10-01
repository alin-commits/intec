import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { comparablePhone, leadFromFields, leadgenChanges, leadNotes, verifyMetaSignature } from "../src/lib/meta/leadgen.ts";

test("la firma de Meta: vale con el secreto bueno y con cualquiera de varios", () => {
  const body = JSON.stringify({ object: "page", entry: [] });
  const firma = `sha256=${createHmac("sha256", "secreto-2").update(body).digest("hex")}`;
  assert.equal(verifyMetaSignature(body, firma, ["secreto-1", "secreto-2"]), true);
  assert.equal(verifyMetaSignature(body, firma, ["otro"]), false);
  assert.equal(verifyMetaSignature(`${body} `, firma, ["secreto-2"]), false, "un cuerpo cambiado no vale");
  assert.equal(verifyMetaSignature(body, null, ["secreto-2"]), false);
  assert.equal(verifyMetaSignature(body, "sha1=abc", ["secreto-2"]), false);
});

test("los formularios que trae un aviso de Meta", () => {
  const payload = {
    object: "page",
    entry: [
      { id: "111", changes: [
        { field: "leadgen", value: { leadgen_id: 444, page_id: "111", form_id: "222", ad_id: "333", created_time: 1727700000 } },
        { field: "feed", value: { item: "status" } },
      ] },
      { id: "112", changes: [{ field: "leadgen", value: { leadgen_id: "555", page_id: "112" } }] },
    ],
  };
  assert.deepEqual(leadgenChanges(payload), [
    { leadgenId: "444", pageId: "111", formId: "222", adId: "333" },
    { leadgenId: "555", pageId: "112", formId: null, adId: null },
  ]);
  assert.deepEqual(leadgenChanges({}), []);
  assert.deepEqual(leadgenChanges(null), []);
});

test("un formulario de Meta se convierte en lead", () => {
  const draft = leadFromFields([
    { name: "full_name", values: ["Lucía Gómez"] },
    { name: "email", values: ["Lucia@Taller.ES "] },
    { name: "phone_number", values: ["+34600111222"] },
    { name: "city", values: ["Elche"] },
    { name: "province", values: ["Alicante"] },
    { name: "company_name", values: ["Talleres Gómez"] },
    { name: "¿qué_producto_le_interesa?", values: ["Chaleco refrigerante"] },
    { name: "¿cuántos_trabajadores_tiene?", values: ["25"] },
    { name: "vacía", values: [""] },
  ]);
  assert.equal(draft.contactName, "Lucía Gómez");
  assert.equal(draft.email, "lucia@taller.es");
  assert.equal(draft.phone, "+34600111222");
  assert.equal(draft.location, "Elche, Alicante");
  assert.equal(draft.company, "Talleres Gómez");
  assert.equal(draft.interest, "Chaleco refrigerante");
  assert.deepEqual(draft.extras, [
    { label: "¿Qué producto le interesa?", value: "Chaleco refrigerante" },
    { label: "¿Cuántos trabajadores tiene?", value: "25" },
  ]);
  // Sin nombre completo, se junta nombre y apellidos.
  assert.equal(leadFromFields([{ name: "first_name", values: ["Juan"] }, { name: "last_name", values: ["Pérez"] }]).contactName, "Juan Pérez");
  assert.equal(leadFromFields([]).contactName, null);
});

test("las observaciones dicen de dónde viene y lo que contestó", () => {
  const draft = leadFromFields([{ name: "full_name", values: ["Ana"] }, { name: "¿qué_necesitas?", values: ["Presupuesto"] }]);
  const notes = leadNotes(draft, { formName: "Preventa Blizztherm", adName: "Anuncio 1", platform: "ig", createdTime: "2026-09-30T08:15:00+0000" });
  assert.equal(notes, "Entró por Meta Ads: formulario «Preventa Blizztherm», anuncio «Anuncio 1», Instagram, el 30/09/2026, 10:15.\n¿Qué necesitas?: Presupuesto");
});

test("el teléfono se compara sin prefijos ni espacios", () => {
  assert.equal(comparablePhone("+34 600 111 222"), "600111222");
  assert.equal(comparablePhone("0034600111222"), "600111222");
  assert.equal(comparablePhone("600-11-12-22"), "600111222");
  assert.equal(comparablePhone("123"), null);
  assert.equal(comparablePhone(null), null);
});
