// Bug bv4: after undoing a mood, the strip's current chip ("Mood: spooky") kept showing until the
// next action. The client undoes a mood itself and the server sends no frame for it, so no timeline
// frame follows; the strip now shows the client's own step at once and the server's next frame
// replaces it. There is no jsdom in this repo, so the strip runs against a minimal fake DOM.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mountTimeline } from "../src/client/timeline";
import type { TimelineView } from "../src/client/timeline";
import type { TimelineStep } from "../src/contract";

type Listener = () => void;

class FakeEl {
  tag: string;
  className = "";
  textContent = "";
  hidden = false;
  type = "";
  scrollLeft = 0;
  scrollWidth = 0;
  attrs: Record<string, string> = {};
  children: FakeEl[] = [];
  listeners: Record<string, Listener[]> = {};

  constructor(tag: string) { this.tag = tag; }
  appendChild(c: FakeEl): FakeEl { this.children.push(c); return c; }
  append(...nodes: FakeEl[]): void { for (const n of nodes) this.appendChild(n); }
  replaceChildren(...nodes: FakeEl[]): void { this.children = []; for (const n of nodes) this.appendChild(n); }
  setAttribute(k: string, v: string): void { this.attrs[k] = v; }
  getAttribute(k: string): string | undefined { return this.attrs[k]; }
  addEventListener(ev: string, fn: Listener): void { (this.listeners[ev] ??= []).push(fn); }
  click(): void { for (const fn of this.listeners.click ?? []) fn(); }
  mouseenter(): void { for (const fn of this.listeners.mouseenter ?? []) fn(); }
  all(cls: string): FakeEl[] {
    const out: FakeEl[] = [];
    for (const c of this.children) {
      if (c.className.split(" ").includes(cls)) out.push(c);
      out.push(...c.all(cls));
    }
    return out;
  }
}

const step = (n: number, kind: TimelineStep["kind"], label: string, mood?: string, mods: { id: string; title: string }[] = []): TimelineStep =>
  ({ n, kind, label, mods, ...(mood ? { mood } : {}) });

// A session that built a starter world, then asked for a mood (two steps, the mood is current).
const MOOD_STEPS: TimelineStep[] = [
  step(1, "start", "Start", undefined, [{ id: "player", title: "Player" }, { id: "ground", title: "Ground" }]),
  step(2, "mood", "Mood: spooky", "spooky", [{ id: "player", title: "Player" }, { id: "ground", title: "Ground" }]),
];
const MODS = [{ id: "player", title: "Player" }, { id: "ground", title: "Ground" }];

let root: FakeEl;
let strips: number[];
let view: TimelineView;
const track = (): FakeEl => root.children[1];
const card = (): FakeEl => root.children[0];
const dots = (): FakeEl[] => track().children.filter((c) => c.className.startsWith("tl-dot"));
const cap = (): FakeEl | undefined => track().children.find((c) => c.className === "tl-cap");
const nowDot = (): FakeEl | undefined => dots().find((d) => d.className.split(" ").includes("now"));

describe("timeline strip: a local mood undo updates the chip at once (bug bv4)", () => {
  beforeEach(() => {
    (globalThis as unknown as { document: unknown }).document = { createElement: (tag: string) => new FakeEl(tag) };
    root = new FakeEl("div");
    strips = [];
    view = mountTimeline(root as unknown as HTMLElement, (n) => strips.push(n));
  });

  afterEach(() => { delete (globalThis as unknown as { document?: unknown }).document; vi.useRealTimers(); });

  it("shows the mood as the current world before the undo", () => {
    view.update(MOOD_STEPS, 2);
    expect(cap()?.textContent).toBe("Mood: spooky");
    expect(dots()).toHaveLength(2);
    expect(nowDot()?.className).toContain("mood");
    expect(root.hidden).toBe(false);
  });

  it("puts 'Back to normal' on the strip as soon as the mood is undone, not on the next action", () => {
    view.update(MOOD_STEPS, 2);
    view.localStep({ kind: "undo", label: "Back to normal", mods: MODS });

    expect(cap()?.textContent).toBe("Back to normal");
    expect(dots()).toHaveLength(3);
    const now = nowDot();
    expect(now?.className).toContain("undo");
    expect(now?.getAttribute("aria-label")).toBe("Step 3: Back to normal");
    // The mood step is history now: its dot stays, without the "now" ring.
    expect(dots()[1].className).not.toContain("now");
  });

  it("the local step reads as the world now, with nothing to restore", () => {
    view.update(MOOD_STEPS, 2);
    view.localStep({ kind: "undo", label: "Back to normal", mods: MODS });
    nowDot()!.click(); // pin the current step

    expect(card().hidden).toBe(false);
    expect(card().all("tl-here")[0]?.textContent).toBe("This is the world now.");
    expect(card().all("tl-restore")).toHaveLength(0);
    expect(card().all("tl-mods")[0]?.textContent).toBe("Player · Ground");
  });

  it("the server's next frame replaces the local step, with no duplicate dot", () => {
    view.update(MOOD_STEPS, 2);
    view.localStep({ kind: "undo", label: "Back to normal", mods: MODS });

    // The server records the undo itself (any later mood/removed/build frame) and echoes it.
    const recorded = [...MOOD_STEPS, step(3, "undo", "Back to normal", undefined, MODS)];
    view.update(recorded, 3);

    expect(dots()).toHaveLength(3);
    expect(cap()?.textContent).toBe("Back to normal");
    expect(nowDot()?.getAttribute("aria-label")).toBe("Step 3: Back to normal");
  });

  it("clearLocal drops a pending step (a restored or freshly opened world is the truth)", () => {
    view.update(MOOD_STEPS, 2);
    view.localStep({ kind: "undo", label: "Back to normal", mods: MODS });
    view.clearLocal();

    expect(dots()).toHaveLength(2);
    expect(cap()?.textContent).toBe("Mood: spooky");
    expect(nowDot()?.getAttribute("aria-label")).toBe("Step 2: Mood: spooky");
  });

  it("a single-step session still shows the strip once the local undo adds a second world", () => {
    view.update([step(1, "mood", "Mood: spooky", "spooky", MODS)], 1);
    expect(root.hidden).toBe(true); // one world alone is not history

    view.localStep({ kind: "undo", label: "Back to normal", mods: MODS });
    expect(root.hidden).toBe(false);
    expect(cap()?.textContent).toBe("Back to normal");
  });

  it("a redo (mood again) shows the mood as the current world at once", () => {
    view.update([step(1, "start", "Start", undefined, MODS), step(2, "undo", "Back to normal", undefined, MODS)], 2);
    view.localStep({ kind: "mood", label: "Mood: spooky", mood: "spooky", mods: MODS });

    expect(cap()?.textContent).toBe("Mood: spooky");
    expect(nowDot()?.className).toContain("mood");
  });

  it("restoring an older world still sends its own step number", () => {
    view.update(MOOD_STEPS, 2);
    view.localStep({ kind: "undo", label: "Back to normal", mods: MODS });

    dots()[0].click(); // pin the start world
    card().all("tl-restore")[0].click();
    expect(strips).toEqual([1]);
  });

  it("hovers the older world against the local one", () => {
    view.update(MOOD_STEPS, 2);
    view.localStep({ kind: "undo", label: "Back to normal", mods: MODS });

    dots()[1].mouseenter();
    expect(card().all("tl-head")[0]?.children[0]?.textContent).toBe("#2 Mood: spooky");
    // The mood is gone from the world now, so the card offers it back.
    expect(card().all("tl-restore")).toHaveLength(1);
  });
});
