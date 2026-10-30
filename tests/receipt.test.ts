// "How was this made?" (ADR 0065): the receipt is built from records the server already has,
// so these tests pin the parts that read code (the test extractor) and the wording of the chain.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { aiReceipt, extractTest, plainReceipt, testChecks } from "../server/receipt";
import { fixLine, lineDelta, splitReason, modelName, receiptSteps, timeSegments } from "../src/client/receipt-model";

const MOD = `export default {
  id: "slime",
  title: "Bouncing Slime",
  knobs: { speed: { type: "number", min: 0, max: 400, default: 120 } },
  setup(api, k) { api.spawn({ type: "slime", x: 100, y: 300, w: 24, h: 18, data: { note: "}" } }); },
  dispose(api) { for (const e of api.byType("slime")) api.despawn(e); },
  test(t) {
    t.api.spawn({ type: "ground", x: -200, y: 400, w: 1200, h: 48, solid: true, gravityScale: 0 });
    // a comment with a } brace
    t.expect(t.api.byType("slime").length === 1, "one slime spawns");
    t.step(120);
    const s = t.api.byType("slime")[0];
    t.expect(s.y < 400, \`slime stays above the ground at \${s.y}\`);
    t.expect(Number.isFinite(s.vx), 'it keeps moving');
  },
};
`;

const timings = { route: 800, write: 7200, compile: 40, verify: 600, total: 8700 };

