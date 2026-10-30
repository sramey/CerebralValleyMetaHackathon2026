// Hygiene for anything that leaves the process as a file (ADR 0070): a saved world is JSON on
// disk, may be shared by URL, exported as a game and shown to a judge, so no key and no personal
// detail may reach it. Everything here is a pure string pass, so it is cheap to test.
//
// The world itself is model-written code, ids, titles and knob values: none of that is expected to
// carry a secret, and the patterns below are deliberately narrow so an honest mod is untouched. The
// belt-and-braces line is `envSecrets()`: whatever this process holds as a key is cut out verbatim,
// even if a build somehow wrote it into a string.

export const REDACTED = "[redacted]";

interface Rule { re: RegExp; to: string }

const RULES: readonly Rule[] = [
  // Model provider keys, the shapes the ones we use actually have.
  { re: /\bsk-[A-Za-z0-9_-]{12,}/g, to: REDACTED },
  { re: /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/g, to: `Bearer ${REDACTED}` },
  // A long unbroken hex run: an access token pasted into a prompt or a mod.
  { re: /\b[A-Fa-f0-9]{32,}\b/g, to: REDACTED },
  // An email address is the clearest personal detail a command can carry.
  { re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, to: REDACTED },
  // A home directory is a name, and a path on someone's machine: never useful in a shared world.
  { re: /[A-Za-z]:\\Users\\[^\\\s"']+/g, to: REDACTED },
  { re: /\/(?:home|Users)\/[A-Za-z0-9._-]+/g, to: REDACTED },
];

/** Redact anything secret-shaped in one string. */
export function scrubText(text: string, secrets: readonly string[] = envSecrets()): string {
  let out = text;
  for (const secret of secrets) {
    if (secret.length < 8 || !out.includes(secret)) continue;
    out = out.split(secret).join(REDACTED);
  }
  for (const rule of RULES) out = out.replace(rule.re, rule.to);
  return out;
}

/**
 * The values of every env var that looks like it holds a credential. Short values are skipped: they
 * would match ordinary words and mangle honest code.
 */
export function envSecrets(env: Record<string, string | undefined> = process.env): string[] {
  const out: string[] = [];
  for (const [name, value] of Object.entries(env)) {
    if (!value || value.length < 12) continue;
    if (!/(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(name)) continue;
    if (value.trim() !== value || value.length > 4096) continue;
    out.push(value);
  }
  return out;
}

const MAX_DEPTH = 12;

/**
 * The same value with every string scrubbed. Used on the whole world object right before it is
 * written, so a future field is covered without anyone remembering to call a scrubber.
 */
export function scrubWorld<T>(value: T, secrets: readonly string[] = envSecrets()): T {
  return scrubNode(value, secrets, 0) as T;
}

function scrubNode(value: unknown, secrets: readonly string[], depth: number): unknown {
  if (typeof value === "string") return scrubText(value, secrets);
  if (depth >= MAX_DEPTH || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => scrubNode(v, secrets, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = scrubNode(v, secrets, depth + 1);
  return out;
}
