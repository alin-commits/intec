import "server-only";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isVaultConfigured } from "@/lib/security/vault-key";
import { passwordStrength } from "@/lib/vault/password-generator";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { folderListAllows, type VaultActor, type VaultEntryAccess } from "@/lib/vault/authorization";
import type { VaultAuditAction, VaultDeniedReason, VaultPermission, VaultVisibility } from "@/lib/vault/types";
import type { AppRole } from "@/lib/types";

/** Reveal limits per user, so nobody can quietly drain the vault entry by entry. */
const REVEALS_PER_MINUTE = 20;
const REVEALS_PER_HOUR = 150;

type Guard =
  | { ok: true; supabase: SupabaseClient; admin: SupabaseClient; userId: string; roles: AppRole[]; actor: VaultActor }
  | { ok: false; response: NextResponse };

function deny(reason: VaultDeniedReason, message: string, status: number): { ok: false; response: NextResponse } {
  return { ok: false, response: NextResponse.json({ error: message, reason }, { status, headers: { "Cache-Control": "no-store" } }) };
}

/**
 * Every vault endpoint starts here: valid session and an active account.
 * `requireAdmin` additionally demands the vault_admin role.
 *
 * Showing or copying a password used to need the code of an authenticator app,
 * asked again every working day. Dirección decided on 29/09/2026 to drop it:
 * signing in is enough. What still protects each secret is the permission on
 * the entry, the reveal rate limit and the audit log.
 */
export async function guardVault(options: { requireAdmin?: boolean } = {}): Promise<Guard> {
  if (!isVaultConfigured()) {
    return deny("not_configured", "El gestor de contraseñas no está configurado. Avisa al administrador.", 503);
  }
  const supabase = await createClient();
  if (!supabase) return deny("not_configured", "Supabase no está configurado.", 503);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return deny("signed_out", "No autorizado.", 401);

  const { data: profile } = await supabase.from("profiles").select("roles, is_active").eq("id", user.id).maybeSingle();
  if (!profile?.is_active) return deny("inactive", "Tu cuenta está desactivada.", 403);
  const roles = (profile.roles ?? []) as AppRole[];

  const isVaultAdmin = roles.includes("vault_admin");
  if (options.requireAdmin && !isVaultAdmin) return deny("forbidden", "No tienes permiso para esta acción.", 403);

  const admin = createAdminClient();
  if (!admin) return deny("not_configured", "El sistema no está disponible.", 503);

  return { ok: true, supabase, admin, userId: user.id, roles, actor: { userId: user.id, isVaultAdmin } };
}

/** Never blocks the action it is recording, but a failure must be visible in the logs. */
export async function logVault(
  admin: SupabaseClient,
  entry: { userId: string; action: VaultAuditAction; entryId?: string | null; entryName?: string | null; metadata?: Record<string, unknown> },
): Promise<void> {
  const { error } = await admin.from("vault_audit_log").insert({
    user_id: entry.userId,
    vault_entry_id: entry.entryId ?? null,
    entry_name: entry.entryName ?? null,
    action: entry.action,
    metadata: entry.metadata ?? {},
  });
  if (error) console.error("No se pudo registrar la auditoría del gestor:", error.message);
}

/** Counts recent reveals for this user; the limit protects against mass extraction. */
export async function withinRevealLimit(admin: SupabaseClient, userId: string): Promise<boolean> {
  const since = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
  const query = (minutes: number) =>
    admin
      .from("vault_audit_log")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .in("action", ["PASSWORD_REVEAL", "PASSWORD_COPY"])
      .gte("created_at", since(minutes));
  const [lastMinute, lastHour] = await Promise.all([query(1), query(60)]);
  // A failure counting must not open the door, but it must not block work either:
  // only a clearly exceeded limit denies the request.
  return (lastMinute.count ?? 0) < REVEALS_PER_MINUTE && (lastHour.count ?? 0) < REVEALS_PER_HOUR;
}

/** Responses that carry a decrypted secret must never be stored anywhere. */
export function secretResponse(body: Record<string, unknown>): NextResponse {
  return NextResponse.json(body, {
    headers: { "Cache-Control": "no-store, no-cache, must-revalidate, private", Pragma: "no-cache" },
  });
}

/**
 * Loads an entry with the service role together with this user's grant on it.
 * Authorization is then decided in code — never by trusting the id in the URL,
 * which is what stops someone swapping one uuid for another.
 */
export async function loadEntryForActor(
  admin: SupabaseClient,
  entryId: string,
  userId: string,
): Promise<{ row: Record<string, unknown>; access: VaultEntryAccess; grant: VaultPermission | null } | null> {
  const [{ data: row }, { data: permission }] = await Promise.all([
    admin.from("vault_entries").select("*").eq("id", entryId).eq("is_active", true).maybeSingle(),
    admin.from("vault_permissions").select("user_id, can_view, can_edit, can_delete, can_manage_permissions").eq("vault_entry_id", entryId).eq("user_id", userId).maybeSingle(),
  ]);
  if (!row) return null;
  const categoryAllowed = await categoryAllowsUser(admin, (row.category_id as string | null) ?? null, userId);
  return {
    row: row as Record<string, unknown>,
    access: { createdBy: (row.created_by as string | null) ?? null, visibility: row.visibility as VaultVisibility, categoryAllowed },
    grant: permission
      ? {
        userId: String(permission.user_id),
        canView: Boolean(permission.can_view),
        canEdit: Boolean(permission.can_edit),
        canDelete: Boolean(permission.can_delete),
        canManagePermissions: Boolean(permission.can_manage_permissions),
      }
      : null,
  };
}

/**
 * Folders with an access list are only reachable by the people on it (vault
 * admins aside). La lista se hereda: restringir una carpeta madre restringe
 * también sus subcarpetas. Decide la carpeta más cercana que tenga lista (la
 * propia, o la primera de encima); antes solo se miraba la propia y las hijas
 * de una madre restringida seguían abiertas a todo el mundo.
 */
export async function categoryAllowsUser(admin: SupabaseClient, categoryId: string | null, userId: string): Promise<boolean> {
  if (!categoryId) return true;
  const [{ data: folders, error: foldersError }, { data: lists, error: listsError }] = await Promise.all([
    admin.from("vault_categories").select("id, parent_id"),
    admin.from("vault_category_access").select("category_id, user_id"),
  ]);
  // Si la consulta falla no se puede saber quién tiene acceso, y en la ruta que
  // descifra esta es la única comprobación de carpeta. Ante la duda, que no pase.
  if (foldersError || listsError) {
    console.error("No se pudo comprobar el acceso a la carpeta:", (foldersError ?? listsError)?.message);
    return false;
  }
  return folderListAllows(categoryId, userId, folders ?? [], lists ?? []);
}


/** What is stored alongside a password so the health check can work without secrets. */
export function passwordMetadata(plaintext: string, fingerprint: string): { password_fingerprint: string; password_strength: string } {
  return { password_fingerprint: fingerprint, password_strength: passwordStrength(plaintext).level };
}

export function vaultError(message: string, status: number, reason: VaultDeniedReason = "forbidden"): NextResponse {
  return NextResponse.json({ error: message, reason }, { status, headers: { "Cache-Control": "no-store" } });
}
