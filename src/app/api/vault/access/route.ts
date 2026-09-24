import { NextResponse } from "next/server";
import { guardVault } from "@/lib/vault/server";
import type { AppRole } from "@/lib/types";

// Overview for vault admins: every folder, who can reach it and how many
// credentials that means for each person. Names and counts only, no secrets.
export async function GET() {
  const guard = await guardVault({ requireAdmin: true });
  if (!guard.ok) return guard.response;

  const [{ data: categories }, { data: entries }, { data: access }, { data: profiles }] = await Promise.all([
    guard.admin.from("vault_categories").select("id, name").order("name"),
    guard.admin.from("vault_entries").select("category_id, visibility").eq("is_active", true),
    guard.admin.from("vault_category_access").select("category_id, user_id"),
    guard.admin.from("profiles").select("id, full_name, email, roles, is_active").eq("is_active", true).order("full_name"),
  ]);

  const counts = new Map<string, number>();
  let personalCount = 0;
  let uncategorised = 0;
  for (const entry of entries ?? []) {
    if (entry.visibility === "personal") { personalCount++; continue; }
    if (!entry.category_id) { uncategorised++; continue; }
    counts.set(String(entry.category_id), (counts.get(String(entry.category_id)) ?? 0) + 1);
  }

  const accessByCategory = new Map<string, string[]>();
  for (const row of access ?? []) {
    const list = accessByCategory.get(String(row.category_id)) ?? [];
    list.push(String(row.user_id));
    accessByCategory.set(String(row.category_id), list);
  }

  const folders = (categories ?? []).map((category) => ({
    id: String(category.id),
    name: String(category.name),
    count: counts.get(String(category.id)) ?? 0,
    userIds: accessByCategory.get(String(category.id)) ?? [],
  }));

  const people = (profiles ?? []).map((profile) => {
    const roles = (profile.roles ?? []) as AppRole[];
    const isVaultAdmin = roles.includes("vault_admin");
    // A vault admin reaches every shared folder; everyone else only the open ones
    // plus those they were added to.
    const visible = folders.filter((folder) => isVaultAdmin || folder.userIds.length === 0 || folder.userIds.includes(String(profile.id)));
    return {
      id: String(profile.id),
      name: (profile.full_name as string | null) ?? (profile.email as string | null) ?? "Usuario",
      roles,
      isVaultAdmin,
      folderCount: visible.length,
      credentialCount: visible.reduce((sum, folder) => sum + folder.count, 0) + (isVaultAdmin ? uncategorised : uncategorised),
      restrictedFolders: folders.filter((folder) => folder.userIds.length > 0 && !folder.userIds.includes(String(profile.id)) && !isVaultAdmin).map((folder) => folder.name),
    };
  });

  return NextResponse.json(
    { folders, people, uncategorised, personalCount, totalShared: (entries ?? []).length - personalCount },
    { headers: { "Cache-Control": "no-store" } },
  );
}
