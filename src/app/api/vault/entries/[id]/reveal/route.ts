import { decryptSecret } from "@/lib/security/vault-key";
import { canViewEntry } from "@/lib/vault/authorization";
import { guardVault, loadEntryForActor, logVault, secretResponse, vaultError, withinRevealLimit } from "@/lib/vault/server";
import { revealSchema } from "@/lib/vault/validation";

// The only endpoint in the whole app that returns a decrypted secret. It needs a
// valid session, the second factor confirmed within the day,
// permission on this exact entry, and it is always written to the audit log.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardVault({ requireMfa: true });
  if (!guard.ok) return guard.response;
  const { id } = await params;

  let input;
  try {
    const parsed = revealSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return vaultError("Petición no válida.", 400);
    input = parsed.data;
  } catch {
    return vaultError("No se pudo leer la solicitud.", 400);
  }

  if (!(await withinRevealLimit(guard.admin, guard.userId))) {
    await logVault(guard.admin, { userId: guard.userId, action: "VAULT_UNLOCK_FAILED", entryId: id, metadata: { reason: "rate_limit" } });
    return vaultError("Has consultado demasiadas contraseñas seguidas. Espera un momento.", 429, "rate_limited");
  }

  const found = await loadEntryForActor(guard.admin, id, guard.userId);
  // Same answer for "does not exist" and "not yours": changing the id in the URL tells you nothing.
  if (!found || !canViewEntry(found.access, guard.actor, found.grant)) {
    return vaultError("La credencial no existe o no tienes acceso.", 404);
  }

  const row = found.row;
  const isNotes = input.field === "notes";
  const ciphertext = isNotes ? (row.notes_ciphertext as string | null) : (row.password_ciphertext as string);
  const iv = isNotes ? (row.notes_iv as string | null) : (row.password_iv as string);
  const tag = isNotes ? (row.notes_tag as string | null) : (row.password_tag as string);
  if (!ciphertext || !iv || !tag) return vaultError("Esta credencial no tiene notas guardadas.", 404);

  let secret: string;
  try {
    secret = decryptSecret(
      { ciphertext, iv, tag, version: Number(row.encryption_version ?? 1) },
      isNotes ? "notes" : "password",
    );
  } catch (cause) {
    // Never surface the cryptographic detail to the browser.
    console.error("No se pudo descifrar una credencial:", cause instanceof Error ? cause.message : cause);
    return vaultError("No se pudo descifrar la credencial. Avisa al administrador.", 500, "not_configured");
  }

  await logVault(guard.admin, {
    userId: guard.userId,
    action: input.intent === "copy" ? "PASSWORD_COPY" : "PASSWORD_REVEAL",
    entryId: id,
    entryName: String(row.name),
    metadata: { field: input.field },
  });

  return secretResponse({ value: secret, field: input.field });
}
