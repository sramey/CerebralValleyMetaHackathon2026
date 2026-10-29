// "How does this work?" (ADR 0043). The model is always injected, so the whole suite is
// headless and free: what is under test is the prompt, the reply parser (which must never
// trust a line number), the per-source cache, and the promise that a cache hit spends nothing.
import { describe, expect, it } from "vitest";
import { Budget } from "../server/budget";
import {
  cachedExplanation,
  ExplainCache,
  explainMessages,
  explainMod,
  keyLines,
  lineText,
  looseSay,
  MAX_LINE_CHARS,
  MAX_SENTENCES,
  MAX_SOURCE_CHARS,
  normaliseSay,
  numberedSource,
  parseExplanation,
  sourceHash,
  type Ask,
} from "../server/explain";

const SOURCE = [
  'import type { ModDefinition } from "../contract";',
  "",
  "export default {",
  '  id: "coin-shower",',
  '  title: "Coin Shower",',
  '  knobs: { rate: { value: 2, min: 1, max: 8, label: "Coins per second" } },',
  "  setup(api, knobs) {",
  "    api.onTick(() => {",
  "      const every = Math.round(60 / Number(knobs.rate));",
  "      if (api.tick() % every !== 0) return;",
  '      api.spawn({ type: "coin", x: 0, y: 0, w: 12, h: 12 });',
  "    });",
  "  },",
  "  dispose() {},",
  "};",
].join("\n");

/** A mock Spark that answers with `text` and counts the calls it got. */
function mockAsk(text: string): Ask & { calls: number; last?: string } {
  const ask = (async (messages: { content: unknown }[]) => {
    ask.calls++;
    ask.last = JSON.stringify(messages[messages.length - 1].content);
    return { text, ms: 870 };
  }) as unknown as Ask & { calls: number; last?: string };
  ask.calls = 0;
  return ask;
}

const GOOD = JSON.stringify({ say: "This mod rains coins out of the sky. It drops one coin every time a timer ticks over. Try changing rate to 8 to make it pour.", lines: [9, 11, 6] });

describe("explain: the prompt", () => {
  it("numbers the source so the model can point at real lines", () => {
    const numbered = numberedSource(SOURCE);
    const rows = numbered.split("\n");
    expect(rows[0]).toBe(`1: ${SOURCE.split("\n")[0]}`);
    expect(rows[8]).toBe(`9:       const every = Math.round(60 / Number(knobs.rate));`);
  });

  it("cuts a huge source but keeps the true line numbers", () => {
    const big = Array.from({ length: 4000 }, (_, i) => `const v${i} = ${i};`).join("\n");
    const numbered = numberedSource(big);
    expect(numbered.length).toBeLessThanOrEqual(MAX_SOURCE_CHARS + 200);
    expect(numbered).toMatch(/\(\d+ more lines not shown\)$/);
    const lastRow = numbered.split("\n").at(-1)!;
    // The truncation notice names a real line number, not a restarted count.
    const n = Number(lastRow.slice(0, lastRow.indexOf(":")));
    expect(n).toBeGreaterThan(100);
    expect(lineText(big, n - 1)).toBe(`const v${n - 2} = ${n - 2};`);
  });

  it("asks for a title, three sentences and three JSON line numbers", () => {
    const messages = explainMessages("Coin Shower", SOURCE);
    expect(messages[0].role).toBe("system");
    expect(String(messages[0].content)).toMatch(/three sentences/i);
    expect(String(messages[0].content)).toMatch(/What this thing does/i);
    expect(String(messages[1].content)).toContain("Coin Shower");
    expect(String(messages[1].content)).toContain("11: ");
  });

  it("falls back to a generic name and trims a silly title", () => {
    expect(String(explainMessages("   ", SOURCE)[1].content)).toContain("Mod: this mod");
    expect(explainMessages("x".repeat(500), SOURCE)[1].content).not.toContain("x".repeat(200));
  });
});

