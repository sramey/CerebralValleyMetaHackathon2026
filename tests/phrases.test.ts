// Sketch-mode phrase routing (ADR 0028): saying or typing "let me draw a level" opens the
// sketch overlay with no AI call, while "draw a dragon" still goes to the builder.
import { describe, expect, it } from "vitest";
import { matchPaperIntent, matchSketchIntent, normalizePhrase } from "../src/client/phrases";

describe("sketch phrase matcher", () => {
  it("opens sketch mode from the phrases the bead names", () => {
    for (const text of [
      "let me draw a level",
      "let me draw the level",
      "draw the level",
      "draw a level",
      "sketch",
      "Sketch.",
      "sketch a level",
      "sketch mode",
      "open sketch",
      "start sketching",
      "i want to draw a level",
      "can you let me sketch a level",
      "i'm gonna draw a map",
      "paint this world",
      "draw here",
      "let me draw",
    ]) {
      expect(matchSketchIntent(text), text).toBe("open");
    }
  });

  it("keeps build commands out of sketch mode", () => {
    for (const text of [
      "draw a dragon",
      "draw me a dragon",
      "draw a dragon in the sky",
      "sketch a dragon",
      "draw the player",
      "add a dragon",
      "add a level",
      "make a level with spikes",
      "make it rain",
      "build a tower",
      "add some ground",
      "draw a coin",
      "draw the ninja",
      "sketchy dragon",
      "draw a level with lava",
    ]) {
      expect(matchSketchIntent(text), text).toBeNull();
    }
  });

  it("closes sketch mode on request", () => {
    for (const text of ["cancel sketch", "close the sketch", "exit sketch mode", "stop sketching", "cancel drawing", "leave the level sketch"]) {
      expect(matchSketchIntent(text), text).toBe("close");
    }
  });

  it("ignores case, punctuation and filler words", () => {
    expect(matchSketchIntent("  LET ME DRAW A LEVEL!!  ")).toBe("open");
    expect(matchSketchIntent("ok, so... let me draw a level please")).toBe("open");
    expect(matchSketchIntent("Hey — could you sketch a level for me?")).toBe("open");
    expect(matchSketchIntent("draw the level, thanks")).toBe("open");
  });

  it("never fires on a negation or a rambling sentence", () => {
    expect(matchSketchIntent("don't draw a level")).toBeNull();
    expect(matchSketchIntent("do not open sketch")).toBeNull();
    expect(matchSketchIntent("no sketch")).toBeNull();
    expect(matchSketchIntent("")).toBeNull();
    expect(matchSketchIntent("   ")).toBeNull();
    expect(matchSketchIntent("draw a level and then put a dragon on the tall platform at the end of it")).toBeNull();
  });

  it("normalizes the way the matcher expects", () => {
    expect(normalizePhrase("  Let me draw a level!  ")).toBe("draw a level");
    expect(normalizePhrase("Sketch mode")).toBe("sketch");
    expect(normalizePhrase("Make it rain")).toBe("make it rain");
  });

  it("recognizes paper level drawing commands (ADR 0040)", () => {
    for (const text of [
      "build my drawing",
      "Build my drawing!",
      "can you please build my drawing",
      "build this drawing",
      "build our drawing",
      "make my drawing",
      "scan my drawing",
      "photograph my drawing",
      "build my sketch",
      "build paper drawing",
      "build my paper level",
    ]) {
      expect(matchPaperIntent(text), text).toBe(true);
    }

    for (const text of [
      "build a dragon",
      "draw a level",
      "make it rain",
      "add a player",
      "don't build my drawing",
    ]) {
      expect(matchPaperIntent(text), text).toBe(false);
    }
  });
});
