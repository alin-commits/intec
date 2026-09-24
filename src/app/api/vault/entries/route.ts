import { NextResponse } from "next/server";
import { encryptSecret, fingerprintSecret } from "@/lib/security/vault-key";
import { guardVault, logVault, passwordMetadata, vaultError } from "@/lib/vault/server";
import { createEntrySchema } from "@/lib/vault/validation";
import { mapVaultEntry, VAULT_ENTRY_COLUMNS } from "@/lib/vault/types";
import { sanitizeSearchTerm } from "@/lib/search-term";

const PAGE_SIZE = 100;
/** Tope del índice del buscador: por encima de esto se busca contra el servidor. */
const INDEX_LIMIT = 3000;

/** Lists the credentials this user may see. Never returns ciphertext or secrets. */
export async function GET(request: Request) {
  const guard = await guardVault();
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);

  // El buscador filtra en el navegador para que responda al instante. Para eso
  // necesita, una sola vez, la lista entera de lo que esta persona puede ver.
  // Si el gestor creciera por encima del tope, se avisa y se vuelve a buscar
  // contra el servidor, que es lento pero nunca se deja nada fuera.
  if (url.searchParams.get("index") === "1") {
    const { data, error } = await guard.supabase
      .from("vault_entries")
      .select(VAULT_ENTRY_COLUMNS)
      .eq("is_active", true)
      .order("name")
      .limit(INDEX_LIMIT);
    if (error) {
      console.error("No se pudo preparar el buscador:", error.message);
      return vaultError("No se pudo preparar el buscador.", 500, "forbidden");
    }
    await logVault(guard.admin, { userId: guard.userId, action: "ENTRY_LIST", metadata: { index: true, count: data?.length ?? 0 } });
    return NextResponse.json(
      { entries: (data ?? []).map((row) => mapVaultEntry(row as Record<string, unknown>)), complete: (data?.length ?? 0) < INDEX_LIMIT },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const term = sanitizeSearchTerm(url.searchParams.get("q") ?? "");
  // Una carpeta madre llega con la suya y las de sus subcarpetas, para que
  // enseñe todo lo que cuelga de ella y no solo lo suyo.
  const categoryIds = (url.searchParams.get("category") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => /^[0-9a-f-]{36}$/i.test(value));
  const visibility = url.searchParams.get("visibility");
  const page = Math.max(0, Number(url.searchParams.get("page") ?? 0) || 0);

  // Counting every row a second time is as expensive as listing them, so it is
  // only asked for when the total cannot be worked out from the folder counts.
  const onlyFavorites = url.searchParams.get("favorites") === "1";
  const uncategorised = url.searchParams.get("uncategorised") === "1";
  const onlyRecent = url.searchParams.get("recent") === "1";
  const needsExactCount = term.length >= 2 || visibility === "personal" || onlyFavorites;

  // "Recientes" son las que esta persona ha mostrado o copiado últimamente, y
  // salen del registro de auditoría. Hay que filtrar por ellas en la consulta:
  // si no, se pediría la primera página por orden alfabético y las recientes
  // que quedaran más allá no aparecerían.
  const recentQuery = guard.admin
    .from("vault_audit_log")
    .select("vault_entry_id")
    .eq("user_id", guard.userId)
    .in("action", ["PASSWORD_REVEAL", "PASSWORD_COPY"])
    .not("vault_entry_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(60);

  /** De más reciente a más antigua, sin repetir. */
  function lastUsed(rows: { vault_entry_id: unknown }[] | null): string[] {
    const list: string[] = [];
    for (const row of rows ?? []) {
      const entryId = String(row.vault_entry_id);
      if (!list.includes(entryId)) list.push(entryId);
      if (list.length >= 8) break;
    }
    return list;
  }

  // Solo cuando se piden las recientes hay que esperar a esta consulta antes de
  // montar la principal; el resto de las veces va en paralelo con las demás.
  const recentFirst = onlyRecent ? lastUsed((await recentQuery).data) : null;

  // Read with the user's own session: row level security applies, and the
  // ciphertext columns are not even granted to that role.
  let query = guard.supabase
    .from("vault_entries")
    .select(VAULT_ENTRY_COLUMNS, needsExactCount ? { count: "exact" } : undefined)
    .eq("is_active", true)
    .order("name")
    .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
  if (term.length >= 2) query = query.or(`name.ilike.%${term}%,username.ilike.%${term}%,url.ilike.%${term}%`);
  if (categoryIds.length === 1) query = query.eq("category_id", categoryIds[0]);
  else if (categoryIds.length > 1) query = query.in("category_id", categoryIds);
  if (visibility === "personal") query = query.eq("created_by", guard.userId);
  else if (visibility === "shared") query = query.eq("visibility", "shared");
  if (uncategorised) query = query.is("category_id", null);
  if (onlyFavorites) {
    const { data: favoriteIds } = await guard.supabase.from("vault_favorites").select("vault_entry_id").eq("user_id", guard.userId);
    query = query.in("id", (favoriteIds ?? []).map((row) => row.vault_entry_id));
  }
  if (recentFirst) query = query.in("id", recentFirst);

  const [{ data, error, count }, categories, folderCounts, favorites, recentLog] = await Promise.all([
    query,
    guard.supabase.from("vault_categories").select("id, name, description").order("sort_order"),
    // The database counts per folder and returns one row per folder, instead of
    // one row per credential just to add them up here.
    guard.supabase.rpc("vault_folder_counts"),
    guard.supabase.from("vault_favorites").select("vault_entry_id").eq("user_id", guard.userId),
    recentFirst ? Promise.resolve({ data: null }) : recentQuery,
  ]);
  const recent = recentFirst ?? lastUsed(recentLog.data);
  if (error) {
    console.error("No se pudieron listar las credenciales:", error.message);
    return vaultError("No se pudieron cargar las credenciales.", 500, "forbidden");
  }

  await logVault(guard.admin, { userId: guard.userId, action: "ENTRY_LIST", metadata: { count: data?.length ?? 0, page } });

  const counts = new Map<string, number>();
  let visibleTotal = 0;
  if (folderCounts.error) {
    // The counting function is not in the database yet: count the old way so the
    // folder tree keeps working while the migration is applied.
    const { data: everyVisible } = await guard.supabase.from("vault_entries").select("category_id").eq("is_active", true);
    for (const row of everyVisible ?? []) {
      const key = row.category_id ? String(row.category_id) : "none";
      counts.set(key, (counts.get(key) ?? 0) + 1);
      visibleTotal++;
    }
  } else {
    for (const row of (folderCounts.data ?? []) as { folder_id: string | null; folder_total: number }[]) {
      const key = row.folder_id ? String(row.folder_id) : "none";
      counts.set(key, Number(row.folder_total));
      visibleTotal += Number(row.folder_total);
    }
  }
  return NextResponse.json(
    {
      entries: (data ?? []).map((row) => mapVaultEntry(row as Record<string, unknown>)),
      categories: (categories.data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        count: counts.get(String(row.id)) ?? 0,
      })),
      uncategorised: counts.get("none") ?? 0,
      visibleTotal,
      favorites: (favorites.data ?? []).map((row) => String(row.vault_entry_id)),
      recent,
      total: onlyRecent
        ? recent.length
        : needsExactCount
        ? count ?? 0
        : uncategorised
          ? counts.get("none") ?? 0
          : categoryIds.length > 0
            ? categoryIds.reduce((sum, id) => sum + (counts.get(id) ?? 0), 0)
            : visibleTotal,
      page,
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
      // Los datos del banco solo tienen sentido en una ficha de banco.
      bank_details: input.entryType === "bank" ? input.bankDetails : null,
      tags: input.tags,
      created_by: guard.userId,
      encryption_version: password.version,
      ...passwordMetadata(input.password, fingerprintSecret(input.password)),
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
