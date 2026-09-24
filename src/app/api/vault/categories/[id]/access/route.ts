import { NextResponse } from "next/server";
import { z } from "zod";
import { guardVault, logVault, vaultError } from "@/lib/vault/server";

// Who can reach a whole folder. An empty list means the folder is open to
// everyone with vault access; adding one person closes it to the rest.
// Only vault admins decide this, and every change is written to the audit log.

const bodySchema = z.object({ userIds: z.array(z.string().uuid()).max(200) });

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardVault({ requireAdmin: true });
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const [{ data: access }, { data: category }] = await Promise.all([
    guard.admin.from("vault_category_access").select("user_id").eq("category_id", id),
    guard.admin.from("vault_categories").select("id, name").eq("id", id).maybeSingle(),
  ]);
  if (!category) return vaultError("Esa carpeta no existe.", 404);

  return NextResponse.json(
    { category: { id: category.id, name: category.name }, userIds: (access ?? []).map((row) => String(row.user_id)) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardVault({ requireAdmin: true });
  if (!guard.ok) return guard.response;
  const { id } = await params;

  let userIds: string[];
  try {
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) return vaultError("Datos no válidos.", 400);
    userIds = [...new Set(parsed.data.userIds)];
  } catch {
    return vaultError("No se pudo leer la solicitud.", 400);
  }

  const { data: category } = await guard.admin.from("vault_categories").select("id, name").eq("id", id).maybeSingle();
  if (!category) return vaultError("Esa carpeta no existe.", 404);

  // A restricted folder must always keep someone who can reach it: whoever sets
  // the list is added, so nobody locks the whole team out by accident.
  if (userIds.length > 0 && !userIds.includes(guard.userId)) userIds.push(guard.userId);

  await guard.admin.from("vault_category_access").delete().eq("category_id", id);
  if (userIds.length > 0) {
    const { error } = await guard.admin
      .from("vault_category_access")
      .insert(userIds.map((userId) => ({ category_id: id, user_id: userId, created_by: guard.userId })));
    if (error) {
      console.error("No se pudo guardar el acceso a la carpeta:", error.message);
      return vaultError("No se pudo guardar el acceso a la carpeta.", 500);
    }
  }

  await logVault(guard.admin, {
    userId: guard.userId,
    action: userIds.length > 0 ? "PERMISSION_ADD" : "PERMISSION_REMOVE",
    entryName: `Carpeta: ${category.name}`,
    metadata: { categoryId: id, people: userIds.length, restricted: userIds.length > 0 },
  });
  return NextResponse.json({ ok: true, userIds }, { headers: { "Cache-Control": "no-store" } });
}