describe("explain: replies are cut down to kid size", () => {
  it("keeps exactly three sentences and drops markdown", () => {
    const text = normaliseSay("**One.** Two! Three? Four. Five.");
    expect(text).toBe("One. Two! Three?");
    expect(normaliseSay("```json\n{ nope }\n```")).toBe("");
  });

  it("keeps a single long sentence rather than cutting it in half", () => {
    const one = "This mod builds a whole staircase out of blocks and then knocks it down again after three seconds of play so you can watch it happen";
    expect(normaliseSay(one)).toBe(`${one}.`);
  });

  it("is capped at three sentences by MAX_SENTENCES", () => {
    expect(MAX_SENTENCES).toBe(3);
    expect(normaliseSay("a. b. c. d.").split(".").filter(Boolean)).toHaveLength(3);
  });
});

describe("explain: the parser never trusts a line number", () => {
  it("reads a good reply and sorts the lines", () => {
    const parsed = parseExplanation(GOOD, SOURCE);
    expect(parsed?.text).toMatch(/^This mod rains coins/);
    expect(parsed?.lines.map((l) => l.n)).toEqual([6, 9, 11]);
    expect(parsed?.lines[1].code).toBe(lineText(SOURCE, 9));
    expect(parsed?.lines[0].code.trim().startsWith("knobs:")).toBe(true);
  });

  it("drops numbers outside the file, duplicates and junk, then fills from the heuristic", () => {
    const parsed = parseExplanation(JSON.stringify({ say: "It works. It is fun. Change it.", lines: [999, 0, -4, 11, 11, "x", null] }), SOURCE);
    expect(parsed).not.toBeNull();
    const ns = parsed!.lines.map((l) => l.n);
    expect(ns).toHaveLength(MAX_SENTENCES);
    expect(ns).toContain(11);
    for (const n of ns) {
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(SOURCE.split("\n").length);
    }
    expect(new Set(ns).size).toBe(ns.length);
  });

  it("accepts a numeric string line number (models do that)", () => {
    // Two usable numbers plus one filled from the heuristic: the code view is always three lines.
    const parsed = parseExplanation(JSON.stringify({ say: "One. Two. Three.", lines: ["7", "9"] }), SOURCE);
    expect(parsed?.lines.map((l) => l.n)).toEqual([6, 7, 9]);
  });

  it("still answers when the model replies in prose instead of JSON", () => {
    const parsed = parseExplanation("This mod makes coins rain. It uses a timer. Try a bigger rate.", SOURCE);
    expect(parsed?.text).toBe("This mod makes coins rain. It uses a timer. Try a bigger rate.");
    expect(parsed?.lines.length).toBeGreaterThan(0);
  });

  it("rescues the words out of a truncated JSON reply", () => {
    const cut = '{"say": "This mod makes coins rain down. It uses a timer to do it. Try a bigger rate';
    expect(looseSay(cut)).toBe("This mod makes coins rain down. It uses a timer to do it. Try a bigger rate");
    expect(parseExplanation(`${cut}, "lines": [9`, SOURCE)?.text).toMatch(/^This mod makes coins rain/);
  });

  it("returns null when the model said nothing at all", () => {
    expect(parseExplanation("", SOURCE)).toBeNull();
    expect(parseExplanation("{}", SOURCE)).toBeNull();
    expect(parseExplanation('{"say": "   ", "lines": [9]}', SOURCE)).toBeNull();
  });

  it("takes the words from a renamed field instead of dropping a usable answer", () => {
    const parsed = parseExplanation(JSON.stringify({ text: "It rains. It ticks. Change the rate.", lines: [9] }), SOURCE);
    expect(parsed?.text).toBe("It rains. It ticks. Change the rate.");
  });
});

describe("explain: the deterministic key lines", () => {
  it("picks what it creates, what it does each tick and what the player can tune", () => {
    const picked = keyLines(SOURCE);
    expect(picked).toHaveLength(MAX_SENTENCES);
    const texts = picked.map((n) => lineText(SOURCE, n));
    expect(texts.some((t) => t.includes("api.spawn("))).toBe(true);
    expect(texts.some((t) => t.includes("onTick("))).toBe(true);
    expect(texts.some((t) => t.includes("knobs:"))).toBe(true);
  });

  it("is deterministic and always returns real lines", () => {
    expect(keyLines(SOURCE)).toEqual(keyLines(SOURCE));
    for (const n of keyLines(SOURCE)) expect(lineText(SOURCE, n).length).toBeGreaterThan(0);
  });

  it("handles a source with no code in it without throwing", () => {
    expect(keyLines("")).toEqual([]);
    expect(keyLines("\n\n.tooLong ".repeat(1)).length).toBeLessThanOrEqual(MAX_SENTENCES);
    expect(lineText("", 4)).toBe("");
  });

  it("cuts one absurdly long line in the code view", () => {
    const long = `const x = "${"a".repeat(MAX_LINE_CHARS * 2)}";`;
    expect(lineText(long, 1).length).toBeLessThanOrEqual(MAX_LINE_CHARS + 1);
  });
});

