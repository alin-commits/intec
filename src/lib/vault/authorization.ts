// Who may do what with a credential. Pure functions so they can be tested
// exhaustively: this is the code that stops one user reading another's secrets.
import type { VaultPermission, VaultVisibility } from "@/lib/vault/types";

export type VaultActor = {
  userId: string;
  /** Holds the vault_admin role. It never grants access to someone else's personal entries. */
  isVaultAdmin: boolean;
};

export type VaultEntryAccess = {
  createdBy: string | null;
  visibility: VaultVisibility;
};

/** The permission row for this actor on this entry, when there is one. */
type Grant = VaultPermission | null | undefined;

/** A grant only counts for the person it was given to, whatever the caller passes in. */
function grantFor(actor: VaultActor, grant: Grant): VaultPermission | null {
  return grant && grant.userId === actor.userId ? grant : null;
}

function isOwner(entry: VaultEntryAccess, actor: VaultActor): boolean {
  return entry.createdBy !== null && entry.createdBy === actor.userId;
}

/** A personal entry belongs to its owner only — not to vault admins, not to anybody else. */
function adminCanReach(entry: VaultEntryAccess, actor: VaultActor): boolean {
  return actor.isVaultAdmin && entry.visibility !== "personal";
}

export function canViewEntry(entry: VaultEntryAccess, actor: VaultActor, grant?: Grant): boolean {
  if (isOwner(entry, actor)) return true;
  if (entry.visibility === "personal") return false;
  if (entry.visibility === "shared") return true;
  return adminCanReach(entry, actor) || Boolean(grantFor(actor, grant)?.canView);
}

export function canEditEntry(entry: VaultEntryAccess, actor: VaultActor, grant?: Grant): boolean {
  if (isOwner(entry, actor)) return true;
  if (entry.visibility === "personal") return false;
  return adminCanReach(entry, actor) || Boolean(grantFor(actor, grant)?.canEdit);
}

export function canDeleteEntry(entry: VaultEntryAccess, actor: VaultActor, grant?: Grant): boolean {
  if (isOwner(entry, actor)) return true;
  if (entry.visibility === "personal") return false;
  return adminCanReach(entry, actor) || Boolean(grantFor(actor, grant)?.canDelete);
}

export function canManagePermissions(entry: VaultEntryAccess, actor: VaultActor, grant?: Grant): boolean {
  // Personal entries are not shared with anyone, so there is nothing to manage.
  if (entry.visibility === "personal") return false;
  if (isOwner(entry, actor)) return true;
  return adminCanReach(entry, actor) || Boolean(grantFor(actor, grant)?.canManagePermissions);
}

/**
 * Nobody may change their own access to an entry — that is what lets a person
 * quietly widen their own privileges. Vault admins grant access to others, and
 * every change is written to the audit log.
 */
export function canGrantTo(entry: VaultEntryAccess, actor: VaultActor, targetUserId: string, grant?: Grant): boolean {
  if (targetUserId === actor.userId) return false;
  return canManagePermissions(entry, actor, grant);
}
