// URL flags and share links come from strangers (bead 1z8): everything here is a pure,
// defensive decoder. A corrupted, truncated, oversized or old-version link must never throw,
// must never be trusted as code, and must never wedge the page — it falls back to the starter
// world with a plain-language line. The client then uses only what this file returns, so no
// other module reads `location.search` directly. See ADR 0037.

/** Longest query string we will even look at. A real share link is ~20 chars; past this it is noise. */
export const MAX_QUERY_LEN = 2048;
/** Share ids are `randomBytes(6).base64url` on the server; this mirrors `isWorldId` in server/worlds.ts. */
export const MIN_WORLD_ID_LEN = 4;
export const MAX_WORLD_ID_LEN = 40;
const WORLD_ID = /^[A-Za-z0-9_-]{4,40}$/;
/** Values that turn a presence flag off (`?nocoach=0`), so a hand-edited link still means what it says. */
const FALSEY = new Set(["0", "false", "no", "off"]);
/** Volume is a 0..1 number; `?vol=1e999` is infinity, `?vol=abc` is not a number: both are ignored. */
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

/** Why a share link could not be opened. Every one of these shows the same friendly line. */
export type ShareIssue = "empty" | "oversized" | "invalid" | "legacy";

export interface UrlFlags {
  readonly mute: boolean;
  readonly noShake: boolean;
  readonly coach: boolean;
  readonly noCoach: boolean;
  /** QA-only flag: gates the `window.__urlFlags` test hook. No gameplay effect. */
  readonly tester: boolean;
  /** 0..1, or null when the link did not ask for a volume (or asked with junk). */
  readonly volume: number | null;
  /** Slug in the server's mood-key form (`deep-winter`), or null. Carried for the mood work; not applied yet. */
  readonly mood: string | null;
  /** A share id that passed the id grammar, or null. Everything else is in `shareIssue`. */
  readonly worldId: string | null;
  readonly shareIssue: ShareIssue | null;
  /** Presence check for the boolean flags, so callers that only ask "is it on" share one parser. */
  has(name: string): boolean;
}

interface FlagParts {
  mute?: boolean;
  noShake?: boolean;
  coach?: boolean;
  noCoach?: boolean;
  tester?: boolean;
  volume?: number | null;
  mood?: string | null;
  worldId?: string | null;
  shareIssue?: ShareIssue | null;
}

function makeFlags(p: FlagParts): UrlFlags {
  const f: UrlFlags = {
    mute: p.mute === true,
    noShake: p.noShake === true,
    coach: p.coach === true,
    noCoach: p.noCoach === true,
    tester: p.tester === true,
    volume: p.volume ?? null,
    mood: p.mood ?? null,
    worldId: p.worldId ?? null,
    shareIssue: p.shareIssue ?? null,
    has(name: string): boolean {
      switch (name) {
        case "mute": return f.mute;
        case "noshake": return f.noShake;
        case "coach": return f.coach;
        case "nocoach": return f.noCoach;
        case "tester": return f.tester;
        default: return false;
      }
    },
  };
  return f;
}

/** The flags a page with no query string gets. */
export function defaultFlags(): UrlFlags {
  return makeFlags({});
}

function paramsOf(search: unknown): URLSearchParams | null {
  if (typeof search !== "string") return null;
  try { return new URLSearchParams(search); } catch { return null; }
}

/** Last value of a repeated param (`?vol=1&vol=0.5` -> "0.5"), matching how browsers read a URL. */
function lastParam(params: URLSearchParams, name: string): string | null {
  const all = params.getAll(name);
  return all.length > 0 ? all[all.length - 1] : null;
}

/** Presence flag: present and not explicitly falsey means on. Junk values keep the flag on. */
function presence(params: URLSearchParams, name: string): boolean {
  const v = lastParam(params, name);
  return v !== null && !FALSEY.has(v.trim().toLowerCase());
}

export function isWorldId(id: unknown): id is string {
  return typeof id === "string" && WORLD_ID.test(id);
}

/** Mirrors `moodKey` in server/mood.ts: `Deep Winter!` -> `deep-winter`, empty/junk -> null. */
export function moodSlug(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const slug = raw.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24);
  return slug || null;
}

