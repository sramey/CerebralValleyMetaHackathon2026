// The knob sliders could not be dragged (bead r8n): every knob change rendered the drawer, and
// the old render emptied the list and rebuilt the cards, so the <input type=range> under the
// pointer was replaced after the first pixel of travel. The panel now keeps its DOM. There is no
// jsdom in this repo, so this drives it with a minimal fake DOM.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EMPTY_WORLD_TEXT, createModsPanel } from "../src/client/mods-panel";
import type { PanelMod } from "../src/client/mods-panel";

type Listener = (ev?: unknown) => void;

class FakeEl {
  tag: string;
  className = "";
  id = "";
  textContent = "";
  type = "";
  min = "";
  max = "";
  value = "";
  children: FakeEl[] = [];
  parent: FakeEl | null = null;
  listeners: Record<string, Listener[]> = {};
  ownerDocument: FakeDoc | null = null;

  constructor(tag: string) { this.tag = tag; }
  /** Real DOM semantics: appending an existing node moves it, it never duplicates it. */
  appendChild(c: FakeEl): FakeEl {
    if (c.parent) c.parent.children = c.parent.children.filter((x) => x !== c);
    c.parent = this;
    this.children.push(c);
    return c;
  }
  append(...nodes: FakeEl[]): void { for (const n of nodes) this.appendChild(n); }
  remove(): void {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
  }
  addEventListener(ev: string, fn: Listener): void { (this.listeners[ev] ??= []).push(fn); }
  fire(ev: string): void { for (const fn of this.listeners[ev] ?? []) fn(); }
  get parentElement(): FakeEl | null { return this.parent; }
  all(tag: string): FakeEl[] {
    const out: FakeEl[] = [];
    for (const c of this.children) { if (c.tag === tag) out.push(c); out.push(...c.all(tag)); }
    return out;
  }
  /** Every descendant input with this `value`. */
  inputs(): FakeEl[] { return this.all("input"); }
}

class FakeDoc {
  activeElement: FakeEl | null = null;
  listeners: Record<string, Listener[]> = {};
  createElement(tag: string): FakeEl {
    const el = new FakeEl(tag);
    el.ownerDocument = this;
    return el;
  }
  addEventListener(ev: string, fn: Listener): void { (this.listeners[ev] ??= []).push(fn); }
  fire(ev: string): void { for (const fn of this.listeners[ev] ?? []) fn(); }
}

const meteors = (rate: number): PanelMod => ({
  id: "meteors",
  title: "Meteors",
  knobDefs: {
    rate: { value: 28, min: 8, max: 120, label: "Ticks between meteors" },
    size: { value: 34, min: 16, max: 80, label: "Meteor size" },
    burning: { value: true, label: "Burning trail" },
  },
  values: { rate, size: 34, burning: true },
});

let doc: FakeDoc;
let list: FakeEl;
let knobs: Array<{ modId: string; knob: string; value: number }>;
let undos: string[];
let panel: ReturnType<typeof createModsPanel<PanelMod>>;

beforeEach(() => {
  doc = new FakeDoc();
  (globalThis as unknown as { document: unknown }).document = doc;
  list = doc.createElement("ul");
  knobs = [];
  undos = [];
  panel = createModsPanel<PanelMod>(list as unknown as HTMLElement, {
    onUndo: (mod) => undos.push(mod.id),
    onKnob: (mod, knob, value) => knobs.push({ modId: mod.id, knob, value }),
    decorate: (mod, head) => {
      const rate = doc.createElement("button");
      rate.className = "mod-rate";
      rate.addEventListener("click", () => { /* rate it */ });
      head.append(rate as unknown as Node);
    },
  });
});

afterEach(() => { delete (globalThis as unknown as { document?: unknown }).document; });

/** The slider for a knob on a card, found by the label next to it. */
const slider = (title: string, label: string): FakeEl => {
  const card = list.children.find((c) => c.all("span").some((s) => s.textContent === title))!;
  const row = card.all("label").find((l) => l.children[0]?.textContent === label)!;
  return row.children[1];
};

