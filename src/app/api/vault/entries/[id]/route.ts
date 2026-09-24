import { NextResponse } from "next/server";
import { encryptSecret, fingerprintSecret } from "@/lib/security/vault-key";
import { canDeleteEntry, canEditEntry, canManagePermissions, canViewEntry } from "@/lib/vault/authorization";
import { guardVault, loadEntryForActor, logVault, passwordMetadata, vaultError } from "@/lib/vault/server";
import { mapVaultEntry } from "@/lib/vault/types";
import { updateEntrySchema } from "@/lib/vault/validation";

const NOT_FOUND = "La credencial no existe o no tienes acceso.";

/** Detail of one credential: metadata only, never the password. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardVault();
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const found = await loadEntryForActor(guard.admin, id, guard.userId);
  // The same answer whether it does not exist or is not allowed: no hints.
  if (!found || !canViewEntry(found.access, guard.actor, found.grant)) {
    return vaultError(NOT_FOUND, 404, "forbidden");
  }

  const access = found.access;
  const mayManage = canManagePermissions(access, guard.actor, found.grant);
  const sharedWith = mayManage
    ? (await guard.admin.from("vault_permissions").select("user_id, can_view, can_edit, can_delete, can_manage_permissions").eq("vault_entry_id", id)).data ?? []
    : [];

  await logVault(guard.admin, { userId: guard.userId, action: "ENTRY_VIEW", entryId: id, entryName: String(found.row.name) });

  return NextResponse.json(
    {
      entry: mapVaultEntry(found.row),
      can: {
        edit: canEditEntry(access, guard.actor, found.grant),
        delete: canDeleteEntry(access, guard.actor, found.grant),
        managePermissions: mayManage,
      },
      sharedWith: sharedWith.map((row) => ({
        userId: String(row.user_id),
        canView: Boolean(row.can_view),
        canEdit: Boolean(row.can_edit),
        canDelete: Boolean(row.can_delete),
        canManagePermissions: Boolean(row.can_manage_permissions),
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/** Updates a credential. The stored password is only touched when a new one is sent. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardVault();
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const found = await loadEntryForActor(guard.admin, id, guard.userId);
  if (!found || !canViewEntry(found.access, guard.actor, found.grant)) {
    return vaultError(NOT_FOUND, 404, "forbidden");
  }
  const access = found.access;
  if (!canEditEntry(access, guard.actor, found.grant)) return vaultError("No puedes editar esta credencial.", 403);

  let input;
  try {
    const parsed = updateEntrySchema.safeParse(await request.json());
    if (!parsed.success) return vaultError(parsed.error.issues[0]?.message ?? "Revisa los datos.", 400);
    input = parsed.data;
  } catch {
    return vaultError("No se pudo leer la solicitud.", 400);
  }

  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.url !== undefined) patch.url = input.url;
  if (input.username !== undefined) patch.username = input.username;
  if (input.categoryId !== undefined) patch.category_id = input.categoryId;
  if (input.businessUnitId !== undefined) patch.business_unit_id = input.businessUnitId;
  if (input.entryType !== undefined) patch.entry_type = input.entryType;
  // Al dejar de ser una ficha de banco, sus datos bancarios se van con ella.
  if (input.entryType !== undefined && input.entryType !== "bank") patch.bank_details = null;
  else if (input.bankDetails !== undefined) patch.bank_details = input.bankDetails;
  if (input.tags !== undefined) patch.tags = input.tags;
  // Only the owner or a vault admin may change who can reach an entry.
  if (input.visibility !== undefined && input.visibility !== access.visibility) {
    if (!canManagePermissions(access, guard.actor, found.grant) && access.createdBy !== guard.userId) {
      return vaultError("No puedes cambiar la visibilidad de esta credencial.", 403);
    }
    patch.visibility = input.visibility;
  }
  if (input.notes !== undefined) {
    const notes = input.notes ? encryptSecret(input.notes, "notes") : null;
    patch.notes_ciphertext = notes?.ciphertext ?? null;
    patch.notes_iv = notes?.iv ?? null;
    patch.notes_tag = notes?.tag ?? null;
  }
  if (input.password !== undefined) {
    const password = encryptSecret(input.password, "password");
    patch.password_ciphertext = password.ciphertext;
    patch.password_iv = password.iv;
    patch.password_tag = password.tag;
    patch.encryption_version = password.version;
    patch.last_password_change_at = new Date().toISOString();
    Object.assign(patch, passwordMetadata(input.password, fingerprintSecret(input.password)));
  }
  if (Object.keys(patch).length === 0) return vaultError("No hay cambios que guardar.", 400);

  const { error } = await guard.admin.from("vault_entries").update(patch).eq("id", id);
  if (error) {
    console.error("No se pudo actualizar la credencial:", error.message);
    return vaultError("No se pudo guardar el cambio.", 500);
  }

  await logVault(guard.admin, {
    userId: guard.userId,
    action: "ENTRY_UPDATE",
    entryId: id,
    entryName: input.name ?? String(found.row.name),
    // Which fields changed, never their content.
    metadata: { fields: Object.keys(patch), passwordChanged: input.password !== undefined },
  });
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}

/** Soft delete: the row stays for the audit trail but disappears from the vault. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardVault();
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const found = await loadEntryForActor(guard.admin, id, guard.userId);
  if (!found || !canViewEntry(found.access, guard.actor, found.grant)) {
    return vaultError(NOT_FOUND, 404, "forbidden");
  }
  const access = found.access;
  if (!canDeleteEntry(access, guard.actor, found.grant)) return vaultError("No puedes eliminar esta credencial.", 403);

  const { error } = await guard.admin.from("vault_entries").update({ is_active: false }).eq("id", id);
  if (error) {
    console.error("No se pudo eliminar la credencial:", error.message);
    return vaultError("No se pudo eliminar la credencial.", 500);
  }

  await logVault(guard.admin, { userId: guard.userId, action: "ENTRY_DELETE", entryId: id, entryName: String(found.row.name) });
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
