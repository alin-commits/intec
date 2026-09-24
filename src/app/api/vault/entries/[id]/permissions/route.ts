import { NextResponse } from "next/server";
import { canGrantTo, canManagePermissions } from "@/lib/vault/authorization";
import { guardVault, loadEntryForActor, logVault, vaultError } from "@/lib/vault/server";
import { permissionSchema } from "@/lib/vault/validation";

const NOT_FOUND = "La credencial no existe o no tienes acceso.";

/** Grants or updates someone else's access to a restricted credential. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardVault();
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const found = await loadEntryForActor(guard.admin, id, guard.userId);
  if (!found) return vaultError(NOT_FOUND, 404);
  if (!canManagePermissions(found.access, guard.actor, found.grant)) return vaultError("No puedes gestionar el acceso a esta credencial.", 403);

  let input;
  try {
    const parsed = permissionSchema.safeParse(await request.json());
    if (!parsed.success) return vaultError(parsed.error.issues[0]?.message ?? "Datos no válidos.", 400);
    input = parsed.data;
  } catch {
    return vaultError("No se pudo leer la solicitud.", 400);
  }

  // Nobody widens their own access: that is the point of having an audit trail.
  if (!canGrantTo(found.access, guard.actor, input.userId, found.grant)) {
    return vaultError("No puedes cambiar tu propio acceso a una credencial.", 403);
  }

  const { data: target } = await guard.admin.from("profiles").select("id, full_name, is_active").eq("id", input.userId).maybeSingle();
  if (!target?.is_active) return vaultError("Ese usuario no existe o está desactivado.", 400);

  const { error } = await guard.admin.from("vault_permissions").upsert(
    {
      vault_entry_id: id,
      user_id: input.userId,
      can_view: input.canView,
      can_edit: input.canEdit,
      can_delete: input.canDelete,
      can_manage_permissions: input.canManagePermissions,
      created_by: guard.userId,
    },
    { onConflict: "vault_entry_id,user_id" },
  );
  if (error) {
    console.error("No se pudo conceder acceso:", error.message);
    return vaultError("No se pudo guardar el acceso.", 500);
  }

  await logVault(guard.admin, {
    userId: guard.userId,
    action: "PERMISSION_ADD",
    entryId: id,
    entryName: String(found.row.name),
    metadata: { targetUserId: input.userId, canEdit: input.canEdit, canDelete: input.canDelete, canManagePermissions: input.canManagePermissions },
  });
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}

/** Removes someone's access. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardVault();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const userId = new URL(request.url).searchParams.get("userId");
  if (!userId) return vaultError("Falta el usuario.", 400);

  const found = await loadEntryForActor(guard.admin, id, guard.userId);
  if (!found) return vaultError(NOT_FOUND, 404);
  if (!canManagePermissions(found.access, guard.actor, found.grant)) return vaultError("No puedes gestionar el acceso a esta credencial.", 403);

  const { error } = await guard.admin.from("vault_permissions").delete().eq("vault_entry_id", id).eq("user_id", userId);
  if (error) {
    console.error("No se pudo retirar el acceso:", error.message);
    return vaultError("No se pudo retirar el acceso.", 500);
  }

  await logVault(guard.admin, { userId: guard.userId, action: "PERMISSION_REMOVE", entryId: id, entryName: String(found.row.name), metadata: { targetUserId: userId } });
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
