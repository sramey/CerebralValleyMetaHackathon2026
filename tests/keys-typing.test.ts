// Bead wgt: typing a command in the build box must never reach the game, and playing with the
// canvas focused must never type into the box. The decision lives in one predicate (`isGameKeyEvent`
// in src/client/keys.ts) that main.ts and pipeline.ts both use; these tests drive that predicate the
// way the handlers do — a keydown with target=input vs target=body — without a DOM: the handlers only
// read `target` (tagName / isContentEditable) and the modifier flags.
import { describe, expect, it } from "vitest";
import { GAME_KEYS, HOTKEY_CODES, inputFromKeys, isGameKeyEvent, isTypingTarget } from "../src/client/keys";
import type { KeyEventLike } from "../src/client/keys";

const BOX = { tagName: "INPUT" };
const TEXTAREA = { tagName: "TEXTAREA" };
const CONTENTEDITABLE = { tagName: "DIV", isContentEditable: true };
const BODY = { tagName: "BODY" };
const CANVAS = { tagName: "CANVAS" };

/** Stand-in for main.ts's held-key set: it only ever receives events the predicate lets through. */
function press(events: KeyEventLike[]): Set<string> {
  const held = new Set<string>();
  for (const ev of events) {
    if (!isGameKeyEvent(ev)) continue;
    if (ev.code) held.add(ev.code);
  }
  return held;
}

const key = (code: string, target: unknown, mods: Partial<KeyEventLike> = {}): KeyEventLike => ({ code, target, ...mods });
const typing = (codes: string[]): KeyEventLike[] => codes.map((c) => key(c, BOX));
const MOVES = inputFromKeys(new Set());

describe("typing in a text field is not a game command", () => {
  it("takes no game action for a command typed into the box", () => {
    const held = press(typing(["KeyA", "KeyD", "KeyD", "KeyW", "KeyB", "KeyX", "KeyM", "KeyP", "Space"]));
    expect(held.size).toBe(0);
    expect(inputFromKeys(held)).toEqual(MOVES); // no move, no jump, no shoot
  });

  it("mutes on M and fires on B when the game has the keyboard", () => {
    expect(press([key("KeyM", BODY)])).toEqual(new Set(["KeyM"]));
    expect(press([key("KeyB", BODY)]).has("KeyB")).toBe(true);
    expect(inputFromKeys(press([key("KeyB", BODY)])).shoot).toBe(true);
    expect(inputFromKeys(press([key("ArrowRight", BODY)])).right).toBe(true);
  });

  it("never lets a game key or hotkey through from any kind of text field", () => {
    for (const target of [BOX, TEXTAREA, CONTENTEDITABLE]) {
      expect(isTypingTarget(target)).toBe(true);
      for (const code of [...GAME_KEYS, ...HOTKEY_CODES]) {
        expect(isGameKeyEvent(key(code, target))).toBe(false);
      }
    }
  });

  it("also ignores a select and modifier chords, so Cmd/Ctrl+V is a paste and not fire", () => {
    expect(isGameKeyEvent(key("KeyB", { tagName: "SELECT" }))).toBe(false);
    expect(isGameKeyEvent(key("KeyB", BODY, { metaKey: true }))).toBe(false);
    expect(isGameKeyEvent(key("KeyB", BODY, { ctrlKey: true }))).toBe(false);
    expect(isGameKeyEvent(key("KeyB", BODY, { altKey: true }))).toBe(false);
  });
});

describe("playing with the canvas focused never types into the box", () => {
  it("routes canvas and body targets to the game, not to a text field", () => {
    for (const target of [CANVAS, BODY]) {
      expect(isTypingTarget(target)).toBe(false);
      expect(isGameKeyEvent(key("KeyW", target))).toBe(true);
    }
  });

  it("keeps the two sides disjoint: an event one takes the other cannot", () => {
    for (const target of [BOX, TEXTAREA, CONTENTEDITABLE, BODY, CANVAS, null]) {
      const game = isGameKeyEvent({ code: "KeyB", target });
      const text = isTypingTarget(target);
      expect(game && text).toBe(false);
    }
  });
});

describe("focus changes never carry a held key into typing", () => {
  /** Mirror of main.ts's focusin handler: a text field taking focus drops every held game key. */
  function focusIn(held: Set<string>, target: unknown): Set<string> {
    if (isTypingTarget(target) && held.size > 0) held.clear();
    return held;
  }

  it("drops a key held from the game the moment the box takes focus", () => {
    const held = press([key("KeyD", BODY), key("ArrowDown", BODY)]);
    expect(inputFromKeys(held).right).toBe(true);
    expect(focusIn(held, BOX).size).toBe(0);
    expect(inputFromKeys(focusIn(new Set(["KeyD"]), BOX)).right).toBe(false);
  });

  it("leaves the held set alone when focus moves to another non-text element", () => {
    expect(focusIn(new Set(["KeyD"]), CANVAS)).toEqual(new Set(["KeyD"]));
  });

  it("keyup is deliberately not filtered, so a key held from before focus moved still ends", () => {
    // The box filters keydown only: main.ts deletes the code on every keyup whatever its target, so
    // switching focus mid-run cannot leave the player running. isGameKeyEvent calls this a typing
    // event — which is exactly why the keyup handler does not ask it.
    expect(isGameKeyEvent(key("KeyD", BOX))).toBe(false);
    const held = new Set(["KeyD"]);
    held.delete("KeyD"); // what the unfiltered keyup does
    expect(inputFromKeys(held).right).toBe(false);
  });
});
