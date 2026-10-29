import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { budgetAdvice, exhaustedToday, RECORDING_GLOBAL, RECORDING_SESSION, sizeCapRules } from "../scripts/demo-prep";
import { DEFAULT_GLOBAL, DEFAULT_SESSION } from "../server/budget";
import { learningFrozen, loadRules, saveRules, setLearnedDir } from "../server/learn";
import type { LearnedRule } from "../server/learn";

const dirs: string[] = [];
afterEach(() => { delete process.env.DEMO_FREEZE_LEARNING; setLearnedDir(null); for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe("demo:prep helpers", () => {
  it("lists env lines to raise, by name, only for limits below the recording need", () => {
    const lines = budgetAdvice({ session: DEFAULT_SESSION, global: DEFAULT_GLOBAL });
    expect(lines).toContain("BUDGET_SESSION_VOICE_MIN=30");
    expect(lines).toContain("BUDGET_SESSION_BUILDS=60");
    expect(budgetAdvice({ session: RECORDING_SESSION, global: RECORDING_GLOBAL })).toEqual([]);
  });

  it("finds local counters already at the per-visitor limit for today only", () => {
    const d = mkdtempSync(join(tmpdir(), "prep-")); dirs.push(d);
    const f = join(d, "budget.json");
    const used = { build: 1, image: 0, sam: 0, voice: 480 * 60 };
    writeFileSync(f, JSON.stringify({ day: "2026-10-29", global: used, sessions: { "::1": used, "10.0.0.5": { build: 99, image: 99, sam: 99, voice: 99999 } } }));
    expect(exhaustedToday(f, DEFAULT_SESSION, "2026-10-29")).toEqual(["voice"]);
    expect(exhaustedToday(f, DEFAULT_SESSION, "2026-10-30")).toEqual([]);
    expect(exhaustedToday(join(d, "missing.json"), DEFAULT_SESSION)).toEqual([]);
  });

  it("flags player-size cap rules and ignores unrelated ones", () => {
    const hits = sizeCapRules([
      { id: "a", rule: "Scale player only via api.setPlayerSize() with ceiling clearance." },
      { id: "b", rule: "Clamp max player height so the player fits the gap." },
      { id: "c", rule: "Rain drops must slant with the wind." },
    ]);
    expect(hits).toEqual(["a", "b"]);
  });
});

describe("DEMO_FREEZE_LEARNING", () => {
  it("makes saveRules write nothing", () => {
    const d = mkdtempSync(join(tmpdir(), "learn-")); dirs.push(d);
    const rule: LearnedRule = { id: "r1", subsystem: "wonder", rule: "x", source: "feedback", createdAt: "2026-10-29T00:00:00.000Z" };
    process.env.DEMO_FREEZE_LEARNING = "1";
    expect(learningFrozen()).toBe(true);
    saveRules([rule], d);
    expect(loadRules(d)).toEqual([]);
    delete process.env.DEMO_FREEZE_LEARNING;
    saveRules([rule], d);
    expect(loadRules(d).map((r) => r.id)).toEqual(["r1"]);
  });
});

describe("readLimits defaults", () => {
  it("voice defaults are in seconds just like an explicit minutes value (was 8 s instead of 8 min)", async () => {
    const { readLimits } = await import("../server/budget");
    expect(readLimits({}).session.voice).toBe(DEFAULT_SESSION.voice);
    expect(readLimits({}).global.voice).toBe(DEFAULT_GLOBAL.voice);
    expect(readLimits({ BUDGET_SESSION_VOICE_MIN: "30" }).session.voice).toBe(1800);
  });
});
