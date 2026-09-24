import "server-only";
import { decryptWithKey, encryptWithKey, parseVaultKey, passwordFingerprint, type EncryptedValue, type VaultField } from "@/lib/security/vault-crypto";

// The master key lives only here, on the server, read from VAULT_ENCRYPTION_KEY.
// It is never sent to the browser, never logged and never stored in the database.
let cachedKey: Buffer | null = null;

function vaultKey(): Buffer {
  if (!cachedKey) cachedKey = parseVaultKey(process.env.VAULT_ENCRYPTION_KEY);
  return cachedKey;
}

/** True when the vault can operate; used to show a clear message instead of a crash. */
export function isVaultConfigured(): boolean {
  try {
    vaultKey();
    return true;
  } catch {
    return false;
  }
}

export function encryptSecret(plaintext: string, field: VaultField): EncryptedValue {
  return encryptWithKey(vaultKey(), plaintext, field);
}

export function decryptSecret(value: EncryptedValue, field: VaultField): string {
  return decryptWithKey(vaultKey(), value, field);
}

/** Keyed hash used only to spot reused passwords; it never leaves the server either. */
export function fingerprintSecret(plaintext: string): string {
  return passwordFingerprint(vaultKey(), plaintext);
}
