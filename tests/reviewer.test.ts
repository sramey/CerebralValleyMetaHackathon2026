import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLogFile } from "../server/createlog";
import { loadRules, setLearnedDir } from "../server/learn";
import {
  buildReviewerPrompt,
  parseReviewJson,
  resetReviewTracking,
  reviewBuild,
  type ReviewableMod,
} from "../server/reviewer";
import type { ServerMsg } from "../src/contract";

const VALID_MOD_SOURCE = `export default {
  id: "test-slime",
  title: "Test Slime",
  knobs: { speed: { type: "number", min: 0, max: 200, default: 50 } },
  setup(api) {
    api.spawn({ type: "slime", x: 100, y: 350, w: 20, h: 20, solid: false });
  },
  dispose(api) {
    for (const e of api.byType("slime")) api.despawn(e);
  },
  test(t) {
    t.api.spawn({ type: "ground", x: 0, y: 390, w: 500, h: 30, solid: true, gravityScale: 0 });
    t.expect(t.api.byType("slime").length === 1, "slime spawned");
  },
};
`;

const FIXED_MOD_SOURCE = `export default {
  id: "test-slime",
  title: "Test Slime",
  knobs: { speed: { type: "number", min: 0, max: 300, default: 80 } },
  setup(api) {
    api.spawn({ type: "slime", x: 100, y: 350, w: 20, h: 20, solid: false });
  },
  dispose(api) {
    for (const e of api.byType("slime")) api.despawn(e);
  },
  test(t) {
    t.api.spawn({ type: "ground", x: 0, y: 390, w: 500, h: 30, solid: true, gravityScale: 0 });
    t.expect(t.api.byType("slime").length === 1, "slime spawned");
  },
};
`;

let mock: Server | undefined;
let mockHits = 0;
let mockBody: any = null;
let tempDir = "";

async function startMock(handler: (res: import("node:http").ServerResponse) => void): Promise<string> {
  mockHits = 0;
  mockBody = null;
  mock = createServer((req, res) => {
    mockHits++;
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      try {
        mockBody = JSON.parse(b);
      } catch {
        /* ignore */
      }
      handler(res);
    });
  });
  await new Promise<void>((r) => mock!.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(mock.address() as AddressInfo).port}/v1`;
}

beforeEach(() => {
  resetReviewTracking();
  tempDir = mkdtempSync(join(tmpdir(), "metabuild-reviewer-test-"));
  setLearnedDir(tempDir);
  setLogFile(join(tempDir, "builds.jsonl"));
  process.env.MODEL_API_KEY = "test-key";
  process.env.BASETEN_API_KEY = "baseten-test-key";
  delete process.env.REVIEWER;
  delete process.env.REVIEWER_TIMEOUT_MS;
});

afterEach(async () => {
  setLearnedDir(null);
  setLogFile(null);
  vi.unstubAllGlobals();
  if (mock) await new Promise((r) => mock!.close(r));
  mock = undefined;
  if (tempDir && existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("reviewer JSON parsing", () => {
  it("parses valid JSON verdict:ok", () => {
    const res = parseReviewJson('{"verdict":"ok","issues":[]}');
    expect(res).toEqual({ verdict: "ok", issues: [] });
  });

  it("parses markdown-fenced JSON with verdict:fix", () => {
    const raw = `\`\`\`json
{
  "verdict": "fix",
  "issues": ["entities never despawn on dispose"],
  "patchedSource": "export default { id: 'x' };"
}
\`\`\``;
    const res = parseReviewJson(raw);
    expect(res).toEqual({
      verdict: "fix",
      issues: ["entities never despawn on dispose"],
      patchedSource: "export default { id: 'x' };",
    });
  });

  it("returns null on malformed or non-JSON", () => {
    expect(parseReviewJson("")).toBeNull();
    expect(parseReviewJson("I think this mod is fine.")).toBeNull();
    expect(parseReviewJson('{"unknown": true}')).toBeNull();
  });
});

describe("buildReviewerPrompt", () => {
  it("includes command, playtest status, and mod source", () => {
    const prompt = buildReviewerPrompt("add a slime", "export default {}", { ok: true, msPerFrame: 0.005 });
    expect(prompt).toContain('Command: "add a slime"');
    expect(prompt).toContain("ok=true");
    expect(prompt).toContain("msPerFrame=0.005");
    expect(prompt).toContain("export default {}");
  });
});

