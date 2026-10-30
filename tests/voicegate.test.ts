import { describe, expect, it } from "vitest";
import { HOLD_MAX_MS, shiftStillHeld, voiceShouldReprompt, voiceTextOk, wordsOf } from "../src/client/voicegate";

describe("voice gating (bug ahv)", () => {
  it("ignores empty and lone stray words from room audio", () => {
    for (const t of ["", "  ", "the", "d", "uh", "okay", "..."]) expect(voiceTextOk(t)).toBe(false);
  });
  it("accepts real commands and the known one-word ones", () => {
    for (const t of ["add a dragon", "make it rain", "Undo", "undo.", "spooky"]) expect(voiceTextOk(t)).toBe(true);
  });
  it("counts words ignoring punctuation and case", () => {
    expect(wordsOf("Let me, shoot fireballs.")).toEqual(["let", "me", "shoot", "fireballs"]);
  });
  it("treats a key event without Shift as a lost keyup", () => {
    expect(shiftStillHeld({ shiftKey: true })).toBe(true);
    expect(shiftStillHeld({ shiftKey: false })).toBe(false);
  });
  it("caps a hold well above a real utterance but far below a stuck key", () => {
    expect(HOLD_MAX_MS).toBeGreaterThanOrEqual(10_000);
    expect(HOLD_MAX_MS).toBeLessThanOrEqual(30_000);
  });
  it("reprompts only when speech was detected but not recognized as a command (bug 9b7)", () => {
    // Empty transcripts / silence with no mic input must never reprompt
    for (const t of ["", "  ", "...", "!?", "   \n\t  "]) expect(voiceShouldReprompt(t)).toBe(false);
    // Real speech attempts that failed command validation should reprompt
    for (const t of ["the", "d", "uh", "okay", "banana"]) expect(voiceShouldReprompt(t)).toBe(true);
    // Accepted commands should not reprompt
    for (const t of ["add a dragon", "make it rain", "spooky"]) expect(voiceShouldReprompt(t)).toBe(false);
  });
});
