// The pointer used to be invisible over the game canvas, so aiming a grappling hook (api.aim
// reads InputState.pointerX/Y, ADR 0050) was guesswork (bead r8n). The crosshair module is
// checked here against a minimal fake DOM: there is no jsdom in this repo.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { CROSSHAIR_SIZE, CURSOR_IDLE_MS, createCrosshair, paintCrosshair, shouldShowCrosshair } from "../src/client/crosshair";

type Ctx = Record<string, unknown>;

class FakeEl {
  tag: string;
  children: FakeEl[] = [];
  dataset: Record<string, string> = {};
  parent: FakeEl | null = null;
  constructor(tag: string) { this.tag = tag; }
  appendChild(c: FakeEl): FakeEl { c.parent = this; this.children.push(c); return c; }
  remove(): void { if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this); this.parent = null; }
}

class FakeCanvas extends FakeEl {
  id = "";
  className = "";
  width = 0;
  height = 0;
  style: Record<string, string> = {};
  calls: string[] = [];
  ctx: Ctx;
  constructor() {
    super("canvas");
    this.ctx = new Proxy({}, {
      get: (_t, key: string) => (..._args: unknown[]) => { this.calls.push(key); },
      set: () => true,
    }) as Ctx;
  }
  getContext(): Ctx { return this.ctx; }
}

let wrap: FakeEl;

beforeEach(() => {
  const doc = { createElement: (_tag: string) => new FakeCanvas() } as unknown as Document;
  (globalThis as unknown as { __doc: Document }).__doc = doc;
  wrap = new FakeEl("div");
});

afterEach(() => { delete (globalThis as unknown as { __doc?: Document }).__doc; });

const make = () => createCrosshair(wrap as unknown as HTMLElement, (globalThis as unknown as { __doc: Document }).__doc);

describe("when the crosshair is shown", () => {
  it("shows for a live mouse over the stage", () => {
    expect(shouldShowCrosshair({ seen: true, idleMs: 40, mode: "key", blocked: false })).toBe(true);
  });

  it("stays hidden for keyboard and gamepad play with no mouse", () => {
    expect(shouldShowCrosshair({ seen: false, idleMs: 0, mode: "key", blocked: false })).toBe(false);
    expect(shouldShowCrosshair({ seen: true, idleMs: 0, mode: "pad", blocked: false })).toBe(false);
  });

  it("fades out once the pointer has been still, and when something else owns the pointer", () => {
    expect(shouldShowCrosshair({ seen: true, idleMs: CURSOR_IDLE_MS + 1, mode: "key", blocked: false })).toBe(false);
    expect(shouldShowCrosshair({ seen: true, idleMs: 0, mode: "key", blocked: true })).toBe(false);
  });
});

describe("the crosshair element", () => {
  it("is a pointer-events-free canvas painted once and put in the stage wrap", () => {
    const cross = make();
    const el = (wrap.children[0] as FakeCanvas);
    expect(el.id).toBe("crosshair");
    expect(el.className).toContain("off");
    expect(el.width).toBeGreaterThanOrEqual(CROSSHAIR_SIZE);
    expect(el.style.width).toBe(`${CROSSHAIR_SIZE}px`);
    expect(el.calls).toContain("arc");
    expect(cross.shown).toBe(false);
  });

  it("appears on a mouse move and hides the OS cursor at the same time", () => {
    const cross = make();
    cross.move(120, 80, 1000);
    expect(cross.shown).toBe(true);
    expect(wrap.dataset.crosshair).toBe("on");
    expect((wrap.children[0] as FakeCanvas).className).not.toContain("off");
    expect((wrap.children[0] as FakeCanvas).style.transform).toBe("translate3d(120px, 80px, 0)");
  });

  it("follows the pointer and leaves when it leaves the stage", () => {
    const cross = make();
    cross.move(10, 10, 0);
    cross.move(44, 300, 16);
    expect((wrap.children[0] as FakeCanvas).style.transform).toBe("translate3d(44px, 300px, 0)");
    cross.setSeen(false);
    expect(cross.shown).toBe(false);
    expect(wrap.dataset.crosshair).toBeUndefined();
  });

  it("fades out after the pointer goes still, and comes back on the next move", () => {
    const cross = make();
    cross.move(10, 10, 0);
    cross.update(CURSOR_IDLE_MS - 1);
    expect(cross.shown).toBe(true);
    cross.update(CURSOR_IDLE_MS + 1);
    expect(cross.shown).toBe(false);
    cross.move(12, 10, CURSOR_IDLE_MS + 20);
    expect(cross.shown).toBe(true);
  });

  it("hides for a gamepad player and while the sketch overlay is open", () => {
    const cross = make();
    cross.move(10, 10, 0);
    cross.setMode("pad");
    expect(cross.shown).toBe(false);
    cross.setMode("key");
    cross.move(10, 11, 10);
    expect(cross.shown).toBe(true);
    cross.setBlocked(true);
    expect(cross.shown).toBe(false);
    cross.setBlocked(false);
    cross.move(10, 12, 20);
    expect(cross.shown).toBe(true);
  });
});

describe("the crosshair drawing", () => {
  it("draws an outlined ring, four ticks and a bright centre dot on a cleared canvas", () => {
    const canvas = new FakeCanvas();
    paintCrosshair(canvas.getContext() as unknown as CanvasRenderingContext2D, CROSSHAIR_SIZE);
    const calls = canvas.calls;
    expect(calls[0]).toBe("clearRect");
    expect(calls.filter((c) => c === "arc")).toHaveLength(2); // dark outline + light ring
    expect(calls.filter((c) => c === "fillRect").length).toBeGreaterThanOrEqual(2); // dark dot behind the bright one
  });
});