describe("kill switch and missing key", () => {
  it("skips when REVIEWER=off without making network requests", async () => {
    process.env.REVIEWER = "off";
    process.env.BASETEN_BASE_URL = await startMock((res) => {
      res.end("{}");
    });
    const mod: ReviewableMod = {
      id: "test-slime",
      title: "Test Slime",
      source: VALID_MOD_SOURCE,
      compiled: "/* compiled */",
      knobs: {},
    };
    const outcome = await reviewBuild({ command: "add a slime", mod });
    expect(outcome.skipped).toBe("off");
    expect(mockHits).toBe(0);
  });

  it("skips when BASETEN_API_KEY is unset", async () => {
    process.env.BASETEN_API_KEY = "";
    const mod: ReviewableMod = {
      id: "test-slime",
      title: "Test Slime",
      source: VALID_MOD_SOURCE,
      compiled: "/* compiled */",
      knobs: {},
    };
    const outcome = await reviewBuild({ command: "add a slime", mod });
    expect(outcome.skipped).toBe("no-key");
  });
});

describe("timeout = no-op", () => {
  it("catches timeout safely and leaves original mod intact", async () => {
    process.env.BASETEN_BASE_URL = await startMock(() => {
      /* hangs */
    });
    process.env.REVIEWER_TIMEOUT_MS = "80";
    const mod: ReviewableMod = {
      id: "test-slime",
      title: "Test Slime",
      source: VALID_MOD_SOURCE,
      compiled: "/* compiled */",
      knobs: {},
    };
    const outcome = await reviewBuild({ command: "add a slime", mod });
    expect(outcome.error).toBeDefined();
    expect(mod.source).toBe(VALID_MOD_SOURCE);
  });
});

describe("gate protection", () => {
  it("rejects a patch that fails compile and keeps original mod source", async () => {
    process.env.BASETEN_BASE_URL = await startMock((res) => {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  verdict: "fix",
                  issues: ["syntax error in patch"],
                  patchedSource: "export default {{{ broken syntax",
                }),
              },
            },
          ],
        }),
      );
    });

    const mod: ReviewableMod = {
      id: "test-slime",
      title: "Test Slime",
      source: VALID_MOD_SOURCE,
      compiled: "/* original compiled */",
      knobs: {},
    };

    const outcome = await reviewBuild({ command: "add a slime", mod });
    expect(outcome.verdict).toBe("fix");
    expect(outcome.accepted).toBe(false);
    expect(mod.source).toBe(VALID_MOD_SOURCE);
    expect(mod.compiled).toBe("/* original compiled */");
  });

  it("rejects a patch that fails verifier (forbidden tokens) and keeps original", async () => {
    process.env.BASETEN_BASE_URL = await startMock((res) => {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  verdict: "fix",
                  issues: ["use forbidden window access"],
                  patchedSource: `export default {
                    id: "test-slime",
                    setup() { const x = window.location; },
                    dispose() {}
                  };`,
                }),
              },
            },
          ],
        }),
      );
    });

    const mod: ReviewableMod = {
      id: "test-slime",
      title: "Test Slime",
      source: VALID_MOD_SOURCE,
      compiled: "/* original compiled */",
      knobs: {},
    };

    const outcome = await reviewBuild({ command: "add a slime", mod });
    expect(outcome.accepted).toBe(false);
    expect(mod.source).toBe(VALID_MOD_SOURCE);
  });

  it("accepts a valid patch, hot-swaps it, notifies the player, and learns a rule", async () => {
    process.env.BASETEN_BASE_URL = await startMock((res) => {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  verdict: "fix",
                  issues: ["increase slime speed knob default"],
                  patchedSource: FIXED_MOD_SOURCE,
                }),
              },
            },
          ],
        }),
      );
    });

    const sentMsgs: ServerMsg[] = [];
    const fakeWs = {} as any;
    const send = (_ws: any, msg: ServerMsg) => {
      sentMsgs.push(msg);
    };

    const mod: ReviewableMod = {
      id: "test-slime",
      title: "Test Slime",
      source: VALID_MOD_SOURCE,
      compiled: "/* old */",
      knobs: { speed: { value: 50, min: 0, max: 200 } },
      receipt: {
        modId: "test-slime",
        title: "Test Slime",
        origin: "ai",
        versions: [{ source: VALID_MOD_SOURCE }],
        test: null,
        proof: { healthFrames: 600, msBudget: 2, msPerFrame: 0.005, playtestSeeds: 3, playtests: 1, fixed: false },
      },
    };

    const outcome = await reviewBuild({
      ws: fakeWs,
      command: "add a bouncing green slime",
      mod,
      send,
      worldMods: () => [],
    });

    expect(outcome.accepted).toBe(true);
    expect(outcome.verdict).toBe("fix");
    expect(mod.source.trim()).toBe(FIXED_MOD_SOURCE.trim());

    // Verify side panel message
    const sayMsg = sentMsgs.find((m) => m.kind === "say");
    expect(sayMsg).toBeDefined();
    if (sayMsg && sayMsg.kind === "say") {
      expect(sayMsg.text).toContain("Reviewed by Muse Spark Open (open weights): fixed increase slime speed knob default");
    }

    // Verify hot-swap mod message
    const modMsg = sentMsgs.find((m) => m.kind === "mod");
    expect(modMsg).toBeDefined();
    if (modMsg && modMsg.kind === "mod") {
      expect(modMsg.mod.id).toBe("test-slime");
      expect(modMsg.mod.source.trim()).toBe(FIXED_MOD_SOURCE.trim());
    }

    // Verify receipt has the open-weights review step
    expect(mod.receipt?.review).toMatchObject({
      model: "meta-models/muse-spark-open",
      verdict: "fix",
      accepted: true,
      issues: ["increase slime speed knob default"],
    });

    // Verify learned rule was persisted
    const rules = loadRules();
    expect(rules.some((r) => r.source === "review" && r.rule.includes("increase slime speed knob default"))).toBe(true);

    // Verify review log entry was written
    const logPath = join(tempDir, "builds.jsonl");
    expect(existsSync(logPath)).toBe(true);
    const logContent = readFileSync(logPath, "utf8");
    expect(logContent).toContain('"kind":"review"');
    expect(logContent).toContain('"accepted":true');
    // ADR 0069: the row carries the changed lines and the rule the fix taught.
    const row = JSON.parse(logContent.trim().split(/\r?\n/).filter((l) => l.includes('"kind":"review"')).pop()!);
    expect(row.diff.some((h: { del: string[]; add: string[] }) => h.del.join().includes("max: 200") && h.add.join().includes("max: 300"))).toBe(true);
    expect(row.rules[0]).toContain("increase slime speed knob default");
  });

  it("caps at one review per build", async () => {
    process.env.BASETEN_BASE_URL = await startMock((res) => {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          choices: [{ message: { content: '{"verdict":"ok","issues":[]}' } }],
        }),
      );
    });

    const mod: ReviewableMod = {
      id: "test-slime",
      title: "Test Slime",
      source: VALID_MOD_SOURCE,
      compiled: "/* compiled */",
      knobs: {},
    };

    const first = await reviewBuild({ command: "add a slime", mod });
    expect(first.verdict).toBe("ok");
    expect(mockHits).toBe(1);

    const second = await reviewBuild({ command: "add a slime", mod });
    expect(second.skipped).toBe("already-reviewed");
    expect(mockHits).toBe(1);
  });
});

