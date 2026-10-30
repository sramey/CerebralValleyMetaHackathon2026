// Wire validation for every ClientMsg kind (ADR 0036). The WebSocket is the only door
// into the server, so every text frame is parsed and checked here BEFORE dispatch:
// shape, string lengths, numeric ranges, image caps and object keys. Nothing in this
// file touches the network, the filesystem or a model: it is pure, so the fuzz tests can
// hammer it headless and assert a bad frame can never throw, never reaches a handler,
// and therefore can never spend Meta budget.
//
// Every accepted message is rebuilt field by field (a whitelist, not a cast), so unknown
// fields the client sends are dropped and a handler can trust the shape it receives.
import type { ClientMsg, KnobDef, KnobValue, SketchStroke, SketchTag } from "../src/contract";

/** Hard ceiling for one text frame (the socket's maxPayload), so a giant frame is refused before JSON.parse. */
export const MAX_FRAME = 6 * 1024 * 1024;
/** Longest command / feedback note we take. The pipeline labels a build with the first 400 chars anyway. */
export const MAX_TEXT = 1000;
export const MAX_PROMPT = 500;
/** Ids and keys are short slugs ("player", "sketch-level-x", "photo-3"). */
export const MAX_KEY = 64;
export const MAX_KNOB_NAME = 64;
/** One mod list (worldState, worldSave). The client's own loader never gets near this. */
export const MAX_MODS = 64;
export const MAX_KNOBS = 24;
/** Sprite sheet keys one restyle may name (the handler edits at most 12). */
export const MAX_SHEET_KEYS = 32;
/** A PNG data URL of a photo or a sketch. Same cap the photo/sketch handlers already enforced. */
export const MAX_IMAGE = 4_000_000;
/** Sketch strokes and points per stroke (the sketcher draws at most 80 strokes). */
export const MAX_STROKES = 400;
export const MAX_POINTS = 400;
/** Sanity ceiling for any number on the wire (world coords, knob values, aspect ratios). */
export const MAX_NUMBER = 1e9;

/** Plain refusals for the orb. Short, never echo client content, never a stack trace. */
export const REPLY = {
  json: "I only speak JSON — try the text box again.",
  unknown: "I didn't understand that message — try the text box again.",
  bad: "That message looked wrong — try it again.",
  tooBig: "That message was too big — try something smaller.",
  photo: "That photo didn't come through — try taking it again.",
  sketch: "That sketch didn't come through — try drawing it again.",
  command: "That command is too long — try a shorter one.",
  explain: "I couldn't tell which object you clicked — click it again.",
} as const;

export type Validation = { ok: true; msg: ClientMsg } | { ok: false; reply: string };

const reject = (reply: string): Validation => ({ ok: false, reply });
const accept = (msg: ClientMsg): Validation => ({ ok: true, msg });

/** Object keys that may never travel: they can rewrite a prototype instead of storing a value. */
const DANGEROUS_KEYS: ReadonlySet<string> = new Set(["__proto__", "prototype", "constructor"]);
const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/;
/** Printable characters only: a model-written mod id or knob name may have spaces or unicode, never control chars. */
const LABEL_RE = /^[^\u0000-\u001f\u007f]+$/;
const SKETCH_TAGS: readonly string[] = ["terrain", "coin", "hazard", "bouncer", "freehand"];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function hasDangerousKey(o: Record<string, unknown>): boolean {
  for (const k of Object.keys(o)) if (DANGEROUS_KEYS.has(k)) return true;
  return false;
}

/** A non-empty string of at most `max` chars, or null. */
function text(v: unknown, max: number): string | null {
  return typeof v === "string" && v.length > 0 && v.length <= max ? v : null;
}

/** An id/key: a short slug (client-generated keys, world ids), safe as an object key. */
function key(v: unknown): string | null {
  const s = text(v, MAX_KEY);
  return s && !DANGEROUS_KEYS.has(s) && KEY_RE.test(s) ? s : null;
}

/**
 * A label: a mod id or knob name written by Wonder, so be permissive (spaces, unicode) but
 * never a prototype key and never control characters. These only ever index a Map or an object.
 */
