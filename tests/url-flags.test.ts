import { describe, it, expect } from "vitest";
import {
  MAX_QUERY_LEN, decodeWorldId, defaultFlags, isWorldId, moodSlug, parseUrlFlags, parseVolume,
  shareIssueMessage, urlWithoutWorld,
} from "../src/client/url-flags";
import type { ShareIssue, UrlFlags } from "../src/client/url-flags";

// Deterministic fuzz: a seeded PRNG, so a failure is always reproducible (AGENTS: no Math.random).
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, xs: readonly T[]): T {
  return xs[Math.floor(rng() * xs.length) % xs.length];
}

// Everything a stranger can put in a URL: separators, percent-escapes, emoji, control bytes.
// Split by code point, so an emoji is never sliced into lone surrogates the fuzzer itself cannot encode.
const CHARS: readonly string[] = [
  ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_%=&#?. /\\:\"'<>[]{}|`~+*()!$^",
  "\n", "\r", "\t", "\0", "\u00e9", "\u4e2d", "\ud83d\ude00", "\ud83e\uddea",
];
const FLAG_NAMES = ["mute", "noshake", "coach", "nocoach", "tester", "vol", "mood", "w", "world", "worldId"];

function garbage(rng: () => number, maxLen: number): string {
  const n = Math.floor(rng() * maxLen);
  let out = "";
  for (let i = 0; i < n; i++) out += pick(rng, CHARS);
  return out;
}

/** A truncated real link can contain half an emoji; drop lone surrogates so the fuzzer itself can encode it. */
function enc(s: string): string {
  try { return encodeURIComponent(s); } catch { return encodeURIComponent(s.replace(/[\uD800-\uDFFF]/g, "")); }
}

/** Junk flags with random values, sometimes mangled beyond recognition. */
function junkQuery(rng: () => number): string {
  const n = 1 + Math.floor(rng() * 5);
  const parts: string[] = [];
  for (let i = 0; i < n; i++) {
    const name = pick(rng, FLAG_NAMES);
    const roll = rng();
    if (roll < 0.15) parts.push(name);
    else if (roll < 0.25) parts.push(`${name}=`);
    else if (roll < 0.5) parts.push(`${name}=${garbage(rng, 12)}`);
    else if (roll < 0.7) parts.push(`${name}=${enc(garbage(rng, 8))}`);
    else if (roll < 0.8) parts.push(`${name}=${"%".repeat(1 + Math.floor(rng() * 3))}`);
    else if (roll < 0.9) parts.push(garbage(rng, 10));
    else parts.push(`${name}=${name}=${name}`);
  }
  return parts.join(pick(rng, ["&", "&", "&&", "=", "#", ";"]));
}

/** Start from a healthy link, then corrupt it the ways real links get corrupted. */
function mangledLink(rng: () => number): string {
  let s = "w=" + "Ab3_-Z9xQ1pL";
  const mutations = 1 + Math.floor(rng() * 4);
  for (let i = 0; i < mutations; i++) {
    const at = Math.floor(rng() * (s.length + 1));
    const roll = rng();
    if (roll < 0.2) s = s.slice(0, at);
    else if (roll < 0.4) s = s.slice(0, at) + garbage(rng, 6) + s.slice(at);
    else if (roll < 0.55) s = s + "&" + junkQuery(rng);
    else if (roll < 0.7) s = "w=" + enc(s.slice(2));
    else if (roll < 0.85) s = "w=" + (rng() < 0.5 ? ".".repeat(Math.floor(rng() * 8)) : "");
    else s = s.replace("w=", pick(rng, ["world=", "worldId=", "W=", "w", "?w="]));
  }
  return s;
}

const ID_GRAMMAR = /^[A-Za-z0-9_-]{4,40}$/;
const MOOD_GRAMMAR = /^[a-z0-9-]{1,24}$/;
const ISSUES: readonly ShareIssue[] = ["empty", "oversized", "invalid", "legacy"];

/** Invariants that must hold for every possible input. */
function checkShape(flags: UrlFlags, input: string): void {
  for (const key of ["mute", "noShake", "coach", "noCoach", "tester"] as const) {
    expect(typeof flags[key], `${key} for ${JSON.stringify(input)}`).toBe("boolean");
  }
  if (flags.volume !== null) {
    expect(Number.isFinite(flags.volume)).toBe(true);
    expect(flags.volume).toBeGreaterThanOrEqual(0);
    expect(flags.volume).toBeLessThanOrEqual(1);
  }
  if (flags.mood !== null) expect(flags.mood).toMatch(MOOD_GRAMMAR);
  if (flags.worldId !== null) {
    expect(flags.worldId).toMatch(ID_GRAMMAR);
    expect(flags.shareIssue).toBeNull();
  }
  if (flags.shareIssue !== null) {
    expect(ISSUES).toContain(flags.shareIssue);
    expect(flags.worldId).toBeNull();
    expect(shareIssueMessage(flags.shareIssue)).toContain("Couldn't open that world");
  }
  for (const name of ["mute", "noshake", "coach", "nocoach", "tester", "vol", "mood", "w", "whatever"]) {
    expect(typeof flags.has(name), `has(${name}) for ${JSON.stringify(input)}`).toBe("boolean");
  }
  expect(flags.has("whatever")).toBe(false);
}

