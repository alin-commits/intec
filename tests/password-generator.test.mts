import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_GENERATOR, generatePassword, MAX_LENGTH, MIN_LENGTH, passwordStrength } from "../src/lib/vault/password-generator.ts";

test("the default password is 20 characters with all four kinds", () => {
  const password = generatePassword(DEFAULT_GENERATOR);
  assert.equal(password.length, 20);
  assert.match(password, /[a-z]/);
  assert.match(password, /[A-Z]/);
  assert.match(password, /[0-9]/);
  assert.match(password, /[^a-zA-Z0-9]/);
});

test("only the chosen kinds of character are used", () => {
  const digitsOnly = generatePassword({ length: 12, lowercase: false, uppercase: false, digits: true, symbols: false });
  assert.match(digitsOnly, /^[0-9]{12}$/);
  const noSymbols = generatePassword({ ...DEFAULT_GENERATOR, symbols: false });
  assert.match(noSymbols, /^[a-zA-Z0-9]+$/);
});

test("length is kept inside safe bounds", () => {
  assert.equal(generatePassword({ ...DEFAULT_GENERATOR, length: 2 }).length, MIN_LENGTH);
  assert.equal(generatePassword({ ...DEFAULT_GENERATOR, length: 500 }).length, MAX_LENGTH);
});

test("passwords do not repeat and are well shuffled", () => {
  const generated = new Set(Array.from({ length: 200 }, () => generatePassword(DEFAULT_GENERATOR)));
  assert.equal(generated.size, 200);
  // The guaranteed characters must not always land in the same position.
  const firstChars = new Set(Array.from({ length: 50 }, () => generatePassword(DEFAULT_GENERATOR)[0]));
  assert.ok(firstChars.size > 5, "el primer carácter debería variar");
});

test("with no options at all it still produces something usable", () => {
  const password = generatePassword({ length: 16, lowercase: false, uppercase: false, digits: false, symbols: false });
  assert.equal(password.length, 16);
  assert.match(password, /^[a-zA-Z0-9]+$/);
});

test("strength reflects length and variety", () => {
  assert.equal(passwordStrength("1234").level, "weak");
  assert.equal(passwordStrength("contraseña123").level, "fair");
  assert.equal(passwordStrength(generatePassword(DEFAULT_GENERATOR)).level, "strong");
});
