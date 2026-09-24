import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { decryptWithKey, encryptWithKey, parseVaultKey, safeEquals, VaultCryptoError, VAULT_ENCRYPTION_VERSION } from "../src/lib/security/vault-crypto.ts";

const key = randomBytes(32);
const otherKey = randomBytes(32);
const secret = "C0ntraseña-con-ñ-y-€-🔐";

test("encrypt → decrypt returns exactly the same secret", () => {
  const encrypted = encryptWithKey(key, secret, "password");
  assert.equal(decryptWithKey(key, encrypted, "password"), secret);
  assert.equal(encrypted.version, VAULT_ENCRYPTION_VERSION);
  // The secret must not be readable in the stored value.
  assert.ok(!Buffer.from(encrypted.ciphertext, "base64").toString("utf8").includes("C0ntraseña"));
});

test("the same secret encrypted twice never produces the same ciphertext", () => {
  const first = encryptWithKey(key, secret, "password");
  const second = encryptWithKey(key, secret, "password");
  assert.notEqual(first.ciphertext, second.ciphertext);
  assert.notEqual(first.iv, second.iv);
});

test("a tampered ciphertext, nonce or tag fails instead of returning garbage", () => {
  const encrypted = encryptWithKey(key, secret, "password");
  const flip = (value: string) => {
    const buffer = Buffer.from(value, "base64");
    buffer[0] ^= 0x01;
    return buffer.toString("base64");
  };
  assert.throws(() => decryptWithKey(key, { ...encrypted, ciphertext: flip(encrypted.ciphertext) }, "password"), VaultCryptoError);
  assert.throws(() => decryptWithKey(key, { ...encrypted, iv: flip(encrypted.iv) }, "password"), VaultCryptoError);
  assert.throws(() => decryptWithKey(key, { ...encrypted, tag: flip(encrypted.tag) }, "password"), VaultCryptoError);
});

test("the wrong key, the wrong field or an unknown version fail", () => {
  const encrypted = encryptWithKey(key, secret, "password");
  assert.throws(() => decryptWithKey(otherKey, encrypted, "password"), VaultCryptoError);
  // Notes ciphertext can never be read as if it were a password, and vice versa.
  assert.throws(() => decryptWithKey(key, encrypted, "notes"), VaultCryptoError);
  assert.throws(() => decryptWithKey(key, { ...encrypted, version: 99 }, "password"), VaultCryptoError);
});

test("truncated nonce or tag are rejected before decrypting", () => {
  const encrypted = encryptWithKey(key, secret, "password");
  assert.throws(() => decryptWithKey(key, { ...encrypted, iv: encrypted.iv.slice(0, 8) }, "password"), VaultCryptoError);
  assert.throws(() => decryptWithKey(key, { ...encrypted, tag: encrypted.tag.slice(0, 8) }, "password"), VaultCryptoError);
});

test("the key must be 256 bits, in base64 or hex", () => {
  assert.equal(parseVaultKey(key.toString("base64")).length, 32);
  assert.equal(parseVaultKey(key.toString("hex")).length, 32);
  assert.throws(() => parseVaultKey(undefined), VaultCryptoError);
  assert.throws(() => parseVaultKey(""), VaultCryptoError);
  assert.throws(() => parseVaultKey(randomBytes(16).toString("base64")), VaultCryptoError);
});

test("empty secrets are rejected and comparisons are length-safe", () => {
  assert.throws(() => encryptWithKey(key, "", "password"), VaultCryptoError);
  assert.ok(safeEquals("abc123", "abc123"));
  assert.ok(!safeEquals("abc123", "abc124"));
  assert.ok(!safeEquals("abc", "abcd"));
});
