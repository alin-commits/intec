// AES-256-GCM for the password vault. Pure functions only (the key is passed in),
// so they can be unit tested; `vault-key.ts` is what reads the secret from the
// environment. Standard primitives from Node's crypto — nothing home-made.
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** Bumped only if the algorithm or key derivation changes, so old rows stay readable. */
export const VAULT_ENCRYPTION_VERSION = 1;

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12; // 96-bit nonce, the size recommended for GCM.
const TAG_BYTES = 16;

/** A field is bound to its ciphertext, so a notes blob can never be pasted into the password column. */
export type VaultField = "password" | "notes";

export type EncryptedValue = {
  ciphertext: string;
  iv: string;
  tag: string;
  version: number;
};

export class VaultCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultCryptoError";
  }
}

/** Reads a base64 (or hex) 256-bit key. Throws if it is the wrong size, never logs it. */
export function parseVaultKey(value: string | undefined): Buffer {
  if (!value || !value.trim()) throw new VaultCryptoError("Falta la clave de cifrado del gestor de contraseñas.");
  const trimmed = value.trim();
  const decoded = /^[0-9a-fA-F]{64}$/.test(trimmed) ? Buffer.from(trimmed, "hex") : Buffer.from(trimmed, "base64");
  if (decoded.length !== KEY_BYTES) {
    throw new VaultCryptoError(`La clave de cifrado debe tener ${KEY_BYTES} bytes (256 bits) en base64 o hexadecimal.`);
  }
  return decoded;
}

function aad(field: VaultField, version: number): Buffer {
  return Buffer.from(`intec-vault:v${version}:${field}`, "utf8");
}

/** Encrypts one secret. A fresh random nonce is generated for every call. */
export function encryptWithKey(key: Buffer, plaintext: string, field: VaultField): EncryptedValue {
  if (typeof plaintext !== "string" || plaintext.length === 0) throw new VaultCryptoError("No hay nada que cifrar.");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(aad(field, VAULT_ENCRYPTION_VERSION));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    version: VAULT_ENCRYPTION_VERSION,
  };
}

/**
 * Decrypts one secret. Fails loudly if the key, the nonce, the tag or the field
 * do not match: GCM authentication means tampered data is never returned as valid.
 */
export function decryptWithKey(key: Buffer, value: EncryptedValue, field: VaultField): string {
  const iv = Buffer.from(value.iv, "base64");
  const tag = Buffer.from(value.tag, "base64");
  if (iv.length !== IV_BYTES) throw new VaultCryptoError("El nonce almacenado no es válido.");
  if (tag.length !== TAG_BYTES) throw new VaultCryptoError("La etiqueta de autenticación no es válida.");
  if (value.version !== VAULT_ENCRYPTION_VERSION) throw new VaultCryptoError("Versión de cifrado no soportada.");
  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAAD(aad(field, value.version));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(Buffer.from(value.ciphertext, "base64")), decipher.final()]);
    return plaintext.toString("utf8");
  } catch {
    // The original error can leak details about the key material.
    throw new VaultCryptoError("No se pudo descifrar el dato: la clave o el contenido no son válidos.");
  }
}

/**
 * Keyed fingerprint of a password, so the app can say "these two entries share a
 * password" without storing anything readable. It is an HMAC under a key derived
 * from the master key: without that key the fingerprint cannot be reversed or
 * tested against a guessed password.
 */
export function passwordFingerprint(key: Buffer, plaintext: string): string {
  const fingerprintKey = createHmac("sha256", key).update("intec-vault-fingerprint-v1").digest();
  return createHmac("sha256", fingerprintKey).update(plaintext, "utf8").digest("base64url");
}

/** Constant-time comparison for secrets that are checked rather than decrypted. */
export function safeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