describe("parseUrlFlags: no query string", () => {
  it("gives quiet defaults, with nothing switched on", () => {
    for (const empty of ["", "?", null, undefined, 42, {}, [], "   "]) {
      const f = parseUrlFlags(empty as unknown);
      expect(f.mute).toBe(false);
      expect(f.noShake).toBe(false);
      expect(f.coach).toBe(false);
      expect(f.noCoach).toBe(false);
      expect(f.tester).toBe(false);
      expect(f.volume).toBeNull();
      expect(f.mood).toBeNull();
      expect(f.worldId).toBeNull();
      expect(f.shareIssue).toBeNull();
      expect(f.has("nocoach")).toBe(false);
    }
    expect(parseUrlFlags("????&&&==").shareIssue).toBeNull();
    expect(defaultFlags().worldId).toBeNull();
  });
});

describe("parseUrlFlags: boolean flags", () => {
  it("reads the documented flags by presence", () => {
    const f = parseUrlFlags("?mute&noshake&coach&nocoach&tester");
    expect(f.mute).toBe(true);
    expect(f.noShake).toBe(true);
    expect(f.coach).toBe(true);
    expect(f.noCoach).toBe(true);
    expect(f.tester).toBe(true);
    expect(f.has("mute")).toBe(true);
    expect(f.has("noshake")).toBe(true);
    expect(f.has("coach")).toBe(true);
    expect(f.has("nocoach")).toBe(true);
    expect(f.has("tester")).toBe(true);
  });

  it("lets an explicit falsey value switch a flag off", () => {
    for (const off of ["0", "false", "off", "no", " FALSE "]) {
      const f = parseUrlFlags(`?mute=${enc(off)}&nocoach=${enc(off)}`);
      expect(f.mute).toBe(false);
      expect(f.noCoach).toBe(false);
    }
    expect(parseUrlFlags("?mute=maybe").mute).toBe(true); // junk keeps the flag on, never throws
  });

  it("ignores unknown flags and extra junk params", () => {
    const f = parseUrlFlags("?nope=1&utm_source=x&w=Ab3_-Z9xQ1pL&nocoach&trace=%zz");
    expect(f.noCoach).toBe(true);
    expect(f.worldId).toBe("Ab3_-Z9xQ1pL");
    expect(f.shareIssue).toBeNull();
  });
});

describe("parseUrlFlags: volume", () => {
  it("clamps good values and ignores bad ones", () => {
    expect(parseUrlFlags("?vol=0.5").volume).toBe(0.5);
    expect(parseUrlFlags("?vol=.25").volume).toBe(0.25);
    expect(parseUrlFlags("?vol=2").volume).toBe(1);
    expect(parseUrlFlags("?vol=-3").volume).toBe(0);
    expect(parseUrlFlags("?vol=1e999").volume).toBeNull();
    expect(parseUrlFlags("?vol=abc").volume).toBeNull();
    expect(parseUrlFlags("?vol=0.5abc").volume).toBeNull();
    expect(parseUrlFlags("?vol=0x10").volume).toBeNull();
    expect(parseUrlFlags("?vol").volume).toBeNull();
    expect(parseUrlFlags("?vol=").volume).toBeNull();
    expect(parseUrlFlags("?vol=%20%20").volume).toBeNull();
    expect(parseVolume(undefined)).toBeNull();
    expect(parseVolume(0.4)).toBeNull(); // only strings from the URL
  });

  it("uses the last value when the flag repeats", () => {
    expect(parseUrlFlags("?vol=1&vol=0.2").volume).toBe(0.2);
  });
});

describe("parseUrlFlags: mood", () => {
  it("slugs a mood the way the server keys it", () => {
    expect(parseUrlFlags("?mood=Deep%20Winter!").mood).toBe("deep-winter");
    expect(parseUrlFlags("?mood=sunset").mood).toBe("sunset");
    expect(parseUrlFlags("?mood=").mood).toBeNull();
    expect(parseUrlFlags("?mood=%00%ff").mood).toBeNull();
    expect(parseUrlFlags(`?mood=${"a".repeat(500)}`).mood?.length).toBe(24);
    expect(moodSlug("---")).toBeNull();
    expect(moodSlug(null)).toBeNull();
  });
});

