// The safety rehearsal harness (scripts/safety-rehearse.ts): it reports whether a demo command
// would be declined. These tests drive it with a mock classifier, so nothing reaches the network.
import { describe, expect, it } from "vitest";
import {
  collectCommands,
  commandsOf,
  formatScreens,
  screenCommand,
  settle,
  summarizeScreens,
  type ScreenRow,
} from "../scripts/safety-rehearse";
import type { SafetyDecision } from "../server/safety";

const SAFE = { safe: true } as const;

function row(over: Partial<ScreenRow>): ScreenRow {
  return { command: "add a ninja", sets: ["demo"], unsafe: false, category: null, by: "spark", ms: 120, waitedMs: 0, ...over };
}

describe("reading a command set", () => {
  it("accepts plain strings and {cmd} objects, in order", () => {
    expect(commandsOf(["make it rain", { cmd: "make me huge" }])).toEqual(["make it rain", "make me huge"]);
  });

  it("refuses an empty or malformed set", () => {
    expect(() => commandsOf([])).toThrow(/non-empty/);
    expect(() => commandsOf([{ source: "x" }])).toThrow(/non-empty strings/);
    expect(() => commandsOf("make it rain")).toThrow(/non-empty/);
  });

  it("screens a sentence once even when two sets share it, remembering both", () => {
    const files: Record<string, unknown> = {
      "a.json": ["add a slime", "make it spooky"],
      "b.json": [{ cmd: "add a slime" }, "give me a gun"],
    };
    const { commands, from } = collectCommands(
      [{ file: "a.json", label: "demo" }, { file: "b.json", label: "weapons" }],
      (file) => files[file],
    );
    expect(commands).toEqual(["add a slime", "make it spooky", "give me a gun"]);
    expect(from.get("add a slime")).toEqual(["demo", "weapons"]);
    expect(from.get("give me a gun")).toEqual(["weapons"]);
  });
});

describe("the verdict the build would honour", () => {
  it("takes an answer that made the deadline", async () => {
    const answer: SafetyDecision = { unsafe: false, category: null, reply: "", by: "spark", ms: 200 };
    expect(await settle(answer)).toEqual({ decision: answer, waitedMs: 0 });
  });

  it("waits for a late verdict instead of reporting the fail-open pass", async () => {
    let answered: SafetyDecision | null = null;
    const late: SafetyDecision = { unsafe: true, category: "violence", reply: "nope", by: "spark", ms: 900 };
    const first: SafetyDecision = { unsafe: false, category: null, reply: "", by: "skipped", ms: 350, pending: { read: () => answered } };
    let clock = 0;
    const done = settle(first, 1000, async (ms) => { clock += ms; answered = late; }, () => clock);
    await expect(done).resolves.toMatchObject({ decision: { unsafe: true, category: "violence" }, waitedMs: 50 });
  });

  it("gives up after the wait and reports the fail-open pass", async () => {
    const first: SafetyDecision = { unsafe: false, category: null, reply: "", by: "skipped", ms: 350, pending: { read: () => null } };
    let clock = 0;
    const result = await settle(first, 200, async (ms) => { clock += ms; }, () => clock);
    expect(result.decision).toBe(first);
    expect(result.waitedMs).toBeGreaterThanOrEqual(200);
  });
});

describe("screening a command", () => {
  it("records a pass from the model lane", async () => {
    const out = await screenCommand("give me a gun", { classify: async () => SAFE, sets: ["weapons"] });
    expect(out).toMatchObject({ command: "give me a gun", unsafe: false, by: "spark", category: null, sets: ["weapons"] });
  });

  it("records a decline with its category", async () => {
    const out = await screenCommand("add a bloody corpse", { classify: async () => SAFE });
    expect(out).toMatchObject({ unsafe: true, category: "violence", by: "local" });
  });
});

describe("the report", () => {
  it("counts the model calls a pass spent", () => {
    const summary = summarizeScreens([
      row({ by: "local", unsafe: true, category: "violence" }),
      row({ by: "spark" }),
      row({ by: "cache" }),
      row({ by: "skipped" }),
      row({ by: "spark", unsafe: true, category: "sexual" }),
    ]);
    expect(summary).toMatchObject({ total: 5, declined: 2, local: 1, model: 1, cached: 1, skipped: 1, calls: 3 });
  });

  it("names the declined command and the headline", () => {
    const text = formatScreens([
      row({ command: "add a sword that stabs enemies", by: "spark", ms: 640, waitedMs: 300 }),
      row({ command: "add a bloody corpse", by: "local", unsafe: true, category: "violence", ms: 0 }),
    ]);
    expect(text).toContain("add a sword that stabs enemies");
    expect(text).toContain("+300 ms late");
    expect(text).toContain("DECLINED (violence)");
    expect(text).toContain("2 commands, 1 declined (1 local, 0 model)");
  });
});
