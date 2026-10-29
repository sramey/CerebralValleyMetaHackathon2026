// The two answers "How does this work?" gives without a model (ADR 0043): an engine-owned
// object, and a page whose server is not connected. Both must read like the AI answer (three
// short sentences) so a family demo never falls back to a blank card or an error.
import { describe, expect, it } from "vitest";
import { ENGINE_SAY, OFFLINE_SAY } from "../src/client/explain";

/** Three sentences, like every explanation: no word wall on the card. */
function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
}

describe("explain: the local answers", () => {
  it("each says what happened in three short sentences", () => {
    for (const text of [ENGINE_SAY, OFFLINE_SAY]) {
      const parts = sentences(text);
      expect(parts).toHaveLength(3);
      for (const s of parts) expect(s.split(" ").length).toBeLessThanOrEqual(30);
    }
  });

  it("names the engine plainly and never blames the player", () => {
    expect(ENGINE_SAY).toMatch(/engine/i);
    expect(ENGINE_SAY).toMatch(/mod/i);
    expect(OFFLINE_SAY).toMatch(/server/i);
    expect(OFFLINE_SAY).not.toMatch(/error|failed|invalid/i);
  });
});
