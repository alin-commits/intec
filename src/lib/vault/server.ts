import "server-only";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isVaultConfigured } from "@/lib/security/vault-key";
import { passwordStrength } from "@/lib/vault/password-generator";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { VaultActor, VaultEntryAccess } from "@/lib/vault/authorization";
import type { VaultAuditAction, VaultDeniedReason, VaultPermission, VaultVisibility } from "@/lib/vault/types";
import type { AppRole } from "@/lib/types";

/**
 * Showing or copying a password needs the app code, and that unlock lasts a
 * working day; everything else only needs a normal signed-in session.
 */
export const VAULT_UNLOCK_MINUTES = 8 * 60;
/** Reveal limits per user, so nobody can quietly drain the vault entry by entry. */
const REVEALS_PER_MINUTE = 20;
const REVEALS_PER_HOUR = 150;

type Guard =
  | { ok: true; supabase: SupabaseClient; admin: SupabaseClient; userId: string; roles: AppRole[]; actor: VaultActor }
  | { ok: false; response: NextResponse };

function deny(reason: VaultDeniedReason, message: string, status: number): { ok: false; response: NextResponse } {
  return { ok: false, response: NextResponse.json({ error: message, reason }, { status, headers: { "Cache-Control": "no-store" } }) };
}

/** Reads the `aal` and `amr` claims of the session's own access token (already verified by getUser). */
function readAuthClaims(accessToken: string | undefined): { aal: string | null; lastMfaAt: number | null } {
  if (!accessToken) return { aal: null, lastMfaAt: null };
  try {
    const payload = JSON.parse(Buffer.from(accessToken.split(".")[1], "base64").toString("utf8")) as {
      aal?: string;
      amr?: { method?: string; timestamp?: number }[];
    };
    const mfaTimestamps = (payload.amr ?? [])
      .filter((entry) => typeof entry.method === "string" && /totp|mfa|webauthn/i.test(entry.method))
      .map((entry) => (typeof entry.timestamp === "number" ? entry.timestamp : 0));
    return { aal: payload.aal ?? null, lastMfaAt: mfaTimestamps.length ? Math.max(...mfaTimestamps) : null };
  } catch {
    return { aal: null, lastMfaAt: null };
  }
}

/**
 * Every vault endpoint starts here: valid session and an active account. With
 * `requireMfa` it also demands a second factor confirmed within the unlock
 * window — that is what protects showing and copying a password.
 * `requireAdmin` additionally demands the vault_admin role.
 */
export async function guardVault(options: { requireMfa?: boolean; requireAdmin?: boolean } = {}): Promise<Guard> {
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

  if (options.requireMfa) {
    const { data: { session } } = await supabase.auth.getSession();
    const { aal, lastMfaAt } = readAuthClaims(session?.access_token);
    if (aal !== "aal2") {
      const { data: factors } = await supabase.auth.mfa.listFactors();
      const hasFactor = (factors?.totp ?? []).some((factor) => factor.status === "verified");
      return hasFactor
        ? deny("mfa_required", "Introduce el código de tu app de autenticación para ver la contraseña.", 403)
        : deny("mfa_enrollment_required", "Configura la verificación en dos pasos para poder ver contraseñas.", 403);
    }
    const freshEnough = lastMfaAt !== null && Date.now() / 1000 - lastMfaAt < VAULT_UNLOCK_MINUTES * 60;
    if (!freshEnough) return deny("locked", "Ha pasado la jornada desde tu último código. Vuelve a introducirlo.", 403);
  }

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

/** Folders with an access list are only reachable by the people on it (vault admins aside). */
export async function categoryAllowsUser(admin: SupabaseClient, categoryId: string | null, userId: string): Promise<boolean> {
  if (!categoryId) return true;
  const { data, error } = await admin.from("vault_category_access").select("user_id").eq("category_id", categoryId);
  // Si la consulta falla no se puede saber quién tiene acceso, y en la ruta que
  // descifra esta es la única comprobación de carpeta. Ante la duda, que no pase.
  if (error) {
    console.error("No se pudo comprobar el acceso a la carpeta:", error.message);
    return false;
  }
  if (!data || data.length === 0) return true;
  return data.some((row) => row.user_id === userId);
}

/** What is stored alongside a password so the health check can work without secrets. */
export function passwordMetadata(plaintext: string, fingerprint: string): { password_fingerprint: string; password_strength: string } {
  return { password_fingerprint: fingerprint, password_strength: passwordStrength(plaintext).level };
}

export function vaultError(message: string, status: number, reason: VaultDeniedReason = "forbidden"): NextResponse {
  return NextResponse.json({ error: message, reason }, { status, headers: { "Cache-Control": "no-store" } });
}
