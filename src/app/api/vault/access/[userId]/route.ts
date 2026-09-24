import { NextResponse } from "next/server";
import { z } from "zod";
import { guardVault, logVault, vaultError } from "@/lib/vault/server";
import type { AppRole } from "@/lib/types";

// What one person is in the vault: their type of user and which folders they
// reach. Only vault admins can change it, and every change goes to the audit log.

/** The only roles this panel touches; the rest of the person's roles stay as they are. */
const VAULT_MANAGED_ROLES = ["vault_admin", "employee"] as const;

const bodySchema = z.object({
  roles: z.array(z.enum(VAULT_MANAGED_ROLES)).max(2),
  folderIds: z.array(z.string().uuid()).max(500),
});

export async function PUT(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const guard = await guardVault({ requireAdmin: true });
  if (!guard.ok) return guard.response;
  const { userId } = await params;

  let body: z.infer<typeof bodySchema>;
  try {
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) return vaultError("Datos no válidos.", 400);
    body = parsed.data;
  } catch {
    return vaultError("No se pudo leer la solicitud.", 400);
  }

  const { data: target } = await guard.admin
    .from("profiles")
    .select("id, full_name, email, roles, is_active")
    .eq("id", userId)
    .maybeSingle();
  if (!target?.is_active) return vaultError("Esa persona no existe o está desactivada.", 404);

  const targetName = (target.full_name as string | null) ?? (target.email as string | null) ?? "Usuario";
  const currentRoles = (target.roles ?? []) as AppRole[];
  const wantsVaultAdmin = body.roles.includes("vault_admin");

  // Nobody can take away their own vault admin: that would lock them out of this
  // very panel, with no way back other than the database.
  if (userId === guard.userId && !wantsVaultAdmin && currentRoles.includes("vault_admin")) {
    return vaultError("No puedes quitarte a ti mismo el rol de administrador del gestor.", 400);
  }

  // ---------- Type of user ----------
  const keptRoles = currentRoles.filter((role) => !(VAULT_MANAGED_ROLES as readonly string[]).includes(role));
  const nextRoles = [...keptRoles, ...body.roles] as AppRole[];
  const rolesChanged =
    nextRoles.length !== currentRoles.length || nextRoles.some((role) => !currentRoles.includes(role));

  if (rolesChanged) {
    const { error } = await guard.admin.from("profiles").update({ roles: nextRoles }).eq("id", userId);
    if (error) {
      console.error("No se pudo cambiar el tipo de usuario:", error.message);
      return vaultError("No se pudo cambiar el tipo de usuario.", 500);
    }
    await logVault(guard.admin, {
      userId: guard.userId,
      action: "PERMISSION_ADD",
      entryName: `Tipo de usuario: ${targetName}`,
      metadata: { targetUserId: userId, before: currentRoles, after: nextRoles },
    });
  }

  // ---------- Folders ----------
  // A vault admin reaches everything, so there is nothing to adjust folder by folder.
  if (wantsVaultAdmin) {
    return NextResponse.json({ ok: true, roles: nextRoles, foldersTouched: 0 }, { headers: { "Cache-Control": "no-store" } });
  }

  const [{ data: categories }, { data: access }, { data: people }] = await Promise.all([
    guard.admin.from("vault_categories").select("id, name"),
    guard.admin.from("vault_category_access").select("category_id, user_id"),
    guard.admin.from("profiles").select("id, roles").eq("is_active", true),
  ]);

  const byCategory = new Map<string, string[]>();
  for (const row of access ?? []) {
    const key = String(row.category_id);
    byCategory.set(key, [...(byCategory.get(key) ?? []), String(row.user_id)]);
  }
  const wanted = new Set(body.folderIds);
  /** Everyone who is not a vault admin: the list a folder gets when it stops being open. */
  const othersWhenClosing = (people ?? [])
    .filter((person) => !((person.roles ?? []) as AppRole[]).includes("vault_admin") && String(person.id) !== userId)
    .map((person) => String(person.id));

  let touched = 0;
  for (const category of categories ?? []) {
    const id = String(category.id);
    const current = byCategory.get(id) ?? [];
    const isOpen = current.length === 0;
    const reaches = isOpen || current.includes(userId);
    const shouldReach = wanted.has(id);
    if (reaches === shouldReach) continue;

    if (shouldReach) {
      // The folder is restricted and this person was not on the list: add them.
      const { error } = await guard.admin
        .from("vault_category_access")
        .insert({ category_id: id, user_id: userId, created_by: guard.userId });
      if (error) {
        console.error("No se pudo dar acceso a la carpeta:", error.message);
        return vaultError(`No se pudo dar acceso a «${String(category.name)}».`, 500);
      }
    } else if (isOpen) {
      // Taking one person out of an open folder closes it: everyone else keeps
      // the access they had, which is what the list below writes down.
      const list = othersWhenClosing.length > 0 ? othersWhenClosing : [guard.userId];
      const { error } = await guard.admin
        .from("vault_category_access")
        .insert(list.map((person) => ({ category_id: id, user_id: person, created_by: guard.userId })));
      if (error) {
        console.error("No se pudo restringir la carpeta:", error.message);
        return vaultError(`No se pudo restringir «${String(category.name)}».`, 500);
      }
    } else {
      // Restricted folder: drop this person, but never leave the list empty, or
      // the folder would silently reopen to the whole team.
      if (current.filter((person) => person !== userId).length === 0) {
        const { error } = await guard.admin
          .from("vault_category_access")
          .insert({ category_id: id, user_id: guard.userId, created_by: guard.userId });
        if (error) {
          console.error("No se pudo mantener la carpeta restringida:", error.message);
          return vaultError(`No se pudo quitar el acceso a «${String(category.name)}».`, 500);
        }
      }
      const { error } = await guard.admin
        .from("vault_category_access")
        .delete()
        .eq("category_id", id)
        .eq("user_id", userId);
      if (error) {
        console.error("No se pudo quitar el acceso a la carpeta:", error.message);
        return vaultError(`No se pudo quitar el acceso a «${String(category.name)}».`, 500);
      }
    }
    touched++;
  }

  if (touched > 0) {
    await logVault(guard.admin, {
      userId: guard.userId,
      action: "PERMISSION_ADD",
      entryName: `Carpetas de ${targetName}`,
      metadata: { targetUserId: userId, folders: body.folderIds.length, changed: touched },
    });
  }

  return NextResponse.json({ ok: true, roles: nextRoles, foldersTouched: touched }, { headers: { "Cache-Control": "no-store" } });
}