describe("explain: one model call per source", () => {
  it("keys the cache by a hash of the source, and a rebuilt mod misses", () => {
    expect(sourceHash(SOURCE)).toBe(sourceHash(SOURCE));
    expect(sourceHash(SOURCE)).toHaveLength(16);
    expect(sourceHash(`${SOURCE} `)).not.toBe(sourceHash(SOURCE));
  });

  it("calls Spark once, then answers from the cache for free", async () => {
    const cache = new ExplainCache(8);
    const ask = mockAsk(GOOD);
    const first = await explainMod({ source: SOURCE, title: "Coin Shower", ask, cache });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.explanation.cached).toBe(false);
    expect(first.explanation.ms).toBe(870);
    expect(ask.calls).toBe(1);
    expect(ask.last).toContain("Coin Shower");

    const second = await explainMod({ source: SOURCE, title: "Coin Shower", ask, cache });
    expect(ask.calls).toBe(1);
    if (second.ok) {
      expect(second.explanation.cached).toBe(true);
      expect(second.explanation.ms).toBe(0);
      expect(second.explanation.text).toBe(first.explanation.text);
    }
    expect(cachedExplanation(SOURCE, cache)?.cached).toBe(true);
  });

  it("caches nothing when the reply is empty or the call fails", async () => {
    const cache = new ExplainCache(8);
    const empty = await explainMod({ source: SOURCE, title: "t", ask: mockAsk(""), cache });
    expect(empty).toEqual({ ok: false, why: "empty" });
    expect(cachedExplanation(SOURCE, cache)).toBeUndefined();

    const boom: Ask = async () => { throw new Error("Meta API 500"); };
    const failed = await explainMod({ source: SOURCE, title: "t", ask: boom, cache });
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.why).toBe("error");
    expect(cachedExplanation(SOURCE, cache)).toBeUndefined();
  });

  it("keeps the cache bounded (least recently used goes first)", async () => {
    const cache = new ExplainCache(2);
    const ask = mockAsk(GOOD);
    await explainMod({ source: "a", title: "a", ask, cache });
    await explainMod({ source: "b", title: "b", ask, cache });
    expect(cachedExplanation("a", cache)).toBeDefined(); // freshens "a"
    await explainMod({ source: "c", title: "c", ask, cache });
    expect(cache.size()).toBe(2);
    expect(cachedExplanation("b", cache)).toBeUndefined();
    expect(cachedExplanation("a", cache)).toBeDefined();
    expect(cachedExplanation("c", cache)).toBeDefined();
  });
});

describe("explain: the spend guard treats it as its own bucket", () => {
  it("spends explain units, never build units, and a spent bucket refuses kindly", () => {
    const lim = { build: 3, image: 3, sam: 3, voice: 60, explain: 1 };
    const budget = new Budget({ session: lim, global: lim });
    expect(budget.take("1.2.3.4", "explain").ok).toBe(true);
    const refused = budget.take("1.2.3.4", "explain");
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.scope).toBe("session");
      expect(refused.message).toMatch(/code explanations/);
    }
    expect(budget.snapshot().global.build).toBe(0);
    expect(budget.take("1.2.3.4", "build").ok).toBe(true);
  });

  it("a cache hit needs no budget at all (the handler answers before spending)", () => {
    const cache = new ExplainCache(4);
    const ask = mockAsk(GOOD);
    // Warm the cache the way a first visitor would, then read it without an ask.
    return explainMod({ source: SOURCE, title: "Coin Shower", ask, cache }).then(() => {
      const hit = cachedExplanation(SOURCE, cache);
      expect(hit).toBeDefined();
      expect(ask.calls).toBe(1); // the free read did not touch the model
    });
  });
});
