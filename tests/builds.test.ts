// Beat 3 (bead fyf): "add a dragon, some coins, and make it rain" splits into three
// builds, and on camera they have to read as three cards side by side. There is no
// jsdom in this repo, so this test drives builds.ts through a minimal fake DOM and
// checks the row contract in builds.css arithmetically: the widths for a given chip
// count add up to exactly the container (gaps included), so nothing wraps at the
// rail's real width and every card is the same width.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createBuilds } from "../src/client/builds";
import type { Builds } from "../src/client/builds";

class FakeEl {
  tag: string;
  className = "";
  title = "";
  dataset: Record<string, string> = {};
  attrs: Record<string, string> = {};
  textContent = "";
  children: FakeEl[] = [];
  parent: FakeEl | null = null;

  constructor(tag: string) { this.tag = tag; }
  appendChild(c: FakeEl): FakeEl { c.parent = this; this.children.push(c); return c; }
  append(...nodes: FakeEl[]): void { for (const n of nodes) this.appendChild(n); }
  insertBefore(node: FakeEl, ref: FakeEl | null): FakeEl {
    if (!ref) return this.appendChild(node);
    const i = this.children.indexOf(ref);
    node.parent = this;
    this.children.splice(i < 0 ? this.children.length : i, 0, node);
    return node;
  }
  get nextSibling(): FakeEl | null {
    if (!this.parent) return null;
    const i = this.parent.children.indexOf(this);
    return this.parent.children[i + 1] ?? null;
  }
  get parentElement(): FakeEl | null { return this.parent; }
  closest(selector: string): FakeEl | null {
    const id = selector.startsWith("#") ? selector.slice(1) : "";
    let n: FakeEl | null = this;
    while (n) {
      if (n.attrs.id === id) return n;
      n = n.parent;
    }
    return null;
  }
  replaceChildren(...nodes: FakeEl[]): void {
    for (const c of this.children) c.parent = null;
    this.children = [];
    for (const n of nodes) this.appendChild(n);
  }
  remove(): void {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
  }
  setAttribute(k: string, v: string): void { this.attrs[k] = v; }
  getAttribute(k: string): string | undefined { return this.attrs[k]; }
  /** Every descendant whose class list contains `cls`. */
  all(cls: string): FakeEl[] {
    const out: FakeEl[] = [];
    for (const c of this.children) {
      if (c.className.split(" ").includes(cls)) out.push(c);
      out.push(...c.all(cls));
    }
    return out;
  }
}

// The row spans the rail: 340 px wide, 18 px padding a side -> 304 px for the cards
// (a scrollbar only takes ~15 of it). The rail is 340 px at 1280x720 and at 1920x1080
// alike, so one number covers both demo screens.
const RAIL_CONTENT = 340 - 18 * 2;
const CHIP_COL = RAIL_CONTENT;

const css = readFileSync(join(process.cwd(), "src/client/builds.css"), "utf8");
const rule = (selector: string): string => {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");
  const m = css.match(new RegExp(`${esc}\\s*\\{([^}]*)\\}`));
  if (!m) throw new Error(`no rule for ${selector}`);
  return m[1];
};
const gapPx = (): number => Number(rule(".builds").match(/gap:\s*(\d+)px/)?.[1]);
const minWidthPx = (): number => Number(rule(".builds-chip").match(/min-width:\s*(\d+)px/)?.[1]);

/** `calc(33.333% - 4px)` -> (container) => width. */
const basisOf = (decl: string): ((w: number) => number) => {
  const calc = decl.match(/calc\(([^)]*)\)/)?.[1] ?? decl;
  const pct = calc.match(/([\d.]+)%/);
  const sub = calc.match(/-\s*([\d.]+)px/);
  if (!pct) throw new Error(`no percentage in ${decl}`);
  const share = Number(pct[1]) / 100;
  const shrink = sub ? Number(sub[1]) : 0;
  return (w) => w * share - shrink;
};

