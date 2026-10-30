/**
 * The mods drawer (bead r8n): one card per loaded mod, its numeric knobs as sliders, and the
 * actions the client hangs off each card (rate it, undo it).
 *
 * Sliders could not be dragged: every knob change renders the panel (a knob change reloads the
 * mod and the server echoes the tweak back), and the old render emptied the list first, so the
 * `<input type=range>` under the pointer was replaced after the first pixel of travel. Only a
 * click moved a slider, and a click only jumps the thumb once.
 *
 * This panel keeps one `<li>` per mod and one `<input>` per knob across renders and only writes
 * numbers into them, so a drag survives every re-render. While a slider is being dragged its
 * value is not overwritten at all (the echo of our own change must not fight the thumb), and the
 * same goes for a slider the player focused with the keyboard.
 *
 * No DOM beyond `document.createElement` and element properties, so the tests drive it with a
 * tiny fake DOM (there is no jsdom in this repo).
 */
import type { KnobDefs, KnobValues } from "../contract";

/** The parts of a loaded mod the drawer reads. `LoadedMod` fits without a cast. */
export interface PanelMod {
  id: string;
  title: string;
  knobDefs: KnobDefs;
  values: KnobValues;
}

export interface PanelHooks<M extends PanelMod> {
  /** The card's Undo was pressed. */
  onUndo(mod: M): void;
  /** A slider moved: `value` is already a number. */
  onKnob(mod: M, knob: string, value: number): void;
  /** Add the card's extra buttons (rate it) once, when the card is created. */
  decorate?(mod: M, head: HTMLElement): void;
}

export interface ModsPanel<M extends PanelMod> {
  /** Draw (or update) the list for these loaded mods, in load order. Safe to call mid-drag. */
  render(mods: readonly M[]): void;
  /** True while a knob slider is being dragged: nothing may replace it. */
  dragging(): boolean;
}

export const EMPTY_WORLD_TEXT = "Empty world. The orb is waiting.";

interface KnobRow {
  row: HTMLElement;
  range: HTMLInputElement;
  out: HTMLElement;
}

interface ModRow {
  li: HTMLElement;
  name: HTMLElement;
  /** The live mod object, refreshed each render so callbacks never close over a stale one. */
  mod: PanelMod;
  knobs: Map<string, KnobRow>;
}

/** One slider's current value, or null when this knob is not drawn as a slider. */
function numericValue(mod: PanelMod, knob: string): number | null {
  const def = mod.knobDefs[knob];
  const value = mod.values[knob];
  if (!def || typeof def.value !== "number") return null; // booleans and colours have no slider
  return typeof value === "number" && Number.isFinite(value) ? value : def.value;
}

export function createModsPanel<M extends PanelMod>(list: HTMLElement, hooks: PanelHooks<M>): ModsPanel<M> {
  const rows = new Map<string, ModRow>();
  let empty: HTMLElement | null = null;
  /** The slider the player is dragging right now. */
  let held: HTMLInputElement | null = null;
  const doc: Document = list.ownerDocument ?? document;

  const release = (): void => { held = null; };
  // A drag can end anywhere on the page, not only on the thumb.
  doc.addEventListener("pointerup", release);
  doc.addEventListener("pointercancel", release);

  const focused = (el: HTMLInputElement): boolean => (doc.activeElement ?? null) === el;

  const createKnobRow = (row: ModRow, knob: string): KnobRow => {
    const def = row.mod.knobDefs[knob];
    const el = doc.createElement("label");
    el.className = "knob";
    const label = doc.createElement("span");
    label.textContent = def.label ?? knob;
    const range = doc.createElement("input");
    range.type = "range";
    range.min = String(def.min ?? 0);
    range.max = String(def.max ?? 100);
    range.value = String(numericValue(row.mod, knob) ?? 0);
    const out = doc.createElement("output");
    out.textContent = range.value;
    range.addEventListener("input", () => {
      held = range;
      out.textContent = range.value;
      const value = Number(range.value);
      if (Number.isFinite(value)) hooks.onKnob(row.mod as M, knob, value);
    });
    range.addEventListener("pointerdown", () => { held = range; });
    // A change that lands after the pointer is gone (a keyboard arrow) still ends the "held" state.
    range.addEventListener("change", release);
    el.append(label, range, out);
    return { row: el, range, out };
  };

  const createRow = (mod: M): ModRow => {
    const li = doc.createElement("li");
    const head = doc.createElement("div");
    head.className = "title";
    const name = doc.createElement("span");
    head.append(name);
    const undo = doc.createElement("button");
    undo.type = "button";
    undo.className = "undo";
    undo.textContent = "Undo";
    undo.addEventListener("click", () => hooks.onUndo(mod as M));
    head.append(undo);
    hooks.decorate?.(mod as M, head);
    li.append(head);
    return { li, name, mod, knobs: new Map() };
  };

  /** Add, drop and update this mod's sliders without touching the ones already on screen. */
  const syncKnobs = (row: ModRow, mod: M): void => {
    const wanted = new Set(Object.keys(mod.knobDefs).filter((k) => numericValue(mod, k) !== null));
    for (const [knob, kr] of row.knobs) {
      if (wanted.has(knob)) continue;
      kr.row.remove();
      row.knobs.delete(knob);
    }
    for (const knob of wanted) {
      let kr = row.knobs.get(knob);
      if (!kr) {
        kr = createKnobRow(row, knob);
        row.knobs.set(knob, kr);
        row.li.append(kr.row);
      }
      const def = mod.knobDefs[knob];
      kr.range.min = String(def.min ?? 0);
      kr.range.max = String(def.max ?? 100);
      // Never clobber the slider the player is holding (or driving from the keyboard): that is
      // what made the thumb snap back to the old value in the middle of a drag.
      if (kr.range === held || focused(kr.range)) { kr.out.textContent = kr.range.value; continue; }
      const value = numericValue(mod, knob);
      if (value === null) continue;
      kr.range.value = String(value);
      kr.out.textContent = String(value);
    }
  };

  const showEmpty = (): void => {
    if (empty) return;
    empty = doc.createElement("li");
    empty.className = "mods-empty";
    empty.textContent = EMPTY_WORLD_TEXT;
    list.append(empty);
  };

  const hideEmpty = (): void => {
    if (!empty) return;
    empty.remove();
    empty = null;
  };

  return {
    dragging: () => held !== null,
    render(mods) {
      if (mods.length === 0) {
        for (const row of rows.values()) row.li.remove();
        rows.clear();
        showEmpty();
        return;
      }
      hideEmpty();
      const live = new Set(mods.map((m) => m.id));
      for (const [id, row] of rows) {
        if (live.has(id)) continue;
        row.li.remove();
        rows.delete(id);
      }
      for (const mod of mods) {
        let row = rows.get(mod.id);
        if (!row) {
          row = createRow(mod);
          rows.set(mod.id, row);
        }
        row.mod = mod;
        row.name.textContent = mod.title;
        syncKnobs(row, mod);
        // Re-appending in order moves a card to the end without recreating it: the DOM nodes
        // (and any drag in progress) stay the same objects.
        list.append(row.li);
      }
    },
  };
}