describe("share links", () => {
  it("accepts a current link", () => {
    const f = parseUrlFlags("?w=Ab3_-Z9xQ1pL");
    expect(f.worldId).toBe("Ab3_-Z9xQ1pL");
    expect(f.shareIssue).toBeNull();
    expect(isWorldId(f.worldId)).toBe(true);
  });

  it("reports truncated, corrupted, oversized and old links instead of guessing", () => {
    const cases: [string, ShareIssue][] = [
      ["?w=", "empty"],
      ["?w=%20%20", "empty"],
      ["?w=abc", "invalid"],                        // truncated id (ids are 12 chars now)
      ["?w=ab!def", "invalid"],
      ["?w=%zz", "invalid"],
      ["?w=abcdefghijkl%2", "invalid"],
      ["?w=" + "A".repeat(41), "invalid"],         // longer than any id can be, still short enough to read
      ["?w=" + "A".repeat(500), "oversized"],
      ["?w=" + "A".repeat(20_000), "oversized"],
      ["?w=Ab3_-Z9xQ1pL.json", "legacy"],           // old saved-file link shape
      ["?w=https%3A%2F%2Fgame%2F%3Fw%3DAb3_-Z9xQ1pL", "legacy"],
      ["?w=%23Ab3_-Z9xQ1pL", "legacy"],
      ["?w=w%3DAb3_-Z9xQ1pL", "legacy"],
      ["?world=Ab3_-Z9xQ1pL", "legacy"],            // old key
      ["?worldId=Ab3_-Z9xQ1pL", "legacy"],
      ["?utm=1#w=Ab3_-Z9xQ1pL", "legacy"],          // old hash fragment
      ["?utm=1#/w/Ab3_-Z9xQ1pL", "legacy"],         // old hash route
    ];
    for (const [search, issue] of cases) {
      const f = parseUrlFlags(search);
      expect(f.shareIssue, search).toBe(issue);
      expect(f.worldId, search).toBeNull();
      expect(shareIssueMessage(f.shareIssue!)).toContain("Couldn't open that world");
    }
  });

  it("refuses to look at a whole query far past any real link", () => {
    const f = parseUrlFlags("?mute&nocoach&" + "x=" + "y".repeat(MAX_QUERY_LEN));
    expect(f.shareIssue).toBe("oversized");
    expect(f.mute).toBe(false);
    expect(f.noCoach).toBe(false);
    expect(f.worldId).toBeNull();
  });

  it("decodes raw ids the same way the parser does", () => {
    expect(decodeWorldId(" Ab3_-Z9xQ1pL ")).toEqual({ id: "Ab3_-Z9xQ1pL", issue: null });
    expect(decodeWorldId("")).toEqual({ id: null, issue: "empty" });
    expect(decodeWorldId(null)).toEqual({ id: null, issue: null });
    expect(decodeWorldId(7)).toEqual({ id: null, issue: "invalid" });
    expect(decodeWorldId("abcd.efg")).toEqual({ id: null, issue: "legacy" });
  });

  it("keeps the other flags when a bad link is dropped from the URL", () => {
    expect(urlWithoutWorld("?w=abc&mute&vol=0.4")).toBe("?mute=&vol=0.4");
    expect(urlWithoutWorld("?w=abc")).toBe("");
    expect(urlWithoutWorld("?world=abc&noshake")).toBe("?noshake=");
    expect(urlWithoutWorld("?%zz=%")).toBe("?%25zz=%25");
    expect(urlWithoutWorld(null)).toBe("");
  });
});

describe("fuzzed inputs never break the page", () => {
  it("survives random garbage query strings", () => {
    const rng = mulberry32(0x1a2b3c4d);
    for (let i = 0; i < 4000; i++) {
      const input = garbage(rng, 200);
      const flags = parseUrlFlags(rng() < 0.5 ? `?${input}` : input);
      checkShape(flags, input);
    }
  });

  it("survives random junk flag combinations", () => {
    const rng = mulberry32(0x5eed);
    for (let i = 0; i < 4000; i++) {
      const input = junkQuery(rng);
      checkShape(parseUrlFlags(`?${input}`), input);
    }
  });

  it("survives links corrupted after they were shared", () => {
    const rng = mulberry32(0x0dd);
    for (let i = 0; i < 4000; i++) {
      const input = mangledLink(rng);
      const flags = parseUrlFlags(`?${input}`, garbage(rng, 20));
      checkShape(flags, input);
    }
  });

  it("is deterministic: the same stranger link always decodes the same way", () => {
    const rng = mulberry32(0xbeef);
    for (let i = 0; i < 500; i++) {
      const input = rng() < 0.5 ? junkQuery(rng) : mangledLink(rng);
      const a = parseUrlFlags(`?${input}`);
      const b = parseUrlFlags(`?${input}`);
      expect({ ...a, has: undefined }).toEqual({ ...b, has: undefined });
    }
  });

  it("never turns junk into a world id or a volume out of range", () => {
    const rng = mulberry32(0xc0ffee);
    for (let i = 0; i < 2000; i++) {
      const value = garbage(rng, 60);
      const f = parseUrlFlags(`?w=${enc(value)}&vol=${enc(value)}`);
      if (f.worldId !== null) expect(f.worldId).toMatch(ID_GRAMMAR);
      if (f.volume !== null) expect(f.volume).toBeGreaterThanOrEqual(0);
      if (f.volume !== null) expect(f.volume).toBeLessThanOrEqual(1);
    }
  });
});