describe("reviewer prompt (bead 4t7)", () => {
  it("carries the game's checklist, worked examples and the engine facts that stop false alarms", async () => {
    const { REVIEWER_SYSTEM } = await import("../server/reviewer-prompt");
    for (const word of ["LOOK:", "LANDMARKS:", "LEAKS:", "DISPOSE:", "PLACEMENT:", "ITEMS:", "HOSTILES:", "MATH:", "TEST:", "Example 1", "Example 3", "plain numbers"]) expect(REVIEWER_SYSTEM).toContain(word);
    expect(REVIEWER_SYSTEM).toContain("Real bugs only");
    // Worked answers must themselves parse as reviewer JSON.
    const answers = REVIEWER_SYSTEM.split("\n").filter((l) => l.startsWith("ANSWER: ")).map((l) => parseReviewJson(l.slice(8)));
    expect(answers).toHaveLength(3);
    for (const a of answers) expect(a?.verdict).toBe("fix");
  });
});

describe("reviewer worked examples", () => {
  it("every patched example passes compile and verify, and every bad one compiles", async () => {
    const { EXAMPLES } = await import("../server/reviewer-prompt");
    const { compileMod } = await import("../server/compile");
    const { verifyMod } = await import("../server/verify");
    for (const e of EXAMPLES) {
      const bad = compileMod(e.bad);
      expect(bad.ok, `bad: ${e.why}`).toBe(true);
      const good = compileMod(e.good);
      expect(good.ok, `good compile: ${e.why}`).toBe(true);
      if (good.ok) {
        const v = await verifyMod(e.good, good.js);
        expect(v.ok, `good verify: ${e.why} ${v.ok ? "" : v.errors.join("; ")}`).toBe(true);
      }
    }
  }, 60000);
});
