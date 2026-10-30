// The world survives a reload (ADR 0070), client side. This module holds the three pieces that are
// worth testing without a browser: which autosave slot this browser owns, whether this page load
// should ask for it back, and a small debounced autosave that never fires more than one save per
// quiet moment. No DOM, no globals read at import time: `main.ts` passes the storage in.
import { HOME_WORLD_KEY, HOME_WORLD_PREFIX, isHomeWorldId } from "../contract";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** localStorage, or an in-memory stand-in when the browser refuses it (private mode, blocked cookies). */
export function browserStorage(): StorageLike {
  const memory = new Map<string, string>();
  const fallback: StorageLike = {
    getItem: (k) => memory.get(k) ?? null,
    setItem: (k, v) => { memory.set(k, v); },
    removeItem: (k) => { memory.delete(k); },
  };
  try {
    const ls = globalThis.localStorage;
    const probe = `${HOME_WORLD_KEY}.probe`;
    ls.setItem(probe, "1");
    ls.removeItem(probe);
    return {
      getItem: (k) => { try { return ls.getItem(k); } catch { return null; } },
      setItem: (k, v) => { try { ls.setItem(k, v); } catch { /* full or blocked: the world still works this visit */ } },
      removeItem: (k) => { try { ls.removeItem(k); } catch { /* ignore */ } },
    };
  } catch {
    return fallback;
  }
}

/** A fresh slot id: `home-` plus 12 base64url characters (72 bits), which nothing can guess. */
export function newHomeSlotId(bytes?: Uint8Array): string {
  const raw = bytes ?? (globalThis.crypto?.getRandomValues ? globalThis.crypto.getRandomValues(new Uint8Array(9)) : fromMath());
  return `${HOME_WORLD_PREFIX}${base64url(raw).slice(0, 12)}`;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** base64url over bytes, unwrapped: no btoa, no Buffer, so this runs in a browser and in a test alike. */
function base64url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const n = (a << 16) | (b << 8) | c;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    if (i + 1 < bytes.length) out += B64[(n >> 6) & 63];
    if (i + 2 < bytes.length) out += B64[n & 63];
  }
  return out;
}

/** Only used where there is no crypto at all (an ancient browser): still 12 random-ish characters. */
function fromMath(): Uint8Array {
  const out = new Uint8Array(9);
  for (let i = 0; i < out.length; i++) out[i] = Math.floor(Math.random() * 256);
  return out;
}

export interface HomeSlot {
  /** The id this browser autosaves under. */
  id: string;
  /** True the first time this browser is seen: nothing to resume yet, so start at once. */
  created: boolean;
}

/**
 * This browser's slot, created and remembered on the first visit. A stored value that is not a real
 * slot id (an old format, a hand-edited string) is replaced, never trusted.
 */
export function homeSlot(storage: StorageLike, makeId: () => string = () => newHomeSlotId()): HomeSlot {
  let stored: string | null = null;
  try { stored = storage.getItem(HOME_WORLD_KEY); } catch { stored = null; }
  if (isHomeWorldId(stored)) return { id: stored, created: false };
  const id = makeId();
  remember(storage, id);
  return { id, created: true };
}

/** "New world" (ADR 0070): forget the old slot and take a fresh one, so the old file is left alone. */
export function nextHomeSlot(storage: StorageLike, makeId: () => string = () => newHomeSlotId()): HomeSlot {
  const id = makeId();
  remember(storage, id);
  return { id, created: true };
}

/** Storage may refuse to write (private mode, a full quota): the world still works this visit. */
function remember(storage: StorageLike, id: string): void {
  try { storage.setItem(HOME_WORLD_KEY, id); } catch { /* the slot lives in memory for this visit */ }
}

/**
 * Ask for the saved world back? Only when this page is not already showing a specific world: a
 * `?w=` link and a broken share link both win over the browser's own last world (ADR 0037/0070), and
 * a first-ever visit has nothing to ask for.
 */
export function resumeSlotId(args: { slot: HomeSlot; worldParam: string | null; shareIssue: boolean }): string | null {
  if (args.shareIssue) return null;
  if (args.worldParam) return null;
  if (args.slot.created) return null;
  return isHomeWorldId(args.slot.id) ? args.slot.id : null;
}

export interface Autosave {
  /** The world changed: save once things go quiet. */
  touch(): void;
  /** Save now if anything is pending. Returns true when a save went out. */
  flush(): boolean;
  /** Drop a pending save without sending it (a new world is about to replace it). */
  cancel(): void;
  pending(): boolean;
}

/**
 * Debounced autosave. One save per quiet moment, not one per change: a compound command lands a
 * handful of mods in a row and the world file is written once, at the end.
 */
export function createAutosave(opts: {
  send: () => void;
  delay?: number;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}): Autosave {
  const delay = opts.delay ?? 700;
  const setT = opts.setTimeout ?? ((fn, ms) => globalThis.setTimeout(fn, ms));
  const clearT = opts.clearTimeout ?? ((h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>));
  let timer: unknown = null;
  let dirty = false;
  const stop = () => { if (timer !== null) { clearT(timer); timer = null; } };
  const fire = () => {
    timer = null;
    if (!dirty) return false;
    dirty = false;
    opts.send();
    return true;
  };
  return {
    touch() { dirty = true; stop(); timer = setT(fire, delay); },
    flush() { stop(); return fire(); },
    cancel() { stop(); dirty = false; },
    pending() { return dirty; },
  };
}
