import { describe, expect, it } from "vitest";
import { emptyInput } from "../src/contract";
import type { Entity, ModApi, ModDefinition } from "../src/contract";
import { ModLoader } from "../src/sim/loader";
import { World } from "../src/sim/world";
import { aimFrom, raycastSolid, winchToward } from "../src/sim/tether";
import { artPlanFor, entityKind } from "../src/ontology";

/** The pattern server/prompt.ts teaches Wonder, as a mod. */
const grapple: ModDefinition = {
  id: "grapple",
  title: "Grappling hook",
  setup(api: ModApi) {
    let hook: Entity | undefined;
    let anchored = false;
    let prev = false;
    api.onTick(() => {
      const p = api.player();
      if (!p) return;
      const inp = api.input();
      const fire = (inp.shoot || inp.use) && !prev;
      prev = !!(inp.shoot || inp.use);
      const a = api.aim!(p);
      if (hook && !api.entities().includes(hook)) hook = undefined;
      if (fire && hook) { api.despawn(hook.id); hook = undefined; anchored = false; return; }
      if (fire) {
        hook = api.spawn({ type: "grapple-hook", x: p.x + p.w / 2 - 6, y: p.y + p.h / 2 - 6, w: 12, h: 12, solid: false, gravityScale: 0, vx: a.x * 900, vy: a.y * 900, data: { tetherTo: "player" } });
        anchored = false;
        return;
      }
      if (!hook) return;
      const hx = hook.x + hook.w / 2, hy = hook.y + hook.h / 2;
      if (!anchored) {
        const hit = api.raycast!(hx, hy, hook.vx, hook.vy, 20, hook);
        if (hit) { hook.x = hit.x - 6; hook.y = hit.y - 6; hook.vx = 0; hook.vy = 0; anchored = true; return; }
        if (Math.hypot(hx - (p.x + p.w / 2), hy - (p.y + p.h / 2)) > 520) { api.despawn(hook.id); hook = undefined; }
        return;
      }
      if (inp.jump) { p.vy = -640; p.vx += a.x * 200; api.despawn(hook.id); hook = undefined; anchored = false; return; }
      const left = api.winch!(p, hx, hy, 620);
      if (left < 28) { api.despawn(hook.id); hook = undefined; anchored = false; }
    });
  },
  dispose() {},
};

function world(): { w: World; loader: ModLoader; p: Entity; tower: Entity } {
  const w = new World(7);
  const loader = new ModLoader(w);
  w.spawn({ type: "ground", x: -500, y: 400, w: 3000, h: 100, solid: true, gravityScale: 0 }, "t");
  const tower = w.spawn({ type: "brick", x: 400, y: 150, w: 60, h: 250, solid: true, gravityScale: 0 }, "t");
  const p = w.spawn({ type: "player", x: 200, y: 360, w: 28, h: 40 }, "t");
  loader.load(grapple);
  return { w, loader, p, tower };
}

