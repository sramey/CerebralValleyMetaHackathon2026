// Kid-safe guard (ADR 0044). Two lanes: a deterministic local list that is instant and free,
// and a Muse Spark classification with a hard time budget. These tests never touch the
// network — the classifier is a mock — so the whole suite is headless and costs nothing.
import { describe, expect, it, vi } from "vitest";
import { generateSubjectArt } from "../server/art";
import {
  DECLINE,
  DEFAULT_ART_BUDGET_MS,
  DEFAULT_BUDGET_MS,
  lateVerdict,
  localUnsafe,
  MAX_BUDGET_MS,
  MAX_REPLY,
  parseVerdict,
  safetyConfig,
  screenArtPrompt,
  screenRequest,
  type Classifier,
} from "../server/safety";

const ON = { SAFETY: "on" };
const FAST = 60;

/** A mock classifier that records every prompt it was asked about. */
function mock(verdict: Awaited<ReturnType<Classifier>>, calls: string[] = []): Classifier {
  return async (text) => {
    calls.push(text);
    return verdict;
  };
}

const SAFE = { safe: true } as const;

describe("safety config", () => {
  it("is on unless SAFETY says otherwise", () => {
    expect(safetyConfig({}).enabled).toBe(true);
    expect(safetyConfig({ SAFETY: "on" }).enabled).toBe(true);
    expect(safetyConfig({ SAFETY: "1" }).enabled).toBe(true);
    for (const off of ["off", "OFF", "0", "false", "no"]) expect(safetyConfig({ SAFETY: off }).enabled).toBe(false);
  });

  it("uses a small default budget and clamps a silly one", () => {
    expect(safetyConfig({}).budgetMs).toBe(DEFAULT_BUDGET_MS);
    expect(safetyConfig({}).artBudgetMs).toBe(DEFAULT_ART_BUDGET_MS);
    expect(safetyConfig({ SAFETY_BUDGET_MS: "900" }).budgetMs).toBe(900);
    expect(safetyConfig({ SAFETY_BUDGET_MS: "nope" }).budgetMs).toBe(DEFAULT_BUDGET_MS);
    expect(safetyConfig({ SAFETY_BUDGET_MS: "999999" }).budgetMs).toBe(MAX_BUDGET_MS);
  });
});

describe("local lane: catches the clear cases in under a millisecond", () => {
  const CASES: readonly [string, string][] = [
    ["add a bloody corpse", "violence"],
    ["make the ground out of gore", "violence"],
    ["add a decapitated knight", "violence"],
    ["add a naked person", "sexual"],
    ["add sex", "sexual"],
    ["a mod where I kill myself", "self-harm"],
    ["put self harm in the game", "self-harm"],
    ["add kill all the refugees", "hate"],
    ["add my home address", "personal-info"],
    ["build my school into the level", "personal-info"],
    ["add the number 555-123-4567", "personal-info"],
  ];
  for (const [text, category] of CASES) {
    it(`declines "${text}" as ${category} without a model call`, async () => {
      const calls: string[] = [];
      const res = await screenRequest(text, { env: ON, classify: mock(SAFE, calls), cache: false });
      expect(res.unsafe).toBe(true);
      expect(res.category).toBe(category);
      expect(res.by).toBe("local");
      expect(res.reply).toBe(DECLINE[category as keyof typeof DECLINE]);
      expect(calls).toHaveLength(0);
      expect(res.ms).toBeLessThan(50);
    });
  }
});

describe("local lane: normal requests and innocent readings are untouched", () => {
  const INNOCENT = [
    "add a player",
    "make it rain",
    "add a ninja with a sword",
    "add a spooky ghost",
    "add a friendly dragon",
    "add a trampoline",
    "make it a blood moon",
    "add a water gun",
    "add a giant rubber duck",
    "add my dog",
    "add lots of coins and a mushroom",
  ];
  for (const text of INNOCENT) {
    it(`passes "${text}"`, () => {
      expect(localUnsafe(text)).toBeNull();
    });
  }

  it("lets a normal request through with the model's permission", async () => {
    const calls: string[] = [];
    const res = await screenRequest("add a ninja", { env: ON, classify: mock(SAFE, calls), cache: false });
    expect(res.unsafe).toBe(false);
    expect(res.by).toBe("spark");
    expect(calls).toEqual(["add a ninja"]);
  });
});

