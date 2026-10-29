import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  dedupAndCapRules,
  formatLearnedBlock,
  learnFromFix,
  learnRuleFromFeedback,
  learnSkillFromFeedback,
  loadRules,
  loadSkills,
  matchSkills,
  setLearnedDir,
} from "../server/learn";
import { buildEditPrompt, buildRouterPrompt, buildWonderPrompt } from "../server/prompt";
import { setLogFile } from "../server/createlog";

describe("self-improving rules & skills (server/learn.ts)", () => {
  let tempDir = "";

  beforeEach(() => {
    process.env.MODEL_API_KEY = "test-key-not-real";
    tempDir = mkdtempSync(join(tmpdir(), "metabuild-learn-"));
    setLearnedDir(tempDir);
    setLogFile(join(tempDir, "builds.jsonl")); // never write into the real evidence log
  });

  afterEach(() => {
    setLearnedDir(null);
    setLogFile(null);
    vi.unstubAllGlobals();
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("distills thumbs-down feedback via Muse Spark (minimal reasoning) into rules.json and RULES.md", async () => {
    let sentBody: Record<string, unknown> = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { body: string }) => {
        sentBody = JSON.parse(init.body) as Record<string, unknown>;
        return {
          ok: true,
          json: async () => ({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    subsystem: "router",
                    rule: 'Simple balls and spheres must use visual:"shape" with shape:"circle", never creature sprite art.',
                    clearArt: true,
                    editInstruction: "Render the ball as a code-drawn circle shape with bounce physics.",
                  }),
                },
              },
            ],
          }),
          text: async () => "",
        };
      }),
    );

    const res = await learnRuleFromFeedback({
      modId: "bouncing-ball",
      title: "Bouncing Ball",
      entityType: "ball",
      vote: "down",
      note: "a ball should be a simple shape, not a basketball player",
      command: "add a bouncing ball",
      hasArt: true,
    });

    expect(sentBody.model).toBe("muse-spark-1.2");
    expect(sentBody.reasoning_effort).toBe("minimal");
    expect(res.clearArt).toBe(true);
    expect(res.rule.subsystem).toBe("router");
    expect(res.rule.rule).toContain('visual:"shape"');

    const rules = loadRules();
    expect(rules).toHaveLength(1);
    expect(rules[0].rule).toBe(res.rule.rule);

    const rulesMd = readFileSync(join(tempDir, "RULES.md"), "utf8");
    expect(rulesMd).toContain("# Learned Engine Rules");
    expect(rulesMd).toContain(res.rule.rule);
  });

  it("deduplicates similar rules within the same subsystem and caps total rules", () => {
    const base = {
      id: "r1",
      subsystem: "wonder" as const,
      rule: "Ground creatures must use gravityScale 1 and spawn at y = 400 - h.",
      source: "feedback" as const,
      createdAt: "2026-10-29T00:00:00.000Z",
    };
    const duplicate = {
      id: "r2",
      subsystem: "wonder" as const,
      rule: "Ground creatures must use gravityScale: 1 and spawn at y = 400 - h!",
      source: "feedback" as const,
      createdAt: "2026-10-29T00:01:00.000Z",
    };
    const afterDedup = dedupAndCapRules([base], duplicate, 5);
    expect(afterDedup).toHaveLength(1);
    expect(afterDedup[0].id).toBe("r2");

    let list = afterDedup;
    for (let i = 0; i < 10; i++) {
      list = dedupAndCapRules(
        list,
        {
          id: `unique-${i}`,
          subsystem: "wonder",
          rule: `Rule ${i} for topic-${i} with parameter-${i * 17} and behavior-${i * 31}`,
          source: "feedback",
          createdAt: "2026-10-29T00:02:00.000Z",
        },
        4,
      );
    }
    expect(list).toHaveLength(4);
  });

  it("distills thumbs-up feedback into server/learned/skills/<slug>.md and injects into matching Wonder prompts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  slug: "homing-fireflies",
                  title: "Gentle Drifting Fireflies",
                  keywords: ["firefly", "fireflies", "glow", "lantern"],
                  summary: "Uses sine-wave vertical bobbing with zero gravity and periodic warm particle bursts.",
                  snippet: 'const f = api.spawn({ type: "firefly", x: 200, y: 260, w: 12, h: 12, gravityScale: 0 });',
                }),
              },
            },
          ],
        }),
        text: async () => "",
      })),
    );

    const skill = await learnSkillFromFeedback({
      modId: "fireflies",
      title: "Fireflies",
      entityType: "firefly",
      vote: "up",
      note: "The gentle bobbing and glow particles look awesome",
      command: "add glowing fireflies",
      source: 'export default { id: "fireflies", title: "Fireflies", setup(api) {} };',
    });

    expect(skill.slug).toBe("homing-fireflies");
    const skillPath = join(tempDir, "skills", "homing-fireflies.md");
    expect(existsSync(skillPath)).toBe(true);

    const loaded = loadSkills();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].title).toBe("Gentle Drifting Fireflies");

    const matched = matchSkills("add some lantern fireflies in the sky");
    expect(matched).toHaveLength(1);
    expect(matched[0].slug).toBe("homing-fireflies");

    const wonderPrompt = buildWonderPrompt("add some lantern fireflies", "(empty)");
    expect(wonderPrompt).toContain("LEARNED SKILLS");
    expect(wonderPrompt).toContain("Gentle Drifting Fireflies");
    expect(wonderPrompt).toContain("sine-wave vertical bobbing");

    const unrelatedPrompt = buildWonderPrompt("add a stone bridge", "(empty)");
    expect(unrelatedPrompt).not.toContain("Gentle Drifting Fireflies");
  });

  it("autonomously learns pitfall rules from verifier auto-fixes and injects into Router/Wonder/Edit prompts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  subsystem: "wonder",
                  rule: "Never spawn solid:true obstacles across the player spawn x=100..220 or playtest movement will fail.",
                }),
              },
            },
          ],
        }),
        text: async () => "",
      })),
    );

    const learned = await learnFromFix(
      "add a lava wall",
      ["playtest: player was trapped and could not move right"],
      "export default { id: 'lava-wall' }",
      "export default { id: 'lava-wall-fixed' }",
    );

    expect(learned).not.toBeNull();
    expect(learned?.source).toBe("autofix");
    expect(learned?.rule).toContain("Never spawn solid:true obstacles");

    const wonderBlock = formatLearnedBlock("wonder", "add a tower");
    expect(wonderBlock).toContain("LEARNED RULES");
    expect(wonderBlock).toContain("Never spawn solid:true obstacles");

    const editPrompt = buildEditPrompt("make tower taller", "export default {}", "(manifest)");
    expect(editPrompt).toContain("Never spawn solid:true obstacles");

    // Add a router rule and verify buildRouterPrompt includes it
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  subsystem: "router",
                  rule: 'Treat bubbles and orbs as visual:"shape" with shape:"circle".',
                  clearArt: true,
                  editInstruction: "Use circle shape.",
                }),
              },
            },
          ],
        }),
        text: async () => "",
      })),
    );
    await learnRuleFromFeedback({
      modId: "bubble",
      vote: "down",
      note: "bubbles should be simple circle shapes",
    });

    const routerPrompt = buildRouterPrompt("add floating bubbles", "(manifest)");
    expect(routerPrompt).toContain("LEARNED RULES");
    expect(routerPrompt).toContain('Treat bubbles and orbs as visual:"shape"');
  });
});