function label(v: unknown, max = MAX_KNOB_NAME): string | null {
  const s = text(v, max);
  return s && !DANGEROUS_KEYS.has(s) && LABEL_RE.test(s) ? s : null;
}

/** A finite number inside [lo, hi], or null (rejects NaN, Infinity, -0 caveats aside). */
function finite(v: unknown, lo = -MAX_NUMBER, hi = MAX_NUMBER): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : null;
}

/** KnobValue: finite number, a short string, or a boolean. */
function knobValue(v: unknown): KnobValue | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "string" && v.length <= 200) return v;
  const n = finite(v);
  return n === null ? null : n;
}

/** Keep only usable knob values (finite numbers, short strings, booleans) under safe keys, at most MAX_KNOBS. */
function sanitizeValues(v: unknown): Record<string, KnobValue> {
  const out: Record<string, KnobValue> = {};
  if (!isObj(v)) return out;
  let n = 0;
  for (const [k, raw] of Object.entries(v)) {
    if (n >= MAX_KNOBS) break;
    if (label(k) === null) continue; // includes "__proto__", "constructor", "prototype"
    const kv = knobValue(raw);
    if (kv === null) continue;
    out[k] = kv;
    n++;
  }
  return out;
}

/**
 * worldState/worldSave mod lists. The frame is refused only for a gross protocol violation
 * (no array, or over the cap). Inside the list, one odd entry is dropped instead: a mod id
 * or knob value the client is carrying that we cannot use must not cost the whole status
 * report (the playtest world copy and the recent-mod memory ride on this message).
 */
function modList(v: unknown): { id: string; values: Record<string, KnobValue> }[] | null {
  if (!Array.isArray(v) || v.length > MAX_MODS) return null;
  const out: { id: string; values: Record<string, KnobValue> }[] = [];
  for (const e of v) {
    if (!isObj(e) || hasDangerousKey(e)) continue;
    const id = label(e.id, MAX_KEY);
    if (!id) continue;
    out.push({ id, values: sanitizeValues(e.values) });
  }
  return out;
}

/** A data URL we will spend a Meta image call on. Prefix + cap, the same test the handlers made. */
function dataImage(v: unknown): string | null {
  return typeof v === "string" && v.startsWith("data:image") && v.length > 0 && v.length < MAX_IMAGE ? v : null;
}

/** Sketch strokes: finite geometry only, because the boxes become world coordinates. */
function strokes(v: unknown): SketchStroke[] | null {
  if (!Array.isArray(v) || v.length > MAX_STROKES) return null;
  const out: SketchStroke[] = [];
  for (const s of v) {
    if (!isObj(s) || hasDangerousKey(s)) return null;
    const b = s.bbox;
    if (!isObj(b)) return null;
    const bx = finite(b.x);
    const by = finite(b.y);
    const bw = finite(b.w);
    const bh = finite(b.h);
    if (bx === null || by === null || bw === null || bh === null) return null;
    if (!Array.isArray(s.points) || s.points.length > MAX_POINTS) return null;
    const points: { x: number; y: number }[] = [];
    for (const p of s.points) {
      if (!isObj(p)) return null;
      const x = finite(p.x);
      const y = finite(p.y);
      if (x === null || y === null) return null;
      points.push({ x, y });
    }
    const color = typeof s.color === "string" && s.color.length <= 32 ? s.color : "#3fd06a";
    const tag = typeof s.tag === "string" && SKETCH_TAGS.includes(s.tag) ? (s.tag as SketchTag) : "freehand";
    out.push({ color, tag, points, bbox: { x: bx, y: by, w: bw, h: bh } });
  }
  return out;
}

/** The sketch's world rect: optional, but if present it must be a real, positive box. */
function sketchView(v: unknown): { x: number; y: number; w: number; h: number } | undefined | null {
  if (v === undefined) return undefined;
  if (!isObj(v)) return null;
  const x = finite(v.x);
  const y = finite(v.y);
  const w = finite(v.w, 0.0001);
  const h = finite(v.h, 0.0001);
  return x === null || y === null || w === null || h === null ? null : { x, y, w, h };
}

