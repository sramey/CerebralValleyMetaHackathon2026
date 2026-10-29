import { describe, expect, it } from "vitest";
import type { Entity } from "../src/contract";
import { World } from "../src/sim/world";
import { ModLoader, runModTest } from "../src/sim/loader";
import { HOOP_SIZE, hoopBox, isHoopType, rimOf } from "../src/sim/hoop";
import { drawHoop, drawShape, kindOf } from "../src/client/shapes";
import { inputFromKeys } from "../src/client/keys";
import { resolveItemMod } from "../src/client/items";
import basketballMod from "../src/mods/basketball";

/** A Graphics stand-in that records every draw call, so a visual can be asserted without a browser. */
function recorder(): { g: unknown; calls: { op: string; args: unknown[] }[] } {
  const calls: { op: string; args: unknown[] }[] = [];
  const g: unknown = new Proxy({}, {
    get: (_t, prop) => (...args: unknown[]) => {
      calls.push({ op: String(prop), args });
      return g;
    },
  });
  return { g, calls };
}

const ballEntity = (over: Partial<Entity> = {}): Entity => ({
  id: 1, type: "basketball", x: 0, y: 0, w: 22, h: 22, vx: 0, vy: 0,
  color: 0xe8702a, solid: false, gravityScale: 1, facing: 1, onGround: false,
  health: 100, owner: "basketball", data: {}, ...over,
});

describe("basketball & hoop (bead z1d)", () => {
  it("passes its runModTest", () => {
    const r = runModTest(basketballMod);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("keeps the goal box, rim and board consistent", () => {
    const box = hoopBox(360, 400);
    expect(box).toEqual({ x: 360, y: 400 - HOOP_SIZE.h, w: HOOP_SIZE.w, h: HOOP_SIZE.h });
    const rim = rimOf(box);
    expect(rim.w).toBeCloseTo(HOOP_SIZE.w * 0.34, 5);
    expect(rim.x + rim.w / 2).toBeCloseTo(box.x + box.w * 0.35, 5);
    expect(rim.y).toBeCloseTo(box.y + box.h * 0.52, 5);
    expect(rim.y).toBeLessThan(box.y + box.h); // above the ground, inside the structure
    expect(rim.y).toBeGreaterThan(box.y); // below the board's top
    expect(rim.w).toBeGreaterThan(22); // a basketball (22 px) fits through the mouth
  });

  it("treats a basketball goal as a goal, and other sports' goals as themselves", () => {
    for (const t of ["basketball-hoop", "hoop", "basketball-goal", "backboard", "goal", "hoop-backboard"]) {
      expect(isHoopType(t)).toBe(true);
    }
    for (const t of ["soccer-goal", "football-goal", "hockey-goal", "goalpost", "goalkeeper", "tree", "basketball"]) {
      expect(isHoopType(t)).toBe(false);
    }
  });

  it("draws a goal as a structure, not a floating ring, and a ball round with seams", () => {
    expect(kindOf("basketball-hoop")).toBeUndefined(); // never the plain ring look
    expect(kindOf("basketball")).toEqual({ kind: "shape", shape: "circle" });

    // Goal: a post reaching the ground, a backboard, a rim ellipse and a net of strands.
    const goal = recorder();
    drawHoop(goal.g as never, { ...ballEntity(), type: "basketball-hoop", w: 100, h: 200, y: 200 }, 0, 0);
    const rects = goal.calls.filter((c) => c.op === "rect");
    expect(rects.length).toBeGreaterThan(4);
    expect(rects.some((c) => {
      const [, y, , h] = c.args as number[];
      return Math.abs(y + h - 200) < 2; // something stands on the ground (box bottom)
    })).toBe(true);
    expect(goal.calls.some((c) => c.op === "ellipse" && (c.args[2] as number) > 10)).toBe(true); // the rim
    expect(goal.calls.filter((c) => c.op === "lineTo").length).toBeGreaterThan(20); // the net

    // Ball: no squashed ellipse, drawn as a circle with seam strokes.
    const ball = recorder();
    drawShape(ball.g as never, ballEntity({ onGround: true }), 0, 0, "circle");
    expect(ball.calls.filter((c) => c.op === "ellipse")).toHaveLength(0);
    expect(ball.calls.some((c) => c.op === "circle" && (c.args[0] as number) === 11 && (c.args[1] as number) === 11)).toBe(true);
    expect(ball.calls.filter((c) => c.op === "stroke").length).toBeGreaterThanOrEqual(4); // seams
  });

  it("maps B to the action and use keys", () => {
    const b = inputFromKeys(new Set(["KeyB"]));
    expect(b.shoot).toBe(true);
    expect(b.use).toBe(true);
    const x = inputFromKeys(new Set(["KeyX"]));
    expect(x.shoot).toBe(true);
    expect(x.use).toBe(true);
    const e = inputFromKeys(new Set(["KeyE"]));
    expect(e.shoot).toBe(false);
    expect(e.use).toBe(true);
    expect(inputFromKeys(new Set(["KeyB", "ArrowLeft", "Space"]))).toEqual({
      left: true, right: false, jump: true, shoot: true, use: true,
    });
    expect(inputFromKeys(new Set(["KeyM"]))).toEqual({ left: false, right: false, jump: false, shoot: false, use: false });
  });

  it("routes basketball phrasings to the built-in mod, and leaves basketball characters to the AI", () => {
    expect(resolveItemMod("add a basketball and a hoop")?.id).toBe("basketball");
    expect(resolveItemMod("add a basketball, that i can pickup, and shoot with b, and a basketball goal")?.id).toBe("basketball");
    expect(resolveItemMod("a hoop")?.id).toBe("basketball");
    expect(resolveItemMod("backboard")?.id).toBe("basketball");
    expect(resolveItemMod("add a basketball player")?.id).not.toBe("basketball");
    expect(resolveItemMod("give me a gun")?.id).toBe("gun");
  });

  it("unloads cleanly: no hoop, no ball, no HUD left behind", () => {
    const w = new World(7);
    const l = new ModLoader(w);
    l.load(basketballMod);
    expect(w.entities.filter((e) => e.type === "basketball-hoop")).toHaveLength(1);
    expect(w.entities.filter((e) => e.type === "basketball")).toHaveLength(1);
    expect(w.hudList().length).toBeGreaterThan(0);
    l.unload("basketball");
    expect(w.entities).toHaveLength(0);
    expect(w.hudList()).toHaveLength(0);
  });
});