describe("grappling hook (ADR 0050)", () => {
  it("raycast finds the first solid and skips the player", () => {
    const { w, p, tower } = world();
    const hit = raycastSolid(w.entities, 300, 200, 1, 0, 400, p);
    expect(hit?.entity).toBe(tower);
    expect(hit!.x).toBeGreaterThanOrEqual(400);
    expect(raycastSolid(w.entities, 300, 200, -1, 0, 400, p)).toBeUndefined();
  });

  it("aim follows the pointer, and falls back to facing without one", () => {
    const { p } = world();
    const toPointer = aimFrom(p, { ...emptyInput(), pointerX: p.x + p.w / 2, pointerY: p.y + p.h / 2 - 100 });
    expect(toPointer.y).toBeCloseTo(-1);
    const kb = aimFrom(p, emptyInput());
    expect(kb.x * p.facing).toBeGreaterThan(0.5);
    expect(kb.y).toBeLessThan(0);
  });

  it("a key press with the mouse parked behind the player still fires forward; a click aims behind", () => {
    const { p } = world();
    const behindX = p.x + p.w / 2 - 300 * p.facing;
    const key = aimFrom(p, { ...emptyInput(), pointerX: behindX, pointerY: p.y });
    expect(key.x * p.facing).toBeGreaterThan(0.5);
    const click = aimFrom(p, { ...emptyInput(), pointerX: behindX, pointerY: p.y, pointerDown: true });
    expect(click.x * p.facing).toBeLessThan(-0.5);
  });

  it("winch eases toward the anchor without gravity drag", () => {
    const { p } = world();
    p.gravityScale = 1;
    const d0 = winchToward(p, 430, 100, 600);
    expect(d0).toBeGreaterThan(0);
    expect(p.vy).toBeLessThan(0);
    expect(p.vx).toBeGreaterThan(0);
  });

  it("aiming at the brick tower latches and winches the player up to it", () => {
    const { w, p } = world();
    for (let i = 0; i < 30; i++) w.step(); // settle on the ground
    const y0 = p.y;
    w.input = { ...emptyInput(), shoot: true, pointerX: 430, pointerY: 200 };
    w.step();
    w.input = { ...w.input, shoot: false };
    for (let i = 0; i < 20; i++) w.step();
    const hook = w.entities.find((e) => e.type === "grapple-hook");
    expect(hook).toBeTruthy();
    expect(hook!.data.tetherTo).toBe("player");
    expect(hook!.vx).toBe(0); // anchored
    let minY = p.y, maxX = p.x;
    for (let i = 0; i < 90; i++) { w.step(); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); }
    expect(minY).toBeLessThan(y0 - 100); // reeled up the tower
    expect(maxX).toBeGreaterThan(340); // and across to it
    expect(w.entities.some((e) => e.type === "grapple-hook")).toBe(false); // released on arrival
  });

  it("the hook is not stopped by the wall before it can latch", () => {
    const { w } = world();
    for (let i = 0; i < 30; i++) w.step();
    w.input = { ...emptyInput(), shoot: true, pointerX: 430, pointerY: 300 };
    w.step();
    w.input = { ...emptyInput(), pointerX: 430, pointerY: 300 };
    for (let i = 0; i < 14; i++) w.step();
    const hook = w.entities.find((e) => e.type === "grapple-hook")!;
    expect(hook.x).toBeGreaterThan(380);
    expect(hook.x).toBeLessThan(470);
  });

  it("jump while anchored vaults and releases the hook", () => {
    const { w, p } = world();
    for (let i = 0; i < 30; i++) w.step();
    w.input = { ...emptyInput(), shoot: true, pointerX: 430, pointerY: 200 };
    w.step();
    w.input = { ...emptyInput(), pointerX: 430, pointerY: 200 };
    for (let i = 0; i < 20; i++) w.step();
    w.input = { ...emptyInput(), jump: true, pointerX: 430, pointerY: 200 };
    w.step();
    expect(w.entities.some((e) => e.type === "grapple-hook")).toBe(false);
    expect(p.vy).toBeLessThan(0);
  });

  it("works for a keyboard-only player (no pointer fields)", () => {
    const { w } = world();
    for (let i = 0; i < 30; i++) w.step();
    w.input = { ...emptyInput(), shoot: true };
    w.step();
    expect(w.entities.some((e) => e.type === "grapple-hook")).toBe(true);
    for (let i = 0; i < 120; i++) w.step();
    for (const e of w.entities) expect(Number.isFinite(e.x) && Number.isFinite(e.y)).toBe(true);
  });

  it("hooks and ropes are projectile gear, never character art", () => {
    for (const t of ["grapple-hook", "hook", "grappling-hook", "rope-tether", "cable"]) {
      expect(entityKind(t)).not.toBe("creature");
      expect(artPlanFor(t)).toBe("none");
    }
  });
});
