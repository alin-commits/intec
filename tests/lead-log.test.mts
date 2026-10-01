import { test } from "node:test";
import assert from "node:assert/strict";
import { elapsedLabel, leadRecord, leadRecordText } from "../src/lib/lead-log.ts";

const labels: Record<string, string> = { new: "Nuevo", contacted: "Contactado", offer_sent: "Oferta enviada" };
const statusLabel = (status: string) => labels[status] ?? status;

test("lo que tardó, como lo escribe la base", () => {
  const start = "2026-09-30T10:00:00Z";
  assert.equal(elapsedLabel(start, "2026-09-30T10:14:59Z"), "14 min");
  assert.equal(elapsedLabel(start, "2026-09-30T13:05:00Z"), "3 h 5 min");
  assert.equal(elapsedLabel(start, "2026-10-01T10:30:00Z"), "1 día");
  assert.equal(elapsedLabel(start, "2026-10-02T14:00:00Z"), "2 días y 4 h");
  // Un reloj desajustado no da tiempos negativos.
  assert.equal(elapsedLabel(start, "2026-09-30T09:00:00Z"), "0 min");
});

test("el registro junta entrada, Meta, asignación y estados en orden", () => {
  const createdAt = "2026-09-30T10:00:00+00:00";
  const entries = leadRecord({
    createdAt,
    source: "META ADS",
    statusLabel,
    log: [
      { id: "3", createdAt: "2026-09-30T10:20:00+00:00", kind: "estado", text: "Nuevo → Contactado · 20 min después de entrar · Pierre" },
      { id: "1", createdAt, kind: "meta", text: "Entró por Meta Ads: formulario «Preventa».\nProvincia: Madrid" },
      { id: "2", createdAt: "2026-09-30T10:00:00.120+00:00", kind: "asignacion", text: "Asignado solo por su campaña: Pierre" },
    ],
    history: [],
  });
  assert.deepEqual(entries.map((entry) => entry.kind), ["entrada", "meta", "asignacion", "estado"]);
  assert.equal(entries[0].text, "Entró en la aplicación (fuente: META ADS)");
});

test("los cambios de antes del registro salen del historial, sin repetir los nuevos", () => {
  const createdAt = "2026-09-01T08:00:00Z";
  const entries = leadRecord({
    createdAt,
    statusLabel,
    log: [{ id: "9", createdAt: "2026-10-01T09:00:00.400Z", kind: "estado", text: "Contactado → Oferta enviada · 30 días y 1 h después de entrar" }],
    history: [
      { id: "a", previousStatus: "new", newStatus: "contacted", changedAt: "2026-09-02T10:30:00Z", changedByName: "Ana" },
      // El mismo cambio que ya está en el registro (las dos tablas a la vez).
      { id: "b", previousStatus: "contacted", newStatus: "offer_sent", changedAt: "2026-10-01T09:00:00.390Z" },
    ],
  });
  assert.deepEqual(entries.map((entry) => entry.id), ["entrada", "historial-a", "log-9"]);
  assert.equal(entries[1].text, "Nuevo → Contactado · 1 día y 2 h después de entrar · Ana");
});

test("en el CSV, el registro va en una sola celda", () => {
  const text = leadRecordText([
    { id: "entrada", at: "2026-09-30T10:00:00Z", kind: "entrada", text: "Entró en la aplicación" },
    { id: "log-1", at: "2026-09-30T10:00:00Z", kind: "meta", text: "Entró por Meta Ads.\nProvincia: Madrid" },
  ], () => "30/09/2026 12:00");
  assert.equal(text, "30/09/2026 12:00 · Entró en la aplicación | 30/09/2026 12:00 · Entró por Meta Ads. · Provincia: Madrid");
});
