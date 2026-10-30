// Bug bv4: the "Mood: spooky" card in the drawer used to be rebuilt by hand at each mood call site,
// so a mood undone without a full re-render left it on screen until the next action. The card now
// follows the palette update (`applyMood` -> set), which is the one place a mood changes. There is
// no jsdom in this repo, so the card runs against a minimal fake DOM and the wiring is checked in
// main.ts's source.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createMoodCard, moodCardText } from "../src/client/mood-card";
import type { MoodCard } from "../src/client/mood-card";
import type { MoodSpec } from "../src/contract";

type Listener = () => void;

class FakeEl {
  tag: string;
  id = "";
  className = "";
  textContent = "";
  type = "";
  children: FakeEl[] = [];
  parent: FakeEl | null = null;
  listeners: Record<string, Listener[]> = {};

  constructor(tag: string) { this.tag = tag; }
  appendChild(c: FakeEl): FakeEl { c.parent = this; this.children.push(c); return c; }
  append(...nodes: FakeEl[]): void { for (const n of nodes) this.appendChild(n); }
  insertBefore(node: FakeEl, ref: FakeEl | null): FakeEl {
    const i = ref ? this.children.indexOf(ref) : -1;
    node.parent = this;
    this.children.splice(i < 0 ? this.children.length : i, 0, node);
    return node;
  }
  replaceChildren(...nodes: FakeEl[]): void { for (const c of this.children) c.parent = null; this.children = []; for (const n of nodes) this.appendChild(n); }
  remove(): void {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
  }
  addEventListener(ev: string, fn: Listener): void { (this.listeners[ev] ??= []).push(fn); }
  click(): void { for (const fn of this.listeners.click ?? []) fn(); }
  get parentElement(): FakeEl | null { return this.parent; }
  get firstElementChild(): FakeEl | null { return this.children[0] ?? null; }
  /** Every descendant with this class (the card's head, name and undo button). */
  all(cls: string): FakeEl[] {
    const out: FakeEl[] = [];
    for (const c of this.children) {
      if (c.className.split(" ").includes(cls)) out.push(c);
      out.push(...c.all(cls));
    }
    return out;
  }
}

const SPOOKY = { name: "spooky", anchor: "spooky night" } as MoodSpec;
const NEON = { name: "neon", anchor: "neon night" } as MoodSpec;

let list: FakeEl;
let card: MoodCard;
let undos: number;

/** Stub the two elements a mod card is built from, like the drawer does. */
const otherMod = (title: string): FakeEl => {
  const li = new FakeEl("li");
  const span = new FakeEl("span");
  span.textContent = title;
  li.append(span);
  return li;
};

describe("the mood card follows the palette update (bug bv4)", () => {
  beforeEach(() => {
    (globalThis as unknown as { document: unknown }).document = { createElement: (tag: string) => new FakeEl(tag) };
    list = new FakeEl("ul");
    undos = 0;
    card = createMoodCard(() => { undos++; });
  });

  afterEach(() => { delete (globalThis as unknown as { document?: unknown }).document; });

  it("reads the mood in plain words, and nothing when there is no mood", () => {
    expect(moodCardText(SPOOKY)).toBe("Mood: spooky");
    expect(moodCardText(null)).toBeNull();
    expect(card.text).toBeNull();
  });

  it("shows nothing in an empty world", () => {
    card.mount(list as unknown as HTMLElement);
    expect(list.children).toHaveLength(0);
  });

  it("appears at the top of the list when a mood lands", () => {
    list.append(otherMod("Player"), otherMod("Ground"));
    card.mount(list as unknown as HTMLElement);
    card.set(SPOOKY); // applyMood hands the mood here

    expect(card.text).toBe("Mood: spooky");
    expect(list.children).toHaveLength(3);
    expect(list.children[0].id).toBe("mood-card");
    expect(list.all("mood-name")[0].textContent).toBe("Mood: spooky");
  });

  it("disappears the moment the mood is undone, with no re-render", () => {
    card.mount(list as unknown as HTMLElement);
    card.set(SPOOKY);
    card.set(null); // revertMood -> applyMood(null)

    expect(card.text).toBeNull();
    expect(list.children).toHaveLength(0);
  });

  it("is not left behind as a duplicate after the drawer rebuilds its list", () => {
    card.mount(list as unknown as HTMLElement);
    card.set(SPOOKY);
    list.replaceChildren(otherMod("Player")); // renderMods() clears the list
    card.mount(list as unknown as HTMLElement); // ...and re-homes the card

    expect(list.children).toHaveLength(2);
    expect(list.children.filter((c) => c.id === "mood-card")).toHaveLength(1);
    expect(list.children[0].id).toBe("mood-card");
  });

  it("comes back with the new name on a redo, or a reload into a mood world", () => {
    card.mount(list as unknown as HTMLElement);
    card.set(null);
    card.set(NEON);

    expect(card.text).toBe("Mood: neon");
    expect(list.all("mood-name")[0].textContent).toBe("Mood: neon");
    expect(list.children).toHaveLength(1);
  });

  it("the same mood twice does not add a second card", () => {
    card.mount(list as unknown as HTMLElement);
    card.set(SPOOKY);
    card.set(SPOOKY);
    expect(list.children).toHaveLength(1);
  });

  it("its Undo button asks for the undo", () => {
    card.mount(list as unknown as HTMLElement);
    card.set(SPOOKY);
    list.all("undo")[0].click();
    expect(undos).toBe(1);
  });
});

describe("main.ts wires the card to the palette, not to each call site (bug bv4)", () => {
  const source = readFileSync(join(process.cwd(), "src/client/main.ts"), "utf8");
  const applyMood = (): string => {
    const from = source.indexOf("function applyMood(");
    const to = source.indexOf("function revertMood(");
    expect(from).toBeGreaterThan(-1);
    expect(to).toBeGreaterThan(from);
    return source.slice(from, to);
  };

  it("applyMood is the one update that moves the card", () => {
    expect(applyMood()).toContain("moodCard.set(m)");
  });

  it("no other code formats a mood name for the drawer", () => {
    // The card owns the wording (mood-card.ts); a second reader is how the chip went stale.
    expect(source).not.toContain("`Mood: ${");
  });
});
