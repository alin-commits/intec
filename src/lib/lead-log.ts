// El registro de un lead, el que nadie puede tocar: cuándo entró, lo que llegó
// de Meta, cada cambio de estado y las asignaciones automáticas.
// Sin imports, para que los tests de node lo carguen tal cual.

export type LeadLogKind = "entrada" | "meta" | "estado" | "asignacion";
export type LeadLogEntry = { id: string; at: string; kind: LeadLogKind; text: string };

/** Una línea de lead_log tal como viene de la base. */
export type LeadLogRow = { id: string; createdAt: string; kind: string; text: string };

/** Un cambio de estado de lead_status_history (lo que había antes del registro). */
export type LeadHistoryRow = { id: string; previousStatus: string | null; newStatus: string; changedAt: string; changedByName?: string | null };

/** Lo que tardó desde que entró, como lo escribe la base: "14 min", "3 h 5 min", "2 días y 4 h". */
export function elapsedLabel(fromIso: string, toIso: string): string {
  const seconds = Math.max(Math.floor((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 1000), 0);
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ${Math.floor((seconds % 3600) / 60)} min`;
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  return `${days} ${days === 1 ? "día" : "días"}${hours > 0 ? ` y ${hours} h` : ""}`;
}

/**
 * Junta todo en orden de tiempo. Desde que existe lead_log cada cambio de
 * estado queda en las dos tablas; de lead_status_history solo se cogen los que
 * no estén ya en el registro (los de antes), para no verlos repetidos.
 */
export function leadRecord(input: {
  createdAt: string;
  source?: string | null;
  log: LeadLogRow[];
  history: LeadHistoryRow[];
  statusLabel: (status: string) => string;
}): LeadLogEntry[] {
  const entries: LeadLogEntry[] = [{
    id: "entrada",
    at: input.createdAt,
    kind: "entrada",
    text: input.source?.trim() ? `Entró en la aplicación (fuente: ${input.source.trim()})` : "Entró en la aplicación",
  }];
  for (const row of input.log) {
    const kind: LeadLogKind = row.kind === "meta" || row.kind === "estado" || row.kind === "asignacion" ? row.kind : "estado";
    entries.push({ id: `log-${row.id}`, at: row.createdAt, kind, text: row.text });
  }
  const logged = input.log.filter((row) => row.kind === "estado").map((row) => new Date(row.createdAt).getTime());
  for (const change of input.history) {
    const at = new Date(change.changedAt).getTime();
    if (logged.some((time) => Math.abs(time - at) < 10_000)) continue;
    const parts = [
      `${change.previousStatus ? `${input.statusLabel(change.previousStatus)} → ` : ""}${input.statusLabel(change.newStatus)}`,
      `${elapsedLabel(input.createdAt, change.changedAt)} después de entrar`,
      change.changedByName?.trim() || null,
    ].filter(Boolean);
    entries.push({ id: `historial-${change.id}`, at: change.changedAt, kind: "estado", text: parts.join(" · ") });
  }
  const order: Record<LeadLogKind, number> = { entrada: 0, meta: 1, asignacion: 2, estado: 3 };
  return entries.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime() || order[a.kind] - order[b.kind]);
}

/** El registro en texto, para el CSV. */
export function leadRecordText(entries: LeadLogEntry[], formatWhen: (iso: string) => string): string {
  return entries.map((entry) => `${formatWhen(entry.at)} · ${entry.text.replace(/\n+/g, " · ")}`).join(" | ");
}
