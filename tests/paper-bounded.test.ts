// Paper-to-level is bounded (ADR 0054 amendment, bug q8x follow-up).
// A photographed drawing used to be read with no time ceiling at all, so a hung vision call
// could hold the orb on "Reading your paper level drawing..." with nothing ever arriving.
// These tests stub the vision call (hang / reject / junk / slow) so no live Meta call is made.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PAPER_RETAKE, runPaperBuild, type PaperDeps } from "../server/paper";
import { compileMod } from "../server/compile";
import { verifyMod } from "../server/verify";

const PNG = `data:image/png;base64,${readFileSync(
  resolve(process.cwd(), "tests/fixtures/paper/paper-level-1.png"),
).toString("base64")}`;

const LEVEL = JSON.stringify({
  name: "Bounded Castle",
  platforms: [
    { x: 100, y: 880, w: 800, h: 40, kind: "ledge" },
    { x: 350, y: 550, w: 220, h: 30, kind: "ledge" },
  ],
  coins: [{ x: 450, y: 510, w: 25, h: 25 }],
  enemies: [{ x: 500, y: 500, w: 35, h: 35 }],
});

/** Deps whose vision call can hang, reject, or answer, plus everything the client would see. */
function stub(opts: {
  reply?: string;
  hang?: boolean;
  reject?: boolean;
  deliver?: (source: string) => Promise<{ ok: boolean; errors: string[] }>;
} = {}) {
  const seen = {
    asked: 0,
    signals: [] as (AbortSignal | undefined)[],
    stages: [] as string[],
    said: [] as string[],
    delivered: [] as string[],
  };
  const deps: PaperDeps = {
    ask(_messages, signal) {
      seen.asked++;
      seen.signals.push(signal);
      if (opts.hang) return new Promise<string>(() => { /* never answers, ignores the signal */ });
      if (opts.reject) return Promise.reject(new Error("Meta API 503: upstream unavailable"));
      return Promise.resolve(opts.reply ?? "");
    },
    async deliver(source) {
      seen.delivered.push(source);
      if (opts.deliver) return opts.deliver(source);
      const compiled = compileMod(source);
      if (!compiled.ok) return { ok: false, errors: compiled.errors };
      const verified = await verifyMod(source, compiled.js);
      return { ok: verified.ok, errors: verified.errors };
    },
    say(text) { seen.said.push(text); },
    stage(s) { seen.stages.push(s); },
  };
  return { deps, seen };
}

describe("paper build is bounded and always ends", () => {
  it("gives up fast when the vision call hangs, and tells the client", async () => {
    const { deps, seen } = stub({ hang: true });
    const t0 = Date.now();
    const r = await runPaperBuild(deps, { image: PNG }, {
      askTimeoutMs: 60,
      readBudgetMs: 120,
      retryMinMs: 40,
    });
    const elapsed = Date.now() - t0;
    expect(r.ok).toBe(false);
    // The old code waited on a promise that never settled, so the orb waited forever.
    expect(elapsed).toBeLessThan(2_000);
    expect(seen.stages).toContain("failed");
    expect(seen.said).toContain(PAPER_RETAKE);
    // The call was given an abort signal and the deadline fired it.
    expect(seen.signals[0]).toBeInstanceOf(AbortSignal);
    expect(seen.signals[0]!.aborted).toBe(true);
  });

  it("never spends more than the reading budget, however the model behaves", async () => {
    const { deps, seen } = stub({ hang: true });
    const t0 = Date.now();
    await runPaperBuild(deps, { image: PNG }, {
      askTimeoutMs: 300,
      readBudgetMs: 400,
      retryMinMs: 150,
      totalBudgetMs: 600,
    });
    expect(Date.now() - t0).toBeLessThan(1_500);
    // One timed-out try, and no second try once the budget cannot hold it.
    expect(seen.asked).toBe(1);
    expect(seen.delivered.length).toBe(0);
  });

  it("asks for a retake when the vision call errors out", async () => {
    const { deps, seen } = stub({ reject: true });
    const r = await runPaperBuild(deps, { image: PNG }, {
      askTimeoutMs: 200,
      readBudgetMs: 400,
      retryMinMs: 100,
    });
    expect(r.ok).toBe(false);
    expect(seen.stages).toContain("failed");
    expect(seen.said).toContain(PAPER_RETAKE);
  });

  it("still builds the level when the model answers normally", async () => {
    const { deps, seen } = stub({ reply: LEVEL });
    const r = await runPaperBuild(deps, { image: PNG }, {
      askTimeoutMs: 2_000,
      readBudgetMs: 4_000,
      retryMinMs: 1_000,
    });
    expect(r.ok).toBe(true);
    expect(r.title).toBe("Bounded Castle");
    expect(seen.asked).toBe(1);
    // A success is not a failure: the orb must not flash an error.
    expect(seen.stages).not.toContain("failed");
    expect(seen.stages).toContain("compiling");

    // Through the real compiler and the real verifier, not a stub.
    const compiled = compileMod(seen.delivered[0]);
    expect(compiled.ok, compiled.errors.join("; ")).toBe(true);
    const verified = await verifyMod(seen.delivered[0], compiled.js);
    expect(verified.ok, verified.errors.join("; ")).toBe(true);
    expect(verified.msPerFrame).toBeLessThan(2.0);
  });

  it("tells the client it failed instead of letting the orb wait", async () => {
    const { deps, seen } = stub({
      reply: LEVEL,
      deliver: async () => ({ ok: false, errors: ["verify: boom"] }),
    });
    const r = await runPaperBuild(deps, { image: PNG }, {
      askTimeoutMs: 500,
      readBudgetMs: 1_000,
      fixTimeoutMs: 200,
      retryMinMs: 100,
    });
    expect(r.ok).toBe(false);
    expect(seen.stages).toContain("failed");
    expect(seen.said.join(" ")).toContain("didn't verify");
  });

  it("skips the fix round when the build budget cannot hold one", async () => {
    const { deps, seen } = stub({
      reply: LEVEL,
      deliver: async () => ({ ok: false, errors: ["verify: boom"] }),
    });
    const r = await runPaperBuild(deps, { image: PNG }, {
      askTimeoutMs: 500,
      readBudgetMs: 1_000,
      fixTimeoutMs: 200,
      retryMinMs: 100,
      totalBudgetMs: 1,
    });
    expect(r.ok).toBe(false);
    // One reading call only: no second ask, no fix ask.
    expect(seen.asked).toBe(1);
    expect(seen.stages).not.toContain("fixing");
    expect(seen.stages).toContain("failed");
  });

  it("reports a bad photo immediately, without asking the model", async () => {
    const { deps, seen } = stub({ reply: LEVEL });
    const r = await runPaperBuild(deps, { image: "nope" });
    expect(r.ok).toBe(false);
    expect(seen.asked).toBe(0);
    expect(seen.stages).toEqual(["failed"]);
  });
});