/** Sheet keys for a restyle: strings only, capped, odd entries dropped (the handler skips unknown sheets anyway). */
function sheetKeys(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.length > MAX_SHEET_KEYS) return null;
  const out: string[] = [];
  for (const k of v) {
    if (typeof k !== "string" || k.length === 0 || k.length > MAX_KEY) continue;
    if (!out.includes(k)) out.push(k);
  }
  return out;
}

/**
 * Validate one already-parsed frame. Returns a rebuilt, typed message or a plain reply.
 * Never throws: it only looks at best-effort structural checks on untrusted JSON.
 */
export function validateClientMsg(value: unknown): Validation {
  if (!isObj(value) || hasDangerousKey(value)) return reject(REPLY.json);
  const kind = value.kind;
  if (typeof kind !== "string") return reject(REPLY.json);

  switch (kind) {
    case "command": {
      const t = text(value.text, MAX_TEXT);
      if (t === null) return reject(typeof value.text === "string" && value.text.length > MAX_TEXT ? REPLY.command : REPLY.bad);
      if (!t.trim()) return reject(REPLY.bad);
      return accept({ kind: "command", text: t });
    }
    case "undo": {
      const id = label(value.modId, MAX_KEY);
      return id ? accept({ kind: "undo", modId: id }) : reject(REPLY.bad);
    }
    case "knob": {
      const id = label(value.modId, MAX_KEY);
      const knob = label(value.knob);
      const v = knobValue(value.value);
      if (!id || knob === null || v === null) return reject(REPLY.bad);
      return accept({ kind: "knob", modId: id, knob, value: v });
    }
    case "photo":
    case "photoFind": {
      const k = key(value.key);
      const image = dataImage(value.image);
      const prompt = value.prompt === undefined ? "" : typeof value.prompt === "string" && value.prompt.length <= MAX_PROMPT ? value.prompt : null;
      if (!k || !image || prompt === null) return reject(REPLY.photo);
      return accept({ kind, key: k, image, prompt });
    }
    case "photoBring": {
      const k = key(value.key);
      return k ? accept({ kind: "photoBring", key: k }) : reject(REPLY.photo);
    }
    case "photoBringLocal": {
      const k = key(value.key);
      const prompt = value.prompt === undefined ? "" : typeof value.prompt === "string" && value.prompt.length <= MAX_PROMPT ? value.prompt : null;
      const aspect = finite(value.aspect, 0.1, 10);
      if (!k || prompt === null || aspect === null) return reject(REPLY.photo);
      return accept({ kind: "photoBringLocal", key: k, prompt, aspect });
    }
    case "worldState":
    case "worldSave":
    case "worldExport": {
      const mods = modList(value.mods);
      return mods ? accept({ kind, mods }) : reject(REPLY.bad);
    }
    case "worldLoad": {
      const id = key(value.id);
      return id ? accept({ kind: "worldLoad", id }) : reject(REPLY.bad);
    }
    case "voiceWarm":
      return accept({ kind: "voiceWarm" });
    case "voiceStart":
      return accept({ kind: "voiceStart" });
    case "voiceEnd": {
      if (value.cancel !== undefined && typeof value.cancel !== "boolean") return reject(REPLY.bad);
      return accept(value.cancel === true ? { kind: "voiceEnd", cancel: true } : { kind: "voiceEnd" });
    }
    case "restyle": {
      const mood = text(value.mood, 120);
      const keys = sheetKeys(value.keys);
      if (mood === null || keys === null) return reject(REPLY.bad);
      return accept({ kind: "restyle", mood, keys });
    }
    case "feedback": {
      const modId = value.modId === "" ? "" : label(value.modId, MAX_KEY);
      const vote = value.vote === "up" || value.vote === "down" ? value.vote : null;
      const note = value.note === undefined ? "" : typeof value.note === "string" && value.note.length <= MAX_TEXT ? value.note : null;
      const entityType = value.entityType === undefined ? undefined : label(value.entityType, MAX_KEY) ?? null;
      const fixNow = value.fixNow === undefined ? undefined : typeof value.fixNow === "boolean" ? value.fixNow : null;
      if (modId === null || !vote || note === null || entityType === null || fixNow === null) return reject(REPLY.bad);
      return accept({
        kind: "feedback",
        modId,
        vote,
        note,
        ...(entityType === undefined ? {} : { entityType }),
        ...(fixNow === undefined ? {} : { fixNow }),
      });
    }
    case "sketch": {
      const image = dataImage(value.image);
      const list = strokes(value.strokes);
      const prompt = value.prompt === undefined ? undefined : typeof value.prompt === "string" && value.prompt.length <= MAX_PROMPT ? value.prompt : null;
      const view = sketchView(value.view);
      if (!image || !list || prompt === null || view === null) return reject(REPLY.sketch);
      return accept({
        kind: "sketch",
        image,
        strokes: list,
        ...(prompt === undefined ? {} : { prompt }),
        ...(view === undefined ? {} : { view }),
      });
    }
    case "paperLevel": {
      const image = dataImage(value.image);
      const prompt = value.prompt === undefined ? undefined : typeof value.prompt === "string" && value.prompt.length <= MAX_PROMPT ? value.prompt : null;
      if (!image || prompt === null) return reject(REPLY.photo);
      return accept({
        kind: "paperLevel",
        image,
        ...(prompt === undefined ? {} : { prompt }),
      });
    }
    case "tester": {
      const evs = ["open", "typed", "voice", "landed", "rejected", "failed", "mood", "close"] as const;
      const n = value.n;
      const ev = evs.find((e) => e === value.ev);
      const cid = value.cid === undefined ? undefined : Number.isInteger(value.cid) && (value.cid as number) >= 0 ? (value.cid as number) : null;
      const mood = value.mood === undefined ? undefined : label(value.mood, MAX_KEY) ?? null;
      if (!Number.isInteger(n) || (n as number) < 1 || (n as number) > 99 || !ev || cid === null || mood === null) return reject(REPLY.bad);
      return accept({ kind: "tester", n: n as number, ev, ...(cid === undefined ? {} : { cid }), ...(mood === undefined ? {} : { mood }) });
    }
    case "timelineRestore": {
      const n = value.n;
      return Number.isInteger(n) && (n as number) >= 0 ? accept({ kind: "timelineRestore", n: n as number }) : reject(REPLY.bad);
    }
    case "explain": {
      // "How does this work?": only the mod id travels; the server explains its own copy of the source.
      const id = label(value.modId, MAX_KEY);
      return id ? accept({ kind: "explain", modId: id }) : reject(REPLY.explain);
    }
    case "receipt": {
      // "How was this made?": only the mod id travels; the receipt comes from the server's own records.
      const id = label(value.modId, MAX_KEY);
      return id ? accept({ kind: "receipt", modId: id }) : reject(REPLY.explain);
    }
    default:
      return reject(REPLY.unknown);
  }
}