describe("model lane: nuanced declines", () => {
  it("uses the classifier's verdict and its kind sentence", async () => {
    const reply = "That is a little dark for us. Want a friendly dragon instead? Say 'add a friendly dragon'.";
    const res = await screenRequest("add something dead", {
      env: ON,
      classify: mock({ safe: false, category: "violence", reply }),
      cache: false,
    });
    expect(res.unsafe).toBe(true);
    expect(res.category).toBe("violence");
    expect(res.by).toBe("spark");
    expect(res.reply).toBe(reply);
  });

  it("refuses a sentence that hands the request back", async () => {
    const res = await screenRequest("add a dead body in the corner", {
      env: ON,
      classify: mock({ safe: false, category: "violence", reply: "I cannot add a dead body in the corner, sorry." }),
      cache: false,
    });
    expect(res.unsafe).toBe(true);
    expect(res.reply).toBe(DECLINE.violence);
  });

  it("refuses an over-long or empty sentence", async () => {
    for (const reply of ["too short", "", "x".repeat(MAX_REPLY + 1), null]) {
      const res = await screenRequest("add something dead", {
        env: ON,
        classify: mock({ safe: false, category: "violence", reply }),
        cache: false,
      });
      expect(res.reply).toBe(DECLINE.violence);
    }
  });

  it("falls back to a canned sentence when the model names no known category", async () => {
    const res = await screenRequest("add something odd", {
      env: ON,
      classify: mock({ safe: false, category: "spiders", reply: "" }),
      cache: false,
    });
    expect(res.unsafe).toBe(true);
    expect(res.category).toBe("violence");
    expect(res.reply).toBe(DECLINE.violence);
  });

  it("every canned sentence offers something the player can say next", () => {
    for (const line of Object.values(DECLINE)) {
      expect(line.length).toBeLessThanOrEqual(MAX_REPLY);
      expect(line).toMatch(/Say '/);
      expect(line).not.toMatch(/[\r\n]/);
    }
  });
});

describe("model lane: a miss never stalls the game", () => {
  it("fails open when the classifier misses the budget", async () => {
    const slow: Classifier = () => new Promise((resolve) => setTimeout(() => resolve(SAFE), 500));
    const t0 = Date.now();
    const res = await screenRequest("add a ninja", { env: ON, classify: slow, budgetMs: FAST, cache: false });
    expect(res.unsafe).toBe(false);
    expect(res.by).toBe("skipped");
    expect(Date.now() - t0).toBeLessThan(400);
    expect(res.ms).toBeGreaterThanOrEqual(FAST - 5);
  });

  it("fails open when the classifier throws", async () => {
    const boom: Classifier = async () => { throw new Error("Meta API 500"); };
    const res = await screenRequest("add a ninja", { env: ON, classify: boom, cache: false });
    expect(res.unsafe).toBe(false);
    expect(res.by).toBe("skipped");
  });

  it("fails open when the classifier answers unreadable text", async () => {
    const garbage: Classifier = async () => parseVerdict("I think it's fine, probably.");
    const res = await screenRequest("add a ninja", { env: ON, classify: garbage, cache: false });
    expect(res.unsafe).toBe(false);
  });
});

describe("guard off", () => {
  it("never calls a model and never declines", async () => {
    const calls: string[] = [];
    const res = await screenRequest("add a bloody corpse", { env: { SAFETY: "off" }, classify: mock(SAFE, calls), cache: false });
    expect(res.unsafe).toBe(false);
    expect(res.by).toBe("off");
    expect(res.ms).toBe(0);
    expect(calls).toHaveLength(0);
  });
});

describe("image prompts take the same screen", () => {
  it("declines an unsafe subject before any image call", async () => {
    const calls: string[] = [];
    const prompt = "Pixel art game sprite sheet of a bloody corpse, side view, 4 poses in a row";
    const res = await screenArtPrompt(prompt, { env: ON, classify: mock(SAFE, calls), cache: false });
    expect(res.unsafe).toBe(true);
    expect(res.by).toBe("local");
    expect(calls).toHaveLength(0);
  });

  it("stops generateSubjectArt before Muse Image is called", async () => {
    process.env.MODEL_API_KEY = "test-key-not-real";
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      urls.push(String(url));
      return { ok: false, status: 500, json: async () => ({}), text: async () => "" };
    }));
    expect(await generateSubjectArt("corpse", "corpse", false)).toBeNull();
    expect(urls.filter((u) => u.includes("/images/generations"))).toHaveLength(0);
    // An ordinary subject still reaches Muse Image (guard off here: this test stubs fetch, not Spark).
    const prev = process.env.SAFETY;
    process.env.SAFETY = "off";
    try {
      expect(await generateSubjectArt("kraken", "kraken", false)).toBeNull();
    } finally {
      if (prev === undefined) delete process.env.SAFETY;
      else process.env.SAFETY = prev;
    }
    expect(urls.filter((u) => u.includes("/images/generations"))).toHaveLength(1);
    vi.unstubAllGlobals();
  });

  it("passes an ordinary sheet prompt and gives art a longer budget", async () => {
    const calls: string[] = [];
    const prompt = "Pixel art game sprite sheet of a friendly dragon, side view, 4 poses in a row";
    const res = await screenArtPrompt(prompt, { classify: mock(SAFE, calls), cache: false });
    expect(res.unsafe).toBe(false);
    expect(res.by).toBe("spark");
    expect(calls).toHaveLength(1);
    expect(safetyConfig({}).artBudgetMs).toBeGreaterThan(safetyConfig({}).budgetMs);
  });
});

