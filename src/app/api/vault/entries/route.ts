import { NextResponse } from "next/server";
import { encryptSecret } from "@/lib/security/vault-key";
import { guardVault, logVault, vaultError } from "@/lib/vault/server";
import { createEntrySchema } from "@/lib/vault/validation";
import { mapVaultEntry, VAULT_ENTRY_COLUMNS } from "@/lib/vault/types";
import { sanitizeSearchTerm } from "@/lib/search-term";

const PAGE_SIZE = 100;

/** Lists the credentials this user may see. Never returns ciphertext or secrets. */
export async function GET(request: Request) {
  const guard = await guardVault();
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const term = sanitizeSearchTerm(url.searchParams.get("q") ?? "");
  const category = url.searchParams.get("category");
  const visibility = url.searchParams.get("visibility");
  const page = Math.max(0, Number(url.searchParams.get("page") ?? 0) || 0);

  // Read with the user's own session: row level security applies, and the
  // ciphertext columns are not even granted to that role.
  let query = guard.supabase
    .from("vault_entries")
    .select(VAULT_ENTRY_COLUMNS, { count: "exact" })
    .eq("is_active", true)
    .order("name")
    .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
  if (term.length >= 2) query = query.or(`name.ilike.%${term}%,username.ilike.%${term}%,url.ilike.%${term}%`);
  if (category) query = query.eq("category_id", category);
  if (visibility === "personal") query = query.eq("created_by", guard.userId);
  else if (visibility === "shared") query = query.eq("visibility", "shared");

  const [{ data, error, count }, categories] = await Promise.all([
    query,
    guard.supabase.from("vault_categories").select("id, name, description").order("sort_order"),
  ]);
  if (error) {
    console.error("No se pudieron listar las credenciales:", error.message);
    return vaultError("No se pudieron cargar las credenciales.", 500, "forbidden");
  }

  await logVault(guard.admin, { userId: guard.userId, action: "ENTRY_LIST", metadata: { count: data?.length ?? 0, page } });

  return NextResponse.json(
    {
      entries: (data ?? []).map((row) => mapVaultEntry(row as Record<string, unknown>)),
      categories: (categories.data ?? []).map((row) => ({ id: row.id, name: row.name, description: row.description })),
      total: count ?? 0,
      pageSize: PAGE_SIZE,
      isVaultAdmin: guard.actor.isVaultAdmin,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/** Creates a credential. The password is encrypted here, never stored as typed. */
export async function POST(request: Request) {
  const guard = await guardVault();
  if (!guard.ok) return guard.response;

  let input;
  try {
    const parsed = createEntrySchema.safeParse(await request.json());
    if (!parsed.success) return vaultError(parsed.error.issues[0]?.message ?? "Revisa los datos.", 400, "forbidden");
    input = parsed.data;
  } catch {
    return vaultError("No se pudo leer la solicitud.", 400, "forbidden");
  }

  const password = encryptSecret(input.password, "password");
  const notes = input.notes ? encryptSecret(input.notes, "notes") : null;

  const { data, error } = await guard.admin
    .from("vault_entries")
    .insert({
      name: input.name,
      url: input.url,
      username: input.username,
      password_ciphertext: password.ciphertext,
      password_iv: password.iv,
      password_tag: password.tag,
      notes_ciphertext: notes?.ciphertext ?? null,
      notes_iv: notes?.iv ?? null,
      notes_tag: notes?.tag ?? null,
      category_id: input.categoryId,
      business_unit_id: input.businessUnitId,
      visibility: input.visibility,
      entry_type: input.entryType,
      tags: input.tags,
      created_by: guard.userId,
      encryption_version: password.version,
    })
    .select(VAULT_ENTRY_COLUMNS)
    .single();
  if (error || !data) {
    console.error("No se pudo crear la credencial:", error?.message);
    return vaultError("No se pudo guardar la credencial.", 500, "forbidden");
  }

  await logVault(guard.admin, { userId: guard.userId, action: "ENTRY_CREATE", entryId: data.id, entryName: input.name, metadata: { visibility: input.visibility } });
  return NextResponse.json({ entry: mapVaultEntry(data as Record<string, unknown>) }, { headers: { "Cache-Control": "no-store" } });
}