/**
 * Parse + validate one text frame. Never throws. Oversized frames are refused before
 * JSON.parse so a hostile client cannot pay for the parse.
 */
export function parseClientMessage(raw: string): Validation {
  if (typeof raw !== "string" || raw.length > MAX_FRAME) return reject(REPLY.tooBig);
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return reject(REPLY.json);
  }
  return validateClientMsg(value);
}

/**
 * The socket's single gate: validate, then dispatch or answer with a plain sentence.
 * Returns true when the message was dispatched. This is the function `server/index.ts`
 * calls, so the fuzz tests exercise the exact shipped path.
 */
export function gateMessage(raw: string, onMsg: (msg: ClientMsg) => void, onInvalid: (reply: string) => void): boolean {
  let result: Validation;
  try {
    result = parseClientMessage(raw);
  } catch {
    result = reject(REPLY.json);
  }
  if (!result.ok) {
    onInvalid(result.reply);
    return false;
  }
  onMsg(result.msg);
  return true;
}

/** Knob values are clamped into the knob's declared min/max, so a hostile tweak cannot post 1e9 to the sim. */
export function clampKnobValue(def: KnobDef | undefined, value: KnobValue): KnobValue {
  if (typeof value !== "number" || !Number.isFinite(value) || !def) return value;
  const lo = typeof def.min === "number" && Number.isFinite(def.min) ? def.min : -Infinity;
  const hi = typeof def.max === "number" && Number.isFinite(def.max) ? def.max : Infinity;
  return Math.max(lo, Math.min(hi, value));
}