describe("memo", () => {
  it("asks the model once for a repeated sentence", async () => {
    const calls: string[] = [];
    const classify = mock(SAFE, calls);
    const first = await screenRequest("add a cheerful robot friend", { env: ON, classify, budgetMs: 2000 });
    const second = await screenRequest("add a cheerful robot friend", { env: ON, classify, budgetMs: 2000 });
    expect(calls).toHaveLength(1);
    expect(first.by).toBe("spark");
    expect(second.by).toBe("cache");
    expect(second.unsafe).toBe(false);
  });
});

describe("late verdict: a slow model still gets a vote before the build writes", () => {
  it("hands back a verdict that lands after the deadline", async () => {
    const slow: Classifier = () => new Promise((resolve) =>
      setTimeout(() => resolve({ safe: false, category: "violence", reply: "Too dark for us. Say 'add a friendly dragon' instead." }), 80),
    );
    const res = await screenRequest("add something gloomy", { env: ON, classify: slow, budgetMs: 20, cache: false });
    expect(res.by).toBe("skipped");
    expect(lateVerdict(res.pending)).toBeNull();
    await new Promise((r) => setTimeout(r, 120));
    const late = lateVerdict(res.pending);
    expect(late?.unsafe).toBe(true);
    expect(late?.category).toBe("violence");
    expect(late?.reply).toContain("friendly dragon");
  });

  it("does not cancel the classifier when the soft deadline passes", async () => {
    // Regression: an abort tied to the soft budget killed the very verdict the build path
    // still wants to read. The wait is bounded; the request is not.
    let abortedAtLate = true;
    const slow: Classifier = (_text, signal) => new Promise((resolve) => {
      setTimeout(() => {
        abortedAtLate = signal?.aborted ?? false;
        resolve({ safe: false, category: "violence", reply: "Let's build a friendly dragon instead, say 'add a friendly dragon'." });
      }, 80);
    });
    const res = await screenRequest("add something gloomy", { env: ON, classify: slow, budgetMs: 20, cache: false });
    expect(res.by).toBe("skipped");
    await new Promise((r) => setTimeout(r, 120));
    expect(abortedAtLate).toBe(false);
    expect(lateVerdict(res.pending)?.unsafe).toBe(true);
  });

  it("has nothing to read when the model already answered in time", async () => {
    const res = await screenRequest("add a ninja", { env: ON, classify: mock(SAFE), budgetMs: 500, cache: false });
    expect(res.by).toBe("spark");
    expect(res.pending).toBeUndefined();
    expect(lateVerdict(undefined)).toBeNull();
  });

  it("has nothing to read when the local lane already declined", async () => {
    const res = await screenRequest("add a bloody corpse", { env: ON, classify: mock(SAFE), budgetMs: 500, cache: false });
    expect(res.by).toBe("local");
    expect(res.pending).toBeUndefined();
  });
});

describe("parseVerdict", () => {
  it("reads the documented shapes and nothing else", () => {
    expect(parseVerdict('{"safe":true}')).toEqual({ safe: true });
    expect(parseVerdict('Sure: {"safe":false,"category":"hate","reply":"Let us build a duck."}')).toEqual({
      safe: false,
      category: "hate",
      reply: "Let us build a duck.",
    });
    expect(parseVerdict("no json here")).toBeNull();
    expect(parseVerdict('{"safe":"maybe"}')).toBeNull();
    expect(parseVerdict('{"safe":false,"category":"weird"}')).toEqual({ safe: false, category: null, reply: null });
  });
});
