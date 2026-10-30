// Client side of "the world survives a reload" (ADR 0070): which slot this browser owns, whether
// this page load should ask for it back, and the debounced autosave. No browser needed.
import { describe, expect, it } from "vitest";
import {
  browserStorage,
  createAutosave,
  homeSlot,
  newHomeSlotId,
  nextHomeSlot,
  resumeSlotId,
} from "../src/client/home-world";
import type { StorageLike } from "../src/client/home-world";
import { HOME_WORLD_KEY, isHomeWorldId } from "../src/contract";

function memStorage(seed: Record<string, string> = {}): StorageLike & { map: Map<string, string> } {
  const map = new Map(Object.entries(seed));
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => { map.set(k, v); },
    removeItem: (k) => { map.delete(k); },
  };
}

describe("the browser's own autosave slot", () => {
  it("makes an id nothing can guess and only ever a home id", () => {
    const a = newHomeSlotId();
    const b = newHomeSlotId();
    expect(isHomeWorldId(a)).toBe(true);
    expect(a).not.toBe(b);
    expect(a.length).toBeLessThanOrEqual(37); // it has to fit a normal world id
    expect(newHomeSlotId(new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe("home-AAAAAAAAAAAA");
  });

  it("creates a slot on the first visit, then hands the same one back", () => {
    const storage = memStorage();
    const first = homeSlot(storage);
    expect(first.created).toBe(true);
    expect(storage.map.get(HOME_WORLD_KEY)).toBe(first.id);
    const second = homeSlot(storage);
    expect(second).toEqual({ id: first.id, created: false });
  });

  it("replaces a hand-edited or old-format value instead of trusting it", () => {
    for (const junk of ["", "abc", "../../etc/passwd", "home-%", "demo-one"]) {
      const storage = memStorage({ [HOME_WORLD_KEY]: junk });
      const slot = homeSlot(storage);
      expect(slot.created).toBe(true);
      expect(isHomeWorldId(slot.id)).toBe(true);
      expect(storage.map.get(HOME_WORLD_KEY)).toBe(slot.id);
    }
  });

  it("switches to a fresh slot for a new world, leaving the old file alone", () => {
    const storage = memStorage();
    const old = homeSlot(storage);
    const fresh = nextHomeSlot(storage);
    expect(fresh.id).not.toBe(old.id);
    expect(isHomeWorldId(fresh.id)).toBe(true);
    expect(storage.map.get(HOME_WORLD_KEY)).toBe(fresh.id);
  });

  it("works with storage that refuses everything (private mode)", () => {
    const blocked: StorageLike = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
      removeItem: () => { throw new Error("blocked"); },
    };
    const slot = homeSlot(blocked);
    expect(isHomeWorldId(slot.id)).toBe(true);
    // The fallback the browser module uses when localStorage itself is unavailable keeps working too.
    const fallback = browserStorage();
    expect(isHomeWorldId(homeSlot(fallback).id)).toBe(true);
  });
});

describe("when a page load asks for the world back", () => {
  const slot = { id: "home-abcdefgh1234", created: false };

  it("asks for it on an ordinary reload", () => {
    expect(resumeSlotId({ slot, worldParam: null, shareIssue: false })).toBe(slot.id);
  });

  it("does not ask when the page is already showing a linked world, or a broken link", () => {
    expect(resumeSlotId({ slot, worldParam: "demo-one", shareIssue: false })).toBeNull();
    expect(resumeSlotId({ slot, worldParam: null, shareIssue: true })).toBeNull();
  });

  it("does not ask on a first visit: there is nothing saved yet", () => {
    expect(resumeSlotId({ slot: { id: slot.id, created: true }, worldParam: null, shareIssue: false })).toBeNull();
  });
});

describe("debounced autosave", () => {
  /** A hand-driven clock: no real timers, so the test says exactly when a save may fire. */
  function clock() {
    let t = 0;
    const pending = new Map<number, { at: number; fn: () => void }>();
    let seq = 0;
    return {
      setTimeout: (fn: () => void, ms: number) => { const id = ++seq; pending.set(id, { at: t + ms, fn }); return id; },
      clearTimeout: (h: unknown) => { pending.delete(h as number); },
      advance(ms: number) {
        t += ms;
        for (const [id, job] of [...pending]) if (job.at <= t) { pending.delete(id); job.fn(); }
      },
      size: () => pending.size,
    };
  }

  it("saves once things go quiet, not once per change", () => {
    const c = clock();
    const saves: number[] = [];
    const auto = createAutosave({ send: () => saves.push(1), delay: 700, setTimeout: c.setTimeout, clearTimeout: c.clearTimeout });

    auto.touch();
    c.advance(300);
    auto.touch(); // a second mod landing in the same command
    c.advance(300);
    expect(saves).toHaveLength(0);
    c.advance(700);
    expect(saves).toHaveLength(1);
    expect(auto.pending()).toBe(false);
    // Nothing pending: no second save.
    c.advance(5000);
    expect(saves).toHaveLength(1);
  });

  it("flushes at once when the tab is going away, and cancels when a new world replaces the old", () => {
    const c = clock();
    const saves: string[] = [];
    let label = "old";
    const auto = createAutosave({ send: () => saves.push(label), delay: 700, setTimeout: c.setTimeout, clearTimeout: c.clearTimeout });

    auto.touch();
    expect(auto.flush()).toBe(true); // pagehide
    expect(saves).toEqual(["old"]);
    expect(c.size()).toBe(0);
    expect(auto.flush()).toBe(false); // nothing left to save

    auto.touch();
    label = "new";
    auto.cancel(); // "New world": the pending save of the old world must not land on the new slot
    c.advance(5000);
    expect(saves).toEqual(["old"]);
  });
});
