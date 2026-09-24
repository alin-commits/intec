import { NextResponse } from "next/server";
import { guardVault, vaultError } from "@/lib/vault/server";

// Hygiene report for vault admins: reused, weak and stale passwords. It works
// from the stored fingerprint and strength, so no password is ever decrypted.
const STALE_YEARS = 2;

export async function GET() {
  const guard = await guardVault({ requireAdmin: true });
  if (!guard.ok) return guard.response;

  const { data, error } = await guard.admin
    .from("vault_entries")
    .select("id, name, category_id, password_fingerprint, password_strength, last_password_change_at, visibility")
    .eq("is_active", true);
  if (error) {
    console.error("No se pudo calcular la salud del gestor:", error.message);
    return vaultError("No se pudo calcular el estado del gestor.", 500);
  }
  const { data: categories } = await guard.admin.from("vault_categories").select("id, name");
  const categoryName = new Map((categories ?? []).map((row) => [String(row.id), String(row.name)]));

  type Row = { id: string; name: string; category_id: string | null; password_fingerprint: string | null; password_strength: string | null; last_password_change_at: string; visibility: string };
  const item = (row: Row) => ({ id: row.id, name: row.name, folder: row.category_id ? categoryName.get(String(row.category_id)) ?? "—" : "Sin carpeta" });

  // Personal entries belong to their owner: they are counted, never listed.
  const rows = ((data ?? []) as Row[]).filter((row) => row.visibility !== "personal");
  const personalCount = (data ?? []).length - rows.length;

  const byFingerprint = new Map<string, Row[]>();
  for (const row of rows) {
    if (!row.password_fingerprint) continue;
    const list = byFingerprint.get(row.password_fingerprint) ?? [];
    list.push(row);
    byFingerprint.set(row.password_fingerprint, list);
  }
  const reused = [...byFingerprint.values()]
    .filter((group) => group.length > 1)
    .sort((a, b) => b.length - a.length)
    .map((group) => ({ count: group.length, entries: group.map(item) }));

  const staleBefore = new Date();
  staleBefore.setFullYear(staleBefore.getFullYear() - STALE_YEARS);
  const stale = rows
    .filter((row) => new Date(row.last_password_change_at) < staleBefore)
    .sort((a, b) => a.last_password_change_at.localeCompare(b.last_password_change_at))
    .map((row) => ({ ...item(row), changedAt: row.last_password_change_at }));

  const weak = rows.filter((row) => row.password_strength === "weak").map(item);
  const fair = rows.filter((row) => row.password_strength === "fair").length;
  const strong = rows.filter((row) => row.password_strength === "strong").length;

  return NextResponse.json(
    {
      total: rows.length,
      personalCount,
      reused,
      reusedCount: reused.reduce((sum, group) => sum + group.count, 0),
      weak,
      fair,
      strong,
      stale,
      staleYears: STALE_YEARS,
      unknown: rows.filter((row) => !row.password_fingerprint).length,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
