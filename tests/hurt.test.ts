// Getting hurt is now obvious (bead r8n): a hit on the player opens a short invulnerability
// window and knocks them back, away from whatever hit them. Both live in the sim (ADR 0070) so
// the verifier, the playtest bot and the browser all get the same hit, and a player mod that
// rewrites `vx` from the input every tick cannot swallow the knockback.
import { describe, expect, it } from "vitest";
import { emptyInput } from "../src/contract";
import type { Entity, ModDefinition } from "../src/contract";
import { ModLoader } from "../src/sim/loader";
import { World } from "../src/sim/world";
import {
  HURT_INVULN_TICKS,
  KNOCKBACK_LIFT,
  KNOCKBACK_TICKS,
  invulnerable,
  knockbackDirection,
  knockbackVelocity,
  launchKnockback,
} from "../src/sim/hurt";

/** A player mod like the built-in one: it owns vx every tick, which used to erase any knockback. */
const pinningPlayer: ModDefinition = {
  id: "player",
  title: "Player",
  setup(api) {
    const p = api.spawn({ type: "player", x: 200, y: 340, w: 26, h: 34, color: 0xffc94d, gravityScale: 1 });
    api.onTick(() => {
      const input = api.input();
      p.vx = input.left ? -260 : input.right ? 260 : 0;
      if (input.jump && p.onGround) p.vy = -720;
    });
  },
  dispose() {},
};

function world(): { w: World; p: Entity; foe: Entity } {
  const w = new World(11);
  w.spawn({ type: "ground", x: -600, y: 400, w: 3000, h: 60, solid: true, gravityScale: 0 }, "ground");
  const p = w.spawn({ type: "player", x: 200, y: 340, w: 26, h: 34, gravityScale: 1 }, "player");
  const foe = w.spawn({ type: "goblin", x: 320, y: 350, w: 28, h: 30, gravityScale: 1, data: { hostile: true } }, "enemies");
  return { w, p, foe };
}

describe("a hit on the player: invulnerability and knockback (ADR 0070)", () => {
  it("lands once, then nothing for the window, then lands again", () => {
    const { w, p } = world();
    w.damage(p.id, 12);
    expect(p.health).toBe(88);
    expect(invulnerable(p, w.tickCount)).toBe(true);

    w.damage(p.id, 12);
    w.damage(p.id, 12);
    expect(p.health).toBe(88); // still blinking: two more hits cost nothing

    for (let i = 0; i < HURT_INVULN_TICKS; i++) w.step();
    expect(invulnerable(p, w.tickCount)).toBe(false);
    w.damage(p.id, 12);
    expect(p.health).toBe(76);
  });

  it("does not change damage to anything but the player", () => {
    const { w, foe } = world();
    w.damage(foe.id, 10);
    w.damage(foe.id, 10);
    expect(foe.health).toBe(80); // no invulnerability for a creature
  });

  it("knocks the player away from what hit them", () => {
    const { w, p, foe } = world();
    const before = p.x;
    w.damage(p.id, 10);
    for (let i = 0; i < KNOCKBACK_TICKS; i++) w.step();
    // The goblin is to the right, so the player is pushed left.
    expect(foe.x).toBeGreaterThan(before);
    expect(p.x).toBeLessThan(before);
    expect(before - p.x).toBeGreaterThan(6); // a nudge you can see, not a teleport
  });

  it("survives a player mod that rewrites vx every tick", () => {
    const w = new World(5);
    const loader = new ModLoader(w);
    w.spawn({ type: "ground", x: -600, y: 400, w: 3000, h: 60, solid: true, gravityScale: 0 }, "ground");
    loader.load(pinningPlayer);
    const p = w.entities.find((e) => e.type === "player")!;
    w.spawn({ type: "goblin", x: 320, y: 350, w: 28, h: 30, data: { hostile: true } }, "enemies");
    for (let i = 0; i < 3; i++) w.step(); // settle on the ground, vx pinned to 0 by the mod
    const before = p.x;
    w.damage(p.id, 10);
    for (let i = 0; i < KNOCKBACK_TICKS; i++) w.step();
    expect(p.x).toBeLessThan(before);
  });

  it("lifts the player off the ground on the tick the hit lands", () => {
    const { w, p } = world();
    for (let i = 0; i < 30; i++) w.step();
    expect(p.onGround).toBe(true);
    w.damage(p.id, 10);
    let airborne = false;
    for (let i = 0; i < 4; i++) { w.step(); if (!p.onGround) airborne = true; }
    expect(airborne).toBe(true);
  });

  it("is deterministic: two identical worlds stay identical", () => {
    const a = world();
    const b = world();
    for (const run of [a, b]) {
      run.w.damage(run.p.id, 15);
      for (let i = 0; i < 90; i++) { run.w.input = { ...emptyInput(), right: i % 7 === 0 }; run.w.step(); }
    }
    expect(a.p.x).toBe(b.p.x);
    expect(a.p.y).toBe(b.p.y);
    expect(a.p.health).toBe(b.p.health);
  });

  it("pushes backwards when nothing is close enough to blame", () => {
    const w = new World(3);
    const p = w.spawn({ type: "player", x: 200, y: 340, w: 26, h: 34, gravityScale: 1 }, "player");
    p.facing = 1;
    expect(knockbackDirection(p, w.entities)).toBe(-1); // facing right, hit from nowhere: knocked left
    p.facing = -1;
    expect(knockbackDirection(p, w.entities)).toBe(1);
  });

  it("fades to nothing and never re-lifts", () => {
    const k = launchKnockback({ x: 200, y: 340, w: 26, h: 34, facing: 1 }, []);
    expect(k.vy).toBe(-KNOCKBACK_LIFT);
    expect(knockbackVelocity(k).vy).toBe(-KNOCKBACK_LIFT);
    const later = { ...k, ticks: k.ticks - 3 };
    expect(knockbackVelocity(later).vy).toBe(0);
    expect(Math.abs(knockbackVelocity(later).vx)).toBeLessThan(Math.abs(knockbackVelocity(k).vx));
    expect(knockbackVelocity({ ...k, ticks: 0 }).vx).toBeCloseTo(0);
    expect(knockbackVelocity({ ...k, ticks: 0 }).vy).toBeCloseTo(0);
  });

  it("stops a hostile's contact damage repeating every tick", () => {
    const w = new World(9);
    w.spawn({ type: "ground", x: -400, y: 400, w: 2000, h: 60, solid: true, gravityScale: 0 }, "ground");
    const p = w.spawn({ type: "player", x: 200, y: 340, w: 26, h: 34, gravityScale: 1 }, "player");
    // A zombie sitting right on the player: contact damage every tick without a window.
    const zombie = w.spawn({ type: "zombie", x: 198, y: 340, w: 30, h: 34, gravityScale: 1, data: { hostile: true, damage: 10 } }, "wave");
    /** Hold the zombie on the player, so the hit is about the window and not about the knockback separating them. */
    const stepTogether = (n: number): void => {
      for (let i = 0; i < n; i++) { zombie.x = p.x - 2; zombie.y = p.y; w.step(); }
    };
    stepTogether(6);
    expect(p.health).toBe(90); // one hit, not six
    stepTogether(HURT_INVULN_TICKS + 6);
    expect(p.health).toBe(80); // and the next hit lands once the blink is over
  });
});
