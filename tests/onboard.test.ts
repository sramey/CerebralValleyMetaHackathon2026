import { describe, it, expect } from "vitest";
import { Container } from "pixi.js";
import { FIRST_IDEA, IDEAS, STEP_TEXT, coachNext, ideaPlaceholder, plainBuildMessage } from "../src/client/onboard";
import type { CoachStep } from "../src/client/onboard";
import { CANCEL_GLYPH } from "../src/client/builds";
import { ACTION_KEYS, JUMP_KEYS, LEFT_KEYS, RIGHT_KEYS } from "../src/client/keys";
import { Feel } from "../src/client/feel";
import type { FeelEvent } from "../src/client/feel";
import { sfxFor } from "../src/client/sound";
import type { Entity } from "../src/contract";
import rehearse from "../scripts/rehearse.json";
import aware from "../scripts/rehearse-aware.json";

function ent(over: Partial<Entity>): Entity {
  return {
    id: 1, type: "player", x: 0, y: 0, w: 32, h: 48, vx: 0, vy: 0, color: 0xffffff, solid: false,
    gravityScale: 1, facing: 1, onGround: true, health: 100, owner: "", data: {},
    ...over,
  } as Entity;
}

describe("coach steps", () => {
  const walk = (evs: Parameters<typeof coachNext>[1][]): CoachStep => evs.reduce<CoachStep>((s, e) => coachNext(s, e), 1);

  it("follows say it -> watch -> play -> done", () => {
    expect(walk(["submit"])).toBe(2);
    expect(walk(["submit", "working", "built"])).toBe(3);
    expect(walk(["submit", "built", "move"])).toBe(4);
  });
  it("jumps ahead when a build lands before the tour noticed it was working", () => {
    expect(walk(["built"])).toBe(3);
  });
  it("ignores movement until the build has landed, and skip always ends it", () => {
    expect(walk(["move", "move"])).toBe(1);
    expect(walk(["skip"])).toBe(4);
    expect(walk(["submit", "skip", "built"])).toBe(4);
  });
});

describe("coach copy names the real control (bead q4u)", () => {
  /** `KeyA` -> `A`; codes with no letter (Space, ArrowLeft) are checked by hand below. */
  const letters = (codes: readonly string[]): string[] =>
    codes.map((c) => c.replace(/^Key/, "")).filter((c) => c.length === 1);

  it("step 1 says how to talk: hold Shift, the real hold-to-talk key (voice.ts)", () => {
    expect(STEP_TEXT[1].body).toContain("Shift");
  });

  it("step 2 gives the wait a button: the × that stops a running build (builds.ts)", () => {
    expect(STEP_TEXT[2].body).toContain("20 seconds");
    expect(STEP_TEXT[2].body).toContain(CANCEL_GLYPH);
    expect(STEP_TEXT[2].body).toMatch(/stop/i);
  });

  it("step 3 names the keys the game actually listens to (keys.ts)", () => {
    const play = STEP_TEXT[3].body;
    for (const key of [...letters(LEFT_KEYS), ...letters(RIGHT_KEYS), ...letters(JUMP_KEYS)]) {
      expect(play, `missing ${key}`).toContain(key);
    }
    expect(play).toContain("Space");
    // Shooting is named by its two primary keys; both have to be real action keys.
    for (const key of ["X", "B"]) {
      expect(play).toContain(key);
      expect(letters(ACTION_KEYS)).toContain(key);
    }
  });

  it("keeps every card short enough to read on the coach's 340 px width", () => {
    for (const step of [1, 2, 3] as const) expect(STEP_TEXT[step].body.length).toBeLessThan(200);
  });
});

describe("idea suggestions", () => {
  const known = new Set<string>([...rehearse, ...aware].map((r) => (typeof r === "string" ? r : r.cmd)));
  it("only suggests ideas from the rehearsed sets or the starter chips", () => {
    const chips = new Set(["add a bouncing green slime", "add trees", "make it rain", "add a dragon and some coins", "let me shoot fireballs", "make it spooky"]);
    for (const idea of IDEAS) expect(known.has(idea) || chips.has(idea) || [...known].some((k) => k.startsWith(idea.split(" ").slice(0, 3).join(" ")))).toBe(true);
    expect(IDEAS[0]).toBe(FIRST_IDEA);
  });
  it("rotates and wraps", () => {
    expect(ideaPlaceholder(0)).toContain(IDEAS[0]);
    expect(ideaPlaceholder(IDEAS.length)).toBe(ideaPlaceholder(0));
    expect(ideaPlaceholder(-1)).toContain(IDEAS[IDEAS.length - 1]);
  });
});

describe("plain-language build messages", () => {
  it("keeps a plain rejection reason and adds what happens next", () => {
    const m = plainBuildMessage("rejected", "You'd get stuck by the tower and couldn't keep going.");
    expect(m).toContain("stuck by the tower");
    expect(m).toContain("Fixing it");
  });
  it("hides technical rejection reasons", () => {
    const m = plainBuildMessage("rejected", "playtest (seed 3): mod setup threw: TypeError: undefined is not a function at mod.ts:12:4");
    expect(m).not.toMatch(/TypeError|seed|mod\.ts|undefined/);
    expect(m).toContain("Fixing it");
  });
  it("never shows a raw failure", () => {
    for (const raw of ["TS2339: Property 'x' does not exist on type 'Api'", "ReferenceError: foo is not defined\n  at setup (mod.ts:3:1)", "verify: knob 'speed' missing"]) {
      const m = plainBuildMessage("failed", raw);
      expect(m).not.toContain(raw);
      expect(m).not.toMatch(/TS\d|Reference|mod\.ts|knob/);
      expect(m).toContain("unchanged");
    }
  });
  it("gives a specific plain message for busy and offline builders", () => {
    expect(plainBuildMessage("failed", "429 rate limit exceeded")).toContain("busy");
    expect(plainBuildMessage("failed", "fetch failed: ECONNREFUSED")).toContain("server");
  });
});

describe("enemy death sound", () => {
  const run = (frames: Entity[][]): FeelEvent[] => {
    const out: FeelEvent[] = [];
    const feel = new Feel(new Container(), () => {}, true, (e) => out.push(e));
    for (const f of frames) feel.update(f, 1 / 60);
    return out;
  };
  const player = ent({});
  const slime = ent({ id: 5, type: "enemy", x: 200, w: 28, h: 28 });
  const bullet = ent({ id: 6, type: "bullet", x: 180, y: 10, w: 8, h: 4, gravityScale: 0 });

  it("plays when an enemy vanishes right beside a shot", () => {
    const ev = run([[player, slime], [player, slime, bullet], [player]]);
    expect(ev.map((e) => e.kind)).toContain("die");
    expect(sfxFor({ kind: "die" })?.sfx).toBe("defeat");
  });
  it("stays quiet when something is removed far from the action (undo, despawn)", () => {
    const far = ent({ id: 5, type: "enemy", x: 1500 });
    expect(run([[player, far], [player, far], [player]]).map((e) => e.kind)).not.toContain("die");
  });
  it("does not count the player vanishing", () => {
    expect(run([[player], [player], []]).map((e) => e.kind)).not.toContain("die");
  });
});