describe("extractTest", () => {
  it("cuts out the whole test method, past braces in strings and comments", () => {
    const t = extractTest(MOD)!;
    expect(t.startsWith("test(t) {")).toBe(true);
    expect(t.trimEnd().endsWith("}")).toBe(true);
    expect(t).toContain("it keeps moving");
    expect(t).not.toContain("dispose");
  });

  it("finds arrow and typed forms", () => {
    expect(extractTest("const m = { test: (t) => { t.expect(true, 'a'); } };")).toContain("t.expect(true, 'a')");
    expect(extractTest("const m = { test(t: TestApi) { t.step(1); } };")).toContain("t.step(1)");
  });

  it("returns null when there is no test or it never closes", () => {
    expect(extractTest("export default { id: 'x', setup() {}, dispose() {} }")).toBeNull();
    expect(extractTest("test(t) { t.step(1);")).toBeNull();
  });

  it("works on every built-in mod that ships with a test", () => {
    for (const f of ["chicken.ts", "coins.ts", "player.ts"]) {
      const src = readFileSync(join(process.cwd(), "src/mods", f), "utf8");
      if (!/\btest\s*\(/.test(src)) continue;
      const t = extractTest(src);
      expect(t, f).not.toBeNull();
      expect(testChecks(t).length, f).toBeGreaterThan(0);
    }
  });
});

describe("testChecks", () => {
  it("lists each expect message in order, with template holes shown as …", () => {
    expect(testChecks(extractTest(MOD))).toEqual(["one slime spawns", "slime stays above the ground at …", "it keeps moving"]);
  });

  it("is empty without a test", () => {
    expect(testChecks(null)).toEqual([]);
  });
});

describe("aiReceipt", () => {
  const route = { action: "new", model: "muse-spark-1.2", open: false, fellBack: false, ms: 800, visual: "creature", rules: [] };
  const fixed = MOD.replace("max: 400", "max: 300");

  it("keeps every version, marks the turned-away draft with its reason, and reads the live test", () => {
    const r = aiReceipt({ modId: "slime", title: "Bouncing Slime", command: "add a bouncing green slime", route, source: fixed, rejected: [{ source: "draft", errors: ["playtest: You'd be too big to fit through the gap. (detail)"] }], tools: [{ name: "run_playtest", ms: 4, ok: false }, { name: "run_playtest", ms: 3, ok: true }], turns: 3, playtests: 2, msPerFrame: 0.004, timings });
    expect(r.origin).toBe("ai");
    expect(r.versions).toHaveLength(2);
    expect(r.versions[0].rejected?.[0]).toContain("too big");
    expect(r.versions[1].rejected).toBeUndefined();
    expect(r.test?.checks).toContain("one slime spawns");
    expect(r.proof).toMatchObject({ healthFrames: 600, playtestSeeds: 3, playtests: 2, fixed: true });
  });

  it("keeps drafts Wonder's own playtest turned away, drops repeats and the live source", () => {
    const r = aiReceipt({ modId: "p", title: "Player", command: "make me huge", route, source: fixed, rejected: [
      { source: "huge v1", errors: ["playtest: You'd be too big to fit through the gap."] },
      { source: "huge v1 ", errors: ["playtest: again"] },
      { source: fixed, errors: ["never shown"] },
      { source: "huge v2", errors: ["test: player spawns"] },
    ], tools: [], turns: 2, playtests: 3, msPerFrame: 0.004, timings });
    expect(r.versions.map((v) => v.source)).toEqual(["huge v1", "huge v2", fixed]);
    expect(r.proof.fixed).toBe(true);
    const steps = receiptSteps(r);
    const rej = steps.find((s) => s.tone === "rejected")!;
    expect(rej.title).toBe("2 drafts rejected before you ever saw one");
    expect(rej.lines).toEqual(["Playtest: You'd be too big to fit through the gap.", "test: player spawns"]);
  });

  it("a first-try build has one version and is not marked fixed", () => {
    const r = aiReceipt({ modId: "slime", title: "Bouncing Slime", command: "add a slime", route, source: MOD, rejected: [], tools: [], turns: 1, playtests: 1, msPerFrame: 0.002, timings });
    expect(r.versions).toHaveLength(1);
    expect(r.proof.fixed).toBe(false);
  });
});

describe("receiptSteps", () => {
  const route = { action: "new", model: "muse-spark-1.2", open: false, fellBack: false, ms: 800, visual: "creature", rules: ["r1"] };

  it("tells the whole chain for a fixed AI build: words, route, draft, rejection, fix, proof, art, live", () => {
    const r = aiReceipt({
      modId: "slime", title: "Bouncing Slime", command: "make me huge", route, source: MOD.replace("w: 24", "w: 20"),
      rejected: [{ source: MOD, errors: ["playtest: You'd be too big to fit through the gap."] }], tools: [{ name: "inspect_world", ms: 2 }, { name: "run_playtest", ms: 4, ok: true }],
      turns: 2, playtests: 2, msPerFrame: 0.004, timings,
      art: { model: "muse-image-1.0", subject: "slime", prompt: "Pixel art game sprite sheet…", url: "/art/gen/slime.webp", state: "drawn", ms: 8100 },
    });
    const steps = receiptSteps(r);
    expect(steps.map((s) => s.tone)).toEqual(["you", "model", "model", "rejected", "model", "proof", "art", "live"]);
    expect(steps[1].by).toBe("Muse Spark");
    expect(steps[2].lines.join(" ")).toContain("inspect_world → run_playtest ✓");
    expect(steps[3].lines[0]).toBe("Playtest: You'd be too big to fit through the gap.");
    expect(steps[4].lines[0]).toBe("Changed 1 line (+1 −1), re-ran the playtest, and it passed");
    const proof = steps[5];
    expect(proof.checks?.some((c) => c.text === "Its own test: one slime spawns")).toBe(true);
    expect(proof.checks?.some((c) => c.text.includes("3 seeds"))).toBe(true);
    expect(proof.code?.text).toContain("test(t)");
    expect(steps[6].code?.text).toContain("sprite sheet");
    expect(steps[7].lines[0]).toContain("Fixed and verified in 8.7 s");
  });

  it("names the open-weights router when it answered", () => {
    const r = aiReceipt({ modId: "a", title: "A", command: "add a", route: { ...route, open: true }, source: MOD, rejected: [], tools: [], turns: 1, playtests: 0, msPerFrame: 0, timings });
    expect(receiptSteps(r)[1].by).toBe("Muse Spark Open (open weights)");
  });

  it("a built-in says so and still shows its test, with no AI steps", () => {
    const steps = receiptSteps(plainReceipt("slime", "Slime", MOD, "builtin"));
    expect(steps[0].tone).toBe("note");
    expect(steps.some((s) => s.by === "Muse Wonder")).toBe(false);
    expect(steps.find((s) => s.tone === "proof")?.checks?.length).toBe(3);
  });


  it("includes open-weights reviewer step in receipt when review is present", () => {
    const r = aiReceipt({ modId: "b", title: "Ball", command: "add a ball", route, source: MOD, rejected: [], tools: [], turns: 1, playtests: 1, msPerFrame: 0.001, timings });
    r.review = {
      model: "meta-models/muse-spark-open",
      verdict: "fix",
      issues: ["fixed ball despawn leak"],
      accepted: true,
      ms: 1200,
    };
    const steps = receiptSteps(r);
    const revStep = steps.find((step) => step.title.includes("Reviewed & improved"));
    expect(revStep).toBeDefined();
    expect(revStep?.by).toBe("Muse Spark Open (open weights)");
    expect(revStep?.lines[0]).toBe("Fixed: fixed ball despawn leak");
    expect(revStep?.tone).toBe("live");
  });
  it("code-drawn art makes no image claim", () => {
    const r = aiReceipt({ modId: "b", title: "Ball", command: "add a ball", route, source: MOD, rejected: [], tools: [], turns: 1, playtests: 1, msPerFrame: 0.001, timings, art: { model: "code", subject: "ball", state: "code-drawn" } });
    const art = receiptSteps(r).find((s) => s.tone === "art")!;
    expect(art.by).toBe("engine");
    expect(art.code).toBeUndefined();
  });
});

describe("helpers", () => {
  it("lineDelta counts changed lines as multisets", () => {
    expect(lineDelta("a\nb\nc", "a\nb\nd\ne")).toEqual({ added: 2, removed: 1 });
    expect(lineDelta("a", "a")).toEqual({ added: 0, removed: 0 });
  });

  it("splitReason keeps the plain sentence and moves the bot's detail aside", () => {
    expect(splitReason("playtest: You'd be too big to fit through the gap. (playtest (seed 11): stuck at x=950)")).toEqual({ plain: "Playtest: You'd be too big to fit through the gap.", detail: "playtest (seed 11): stuck at x=950" });
    expect(splitReason("test: player spawns")).toEqual({ plain: "test: player spawns", detail: "" });
    expect(splitReason("playtest: It crashed.")).toEqual({ plain: "Playtest: It crashed.", detail: "" });
  });

  it("fixLine reads naturally for no change, one and many", () => {
    expect(fixLine({ added: 0, removed: 0 })).toBe("Kept the code, re-ran the playtest, and it passed");
    expect(fixLine({ added: 3, removed: 1 })).toBe("Changed 3 lines (+3 −1), re-ran the playtest, and it passed");
  });

  it("timeSegments drops empty parts and sums to 1", () => {
    const segs = timeSegments({ route: 0, write: 3000, compile: 500, verify: 500, total: 4000 });
    expect(segs.map((s) => s.label)).toEqual(["write", "verify"]);
    expect(segs.reduce((n, s) => n + s.frac, 0)).toBeCloseTo(1);
  });

  it("modelName knows the Meta models", () => {
    expect(modelName("muse-wonder-1.0")).toBe("Muse Wonder");
    expect(modelName("something-else")).toBe("something-else");
  });
});