describe("parallel build chips sit in one row (bead fyf)", () => {
  let host: FakeEl;
  let builds: Builds;

  // The list element builds.ts mounts under the orb.
  const list = (): FakeEl => host.children[0];
  const chips = (): FakeEl[] => list().children;
  const part = (chip: FakeEl, cls: string): FakeEl | undefined => chip.all(cls)[0];

  beforeEach(() => {
    vi.useFakeTimers();
    (globalThis as unknown as { window: unknown }).window = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
    (globalThis as unknown as { document: unknown }).document = { createElement: (tag: string) => new FakeEl(tag) };
    host = new FakeEl("div");
    builds = createBuilds(host as unknown as HTMLElement, () => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as unknown as { window?: unknown }).window;
    delete (globalThis as unknown as { document?: unknown }).document;
  });

  it("renders three concurrent builds as three equal cards in one row", () => {
    // Drive builds.stage() directly, exactly as server stage messages would.
    builds.stage("add a dragon", "routing", "routing your command");
    builds.stage("add some coins", "routing", "routing your command");
    builds.stage("add rain effect", "routing", "routing your command");

    expect(chips()).toHaveLength(3);
    expect(list().dataset.count).toBe("3");

    // Three per row: the declared basis plus two gaps must fill, not overflow, the column.
    const gap = gapPx();
    const basis = basisOf(rule('.builds[data-count="3"] .builds-chip'));
    const width = basis(CHIP_COL);
    expect(3 * width + 2 * gap).toBeCloseTo(CHIP_COL, 2);
    expect(width).toBeGreaterThan(minWidthPx() + 8); // a rail scrollbar still leaves three in one row
    expect(width).toBeGreaterThan(64); // still a card, not a sliver
  });

  it("mounts the row under the orb row, so three cards get the whole rail", () => {
    const rail = new FakeEl("aside");
    rail.setAttribute("id", "rail");
    const orbRow = new FakeEl("section");
    orbRow.setAttribute("id", "orb-row");
    const column = new FakeEl("div");
    const say = new FakeEl("div");
    column.appendChild(say);
    orbRow.append(new FakeEl("div"), column);
    const form = new FakeEl("form");
    rail.append(new FakeEl("header"), orbRow, form);

    createBuilds(say as unknown as HTMLElement, () => {});

    // Right after the orb row, a full-width block in the rail (not inside the column).
    expect(rail.children[2].className).toBe("builds");
    expect(rail.children[3]).toBe(form);
    expect(column.all("builds")).toHaveLength(0);
  });

  it("gives every chip the same width rule, so unequal names stay a tidy row", () => {
    builds.stage("add a dragon", "routing", "routing your command");
    builds.stage("add some coins", "routing", "routing your command");
    builds.stage("add rain effect", "routing", "routing your command");
    // All three are children of the same list, matched by the same [data-count] rule:
    // one shared flex-basis, so the row is even regardless of command length.
    for (const chip of chips()) expect(chip.className.split(" ")).toContain("builds-chip");
    expect(chips().map((c) => part(c, "builds-name")?.textContent)).toEqual([
      "add a dragon",
      "add some coins",
      "add rain effect",
    ]);
  });

  it("wraps four concurrent builds into equal pairs instead of slivers", () => {
    for (const c of ["add a dragon", "add some coins", "add rain effect", "add a slime"]) {
      builds.stage(c, "routing", "routing your command");
    }
    expect(list().dataset.count).toBe("4");
    const gap = gapPx();
    const pair = basisOf(rule(".builds-chip"));
    expect(2 * pair(CHIP_COL) + gap).toBeCloseTo(CHIP_COL, 2);
    expect(pair(CHIP_COL)).toBeGreaterThan(minWidthPx());
    expect(pair(CHIP_COL)).toBeGreaterThan(CHIP_COL / 3); // two per row, not four
  });

  it("keeps each chip's own stage trail and the stage in flight", () => {
    builds.stage("add a dragon", "routing", "routing");
    builds.stage("add some coins", "routing", "routing");
    builds.stage("add rain effect", "routing", "routing");
    builds.stage("add a dragon", "writing", "writing the mod");
    builds.stage("add a dragon", "verifying", "verifying the mod");
    builds.stage("add some coins", "done", "loaded coins");

    const [dragon, coins, rain] = chips();
    // Dragon is mid-build: its trail shows the stage it is in, not the row's.
    expect(part(dragon, "builds-stage")?.textContent).toBe("verifying");
    expect(dragon.all("builds-dot")).toHaveLength(3);
    // Coins landed, yet its chip keeps its own short trail before it fades.
    expect(part(coins, "builds-stage")?.textContent).toBe("live");
    expect(coins.all("builds-dot")).toHaveLength(2);
    // Rain never moved past routing.
    expect(part(rain, "builds-stage")?.textContent).toBe("routing");
    expect(rain.all("builds-dot")).toHaveLength(1);
    // The trail also rides on the chip for screen readers and hover.
    expect(dragon.getAttribute("aria-label")).toBe("add a dragon: routing › writing › verifying");
  });

  it("still counts three things at once for the orb headline", () => {
    builds.stage("add a dragon", "routing", "routing");
    builds.stage("add some coins", "routing", "routing");
    builds.stage("add rain effect", "routing", "routing");
    expect(builds.active()).toBe(3);
    expect(builds.headline()).toContain("3 things at once");
  });

  it("drops a settled chip from the row and the count", () => {
    builds.stage("add a dragon", "routing", "routing");
    builds.stage("add some coins", "routing", "routing");
    builds.stage("add rain effect", "routing", "routing");
    builds.finish("add some coins");
    builds.finish("add rain effect");
    builds.finish("add a dragon");
    expect(chips()).toHaveLength(3); // lingers while the last outcome reads
    vi.advanceTimersByTime(2600);
    expect(chips()).toHaveLength(0);
    expect(list().dataset.count).toBe("0");
    expect(builds.active()).toBe(0);
  });

  it("keeps the text readable on a 720p recording", () => {
    // The name truncates rather than pushing the row; the current stage stays a word,
    // so progress is legible without hovering.
    expect(rule(".builds-name")).toMatch(/text-overflow:\s*ellipsis/);
    expect(Number(rule(".builds-chip").match(/font-size:\s*([\d.]+)px/)?.[1])).toBeGreaterThanOrEqual(11);
    expect(Number(rule(".builds-trail").match(/font-size:\s*([\d.]+)px/)?.[1])).toBeGreaterThanOrEqual(10);
  });
});
