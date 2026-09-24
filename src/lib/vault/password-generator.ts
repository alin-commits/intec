// Password generator. Uses the platform CSPRNG (crypto.getRandomValues) — never
// Math.random — and rejection sampling so every character is equally likely.

export type GeneratorOptions = {
  length: number;
  lowercase: boolean;
  uppercase: boolean;
  digits: boolean;
  symbols: boolean;
};

export const DEFAULT_GENERATOR: GeneratorOptions = { length: 20, lowercase: true, uppercase: true, digits: true, symbols: true };

const SETS = {
  lowercase: "abcdefghijkmnopqrstuvwxyz",
  uppercase: "ABCDEFGHJKLMNPQRSTUVWXYZ",
  digits: "23456789",
  // Kept to symbols that every website and terminal accepts.
  symbols: "!@#$%&*+-=?_",
} as const;

export const MIN_LENGTH = 8;
export const MAX_LENGTH = 64;

function randomIndex(limit: number): number {
  // Rejection sampling: taking a modulo of a random byte would favour low values.
  const max = Math.floor(256 / limit) * limit;
  const buffer = new Uint8Array(1);
  for (;;) {
    crypto.getRandomValues(buffer);
    if (buffer[0] < max) return buffer[0] % limit;
  }
}

/** Builds a password with at least one character from every chosen set. */
export function generatePassword(options: GeneratorOptions): string {
  const length = Math.min(MAX_LENGTH, Math.max(MIN_LENGTH, Math.round(options.length)));
  const chosen = (["lowercase", "uppercase", "digits", "symbols"] as const).filter((key) => options[key]);
  const sets = (chosen.length ? chosen : (["lowercase", "uppercase", "digits"] as const)).map((key) => SETS[key]);
  const alphabet = sets.join("");

  // One character per set first, so the result always satisfies the rules.
  const characters = sets.slice(0, length).map((set) => set[randomIndex(set.length)]);
  while (characters.length < length) characters.push(alphabet[randomIndex(alphabet.length)]);

  // Fisher-Yates so the guaranteed characters are not always at the front.
  for (let i = characters.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    [characters[i], characters[j]] = [characters[j], characters[i]];
  }
  return characters.join("");
}

/** Rough strength label for the UI. Not a security guarantee, just guidance. */
export function passwordStrength(value: string): { label: string; level: "weak" | "fair" | "strong" } {
  const variety = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((pattern) => pattern.test(value)).length;
  const score = value.length + variety * 4;
  if (value.length < 10 || score < 20) return { label: "Débil", level: "weak" };
  if (score < 28) return { label: "Aceptable", level: "fair" };
  return { label: "Fuerte", level: "strong" };
}
