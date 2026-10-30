/**
 * The "Mood: <name>" card in the mods drawer (ADR 0017). It follows the palette: `applyMood` is the
 * one place a mood changes, and it hands every change to `set()` (bug bv4). The card used to be
 * rebuilt by hand at each mood call site, so a mood undone without a full re-render — and any future
 * caller that forgets `renderMods()` — left a stale chip on screen until the next action.
 *
 * The DOM is kept to one `<li>`: `mount()` only re-homes it after the drawer rebuilt its list,
 * `set()` alone is enough for it to appear, update or vanish.
 */
import type { MoodSpec } from "../contract";

export interface MoodCard {
  /** The card's text, or null when no mood is on (nothing to show). */
  readonly text: string | null;
  /** Follow the palette update: call from `applyMood` with the mood that is now on (null = none). */
  set(mood: MoodSpec | null): void;
  /** (Re)mount the card at the top of a mods list the caller just cleared, if a mood is on. */
  mount(list: HTMLElement): void;
}

/** What the card reads: the mood's name in plain words, or nothing at all. */
export const moodCardText = (mood: MoodSpec | null): string | null => (mood ? `Mood: ${mood.name}` : null);

export function createMoodCard(onUndo: () => void): MoodCard {
  const li = document.createElement("li");
  li.id = "mood-card";
  const head = document.createElement("div");
  head.className = "title";
  const name = document.createElement("span");
  name.className = "mood-name";
  const undo = document.createElement("button");
  undo.type = "button";
  undo.className = "undo";
  undo.textContent = "Undo";
  undo.addEventListener("click", () => onUndo());
  head.append(name, undo);
  li.appendChild(head);

  let text: string | null = null;
  let list: HTMLElement | null = null;

  const place = (): void => {
    if (!list) return;
    if (!text) { li.remove(); return; }
    if (li.parentElement !== list) list.insertBefore(li, list.firstElementChild ?? null);
  };

  return {
    get text() { return text; },
    set(mood) {
      text = moodCardText(mood);
      name.textContent = text ?? "";
      place();
    },
    mount(next) {
      list = next;
      place();
    },
  };
}
