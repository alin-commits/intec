// Shared types for the password vault. Nothing here ever holds a secret:
// passwords and notes only exist decrypted inside a single server response.

export type VaultVisibility = "shared" | "personal" | "restricted";

/** Datos propios de una ficha de banco. Nunca un secreto: el PIN va en la contraseña. */
export type VaultBankDetails = {
  bankName: string | null;
  bankCode: string | null;
  accountHolder: string | null;
  accountNumber: string | null;
  iban: string | null;
};
export type VaultEntryType = "plain" | "email" | "server" | "bank" | "other";

export type VaultEntrySummary = {
  id: string;
  name: string;
  url: string | null;
  username: string | null;
  hasNotes: boolean;
  categoryId: string | null;
  businessUnitId: string | null;
  visibility: VaultVisibility;
  entryType: VaultEntryType;
  tags: string[];
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  lastPasswordChangeAt: string;
  strength: "weak" | "fair" | "strong" | null;
  bankDetails: VaultBankDetails | null;
};

export type VaultCategory = { id: string; name: string; description: string | null };

export type VaultPermission = {
  userId: string;
  canView: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canManagePermissions: boolean;
};

export type VaultAuditAction =
  | "VAULT_OPEN"
  | "VAULT_UNLOCK_FAILED"
  | "ENTRY_LIST"
  | "ENTRY_VIEW"
  | "PASSWORD_REVEAL"
  | "PASSWORD_COPY"
  | "ENTRY_CREATE"
  | "ENTRY_UPDATE"
  | "ENTRY_DELETE"
  | "PERMISSION_ADD"
  | "PERMISSION_REMOVE"
  | "IMPORT";

/** Why the vault refused a request, so the UI can ask for the right thing. */
export type VaultDeniedReason = "signed_out" | "inactive" | "mfa_enrollment_required" | "mfa_required" | "locked" | "forbidden" | "not_configured" | "rate_limited";

export const VAULT_ENTRY_COLUMNS =
  "id, name, url, username, has_notes, category_id, business_unit_id, visibility, entry_type, tags, created_by, created_at, updated_at, last_password_change_at, password_strength";

/** Un valor vacío se guarda como null, para que la ficha no muestre huecos raros. */
function mapBankDetails(row: Record<string, unknown>): VaultBankDetails {
  const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
  return {
    bankName: text(row.bankName),
    bankCode: text(row.bankCode),
    accountHolder: text(row.accountHolder),
    accountNumber: text(row.accountNumber),
    iban: text(row.iban),
  };
}

/**
 * `bank_details` no viaja en el listado: esa columna solo la lee el servidor al
 * abrir una ficha, porque el permiso de lectura de la tabla se da columna a
 * columna y la lista se consulta con la sesión de cada persona.
 */
export function mapVaultEntry(row: Record<string, unknown>): VaultEntrySummary {
  return {
    id: String(row.id),
    name: String(row.name),
    url: row.url ? String(row.url) : null,
    username: row.username ? String(row.username) : null,
    hasNotes: Boolean(row.has_notes),
    categoryId: row.category_id ? String(row.category_id) : null,
    businessUnitId: row.business_unit_id ? String(row.business_unit_id) : null,
    visibility: row.visibility as VaultVisibility,
    entryType: row.entry_type as VaultEntryType,
    tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
    createdBy: row.created_by ? String(row.created_by) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    lastPasswordChangeAt: String(row.last_password_change_at),
    strength: (row.password_strength as "weak" | "fair" | "strong" | null) ?? null,
    bankDetails: row.bank_details ? mapBankDetails(row.bank_details as Record<string, unknown>) : null,
  };
}
