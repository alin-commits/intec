import { NextResponse } from "next/server";
import { guardVault, vaultError } from "@/lib/vault/server";

const PAGE_SIZE = 100;

/** Audit trail of the vault. Only vault admins, and it never contains secrets. */
export async function GET(request: Request) {
  const guard = await guardVault({ requireAdmin: true });
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const page = Math.max(0, Number(url.searchParams.get("page") ?? 0) || 0);
  const action = url.searchParams.get("action");
  const userId = url.searchParams.get("user");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  let query = guard.admin
    .from("vault_audit_log")
    .select("id, user_id, vault_entry_id, entry_name, action, metadata, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
  if (action) query = query.eq("action", action);
  if (userId) query = query.eq("user_id", userId);
  if (from) query = query.gte("created_at", `${from}T00:00:00Z`);
  if (to) query = query.lte("created_at", `${to}T23:59:59Z`);

  const [{ data, error, count }, people] = await Promise.all([
    query,
    guard.admin.from("profiles").select("id, full_name").order("full_name"),
  ]);
  if (error) {
    console.error("No se pudo leer la auditoría del gestor:", error.message);
    return vaultError("No se pudo cargar la auditoría.", 500);
  }

  const names = new Map((people.data ?? []).map((row) => [row.id as string, (row.full_name as string | null) ?? "Usuario"]));
  return NextResponse.json(
    {
      events: (data ?? []).map((row) => ({
        id: row.id,
        userId: row.user_id,
        userName: row.user_id ? names.get(row.user_id as string) ?? "Usuario eliminado" : "—",
        entryId: row.vault_entry_id,
        entryName: row.entry_name,
        action: row.action,
        metadata: row.metadata,
        createdAt: row.created_at,
      })),
      people: (people.data ?? []).map((row) => ({ id: row.id, name: (row.full_name as string | null) ?? "Usuario" })),
      total: count ?? 0,
      pageSize: PAGE_SIZE,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