/** Strict 0..1 volume; null for absent, empty, non-numeric or non-finite values. */
export function parseVolume(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!NUMBER.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : null;
}

/** Old-format links: a saved-file name, a pasted URL, a key=value fragment or a hash route. */
function looksLegacy(v: string): boolean {
  return /[.:\/?#&=]/.test(v) || /\.json$/i.test(v);
}

/**
 * Decode the `w` value of a share link. Current links are exactly `<id>`; everything else is
 * reported as an issue so the caller can say "couldn't open that world" instead of guessing.
 * Old ids are deliberately not upgraded: an id from the current grammar is the only thing the
 * server can resolve, and a silent partial link is worse than a clean fresh start.
 */
export function decodeWorldId(raw: unknown): { id: string | null; issue: ShareIssue | null } {
  if (raw === null || raw === undefined) return { id: null, issue: null };
  if (typeof raw !== "string") return { id: null, issue: "invalid" };
  const v = raw.trim();
  if (!v) return { id: null, issue: "empty" };
  if (v.length > 200) return { id: null, issue: "oversized" };
  if (WORLD_ID.test(v)) return { id: v, issue: null };
  return { id: null, issue: looksLegacy(v) ? "legacy" : "invalid" };
}

/**
 * One entry point for everything the page reads out of the URL. Never throws, whatever the
 * stranger sent: a 100 KB query, `%`-salad, emoji, control characters or nothing at all.
 */
export function parseUrlFlags(search: unknown, hash: unknown = ""): UrlFlags {
  // A query that was pasted whole (`?utm=1#w=abc`) still has its fragment: split it out, so a
  // caller that only has one string cannot be fooled into reading a fragment as a value.
  const whole = typeof search === "string" ? search : "";
  const cut = whole.indexOf("#");
  const q = cut >= 0 ? whole.slice(0, cut) : whole;
  const h = typeof hash === "string" && hash ? hash : cut >= 0 ? whole.slice(cut) : "";
  if (q.length > MAX_QUERY_LEN) return makeFlags({ shareIssue: "oversized" });

  const params = paramsOf(q);
  if (!params) return makeFlags({ shareIssue: q ? "invalid" : null });

  const decoded = decodeWorldId(lastParam(params, "w"));
  let issue = decoded.issue;
  // Old share links used another key, a `#w=` fragment or a `#/w/<id>` route. Recognise them so
  // the visitor gets the friendly line instead of a page that quietly opens nothing.
  if (decoded.id === null && issue === null) {
    const legacyKey = lastParam(params, "world") ?? lastParam(params, "worldId") ?? lastParam(params, "world_id");
    if (legacyKey !== null) issue = "legacy";
    else if (/(^|[#/?&])w=/.test(h) || /^#\/?w\//.test(h)) issue = "legacy";
  }

  return makeFlags({
    mute: presence(params, "mute"),
    noShake: presence(params, "noshake"),
    coach: presence(params, "coach"),
    noCoach: presence(params, "nocoach"),
    tester: presence(params, "tester"),
    volume: parseVolume(lastParam(params, "vol")),
    mood: moodSlug(lastParam(params, "mood")),
    worldId: decoded.id,
    shareIssue: issue,
  });
}

/** What a visitor sees when a link cannot be opened. Plain words, no error codes, no blame. */
export function shareIssueMessage(issue: ShareIssue): string {
  switch (issue) {
    case "legacy": return "Couldn't open that world — that link is from an older version, so here's a fresh start instead.";
    case "empty": return "Couldn't open that world — there was no world in that link, so here's a fresh start instead.";
    case "oversized": return "Couldn't open that world — that link was far too long, so here's a fresh start instead.";
    default: return "Couldn't open that world — starting you off with fresh ground instead.";
  }
}

/** The same query string with every share-link key removed, so a bad link is not retried on reload. */
export function urlWithoutWorld(search: unknown): string {
  const params = paramsOf(search);
  if (!params) return "";
  params.delete("w");
  params.delete("world");
  params.delete("worldId");
  params.delete("world_id");
  const rest = params.toString();
  return rest ? `?${rest}` : "";
}