describe("the mods drawer", () => {
  it("shows one card per mod, one slider per numeric knob, and the empty-world line", () => {
    panel.render([]);
    expect(list.children).toHaveLength(1);
    expect(list.children[0].textContent).toBe(EMPTY_WORLD_TEXT);

    panel.render([meteors(28)]);
    expect(list.children).toHaveLength(1); // the empty line is gone
    expect(list.all("input")).toHaveLength(2); // rate + size, not the boolean "burning"
    expect(slider("Meteors", "Ticks between meteors").value).toBe("28");
    expect(slider("Meteors", "Ticks between meteors").max).toBe("120");
  });

  it("keeps the very same slider node across renders, so a drag is not interrupted", () => {
    panel.render([meteors(28)]);
    const rate = slider("Meteors", "Ticks between meteors");
    rate.fire("pointerdown");
    rate.value = "60";
    rate.fire("input");
    expect(knobs).toEqual([{ modId: "meteors", knob: "rate", value: 60 }]);

    // What the client does on every knob tick: the mod reloads and the drawer re-renders.
    // The echo of our own change must not snap the thumb back to the old value.
    panel.render([meteors(28)]);
    const again = slider("Meteors", "Ticks between meteors");
    expect(again).toBe(rate);
    expect(again.value).toBe("60");
  });

  it("reports a drag in progress and lets go on pointerup", () => {
    panel.render([meteors(28)]);
    const rate = slider("Meteors", "Ticks between meteors");
    expect(panel.dragging()).toBe(false);
    rate.fire("pointerdown");
    expect(panel.dragging()).toBe(true);
    doc.fire("pointerup");
    expect(panel.dragging()).toBe(false);

    // After the drag, a render from the server (a clamped value) does update the slider.
    panel.render([meteors(96)]);
    expect(slider("Meteors", "Ticks between meteors").value).toBe("96");
  });

  it("does not overwrite a slider the player is driving from the keyboard", () => {
    panel.render([meteors(28)]);
    const rate = slider("Meteors", "Ticks between meteors");
    // Focused (arrows work on it) but no render-time value may clobber it.
    doc.activeElement = rate;
    rate.value = "44";
    panel.render([meteors(28)]);
    expect(rate.value).toBe("44");
    doc.activeElement = null;
    panel.render([meteors(12)]);
    expect(rate.value).toBe("12");
  });

  it("updates a title, adds a knob that appeared and drops one that went away, in place", () => {
    panel.render([meteors(28)]);
    const rate = slider("Meteors", "Ticks between meteors");
    const grown: PanelMod = {
      ...meteors(28),
      title: "Meteors!",
      knobDefs: { ...meteors(28).knobDefs, wind: { value: 0, min: -300, max: 300, label: "Wind" } },
      values: { ...meteors(28).values, wind: 0 },
    };
    panel.render([grown]);
    expect(list.all("input")).toHaveLength(3);
    expect(slider("Meteors!", "Ticks between meteors")).toBe(rate);

    const shrunk: PanelMod = { ...grown, knobDefs: { rate: grown.knobDefs.rate } };
    panel.render([shrunk]);
    expect(list.all("input")).toHaveLength(1);
  });

  it("keeps load order and drops a card whose mod was undone", () => {
    const ground: PanelMod = { id: "ground", title: "Ground", knobDefs: { width: { value: 2400, min: 600, max: 6000, label: "Ground width" } }, values: { width: 2400 } };
    panel.render([ground, meteors(28)]);
    expect(list.children.map((c) => c.all("span")[0].textContent)).toEqual(["Ground", "Meteors"]);
    panel.render([meteors(28), ground]);
    expect(list.children.map((c) => c.all("span")[0].textContent)).toEqual(["Meteors", "Ground"]);
    panel.render([ground]);
    expect(list.children).toHaveLength(1);
  });

  it("asks for undo when a card's button is pressed, and hangs the extra actions on the card", () => {
    panel.render([meteors(28)]);
    const card = list.children[0];
    expect(card.all("button").some((b) => b.className === "mod-rate")).toBe(true);
    card.all("button").find((b) => b.className === "undo")!.fire("click");
    expect(undos).toEqual(["meteors"]);
  });
});
