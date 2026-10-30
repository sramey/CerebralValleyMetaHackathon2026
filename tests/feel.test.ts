import { describe, it, expect } from "vitest";
import { Container } from "pixi.js";
import { Feel, FollowCam, HURT_TINT, INVULN_SECONDS, blinkAlpha, hurtFlashAlpha } from "../src/client/feel";
import type { Entity } from "../src/contract";

function ent(over: Partial<Entity>): Entity {
  return {
    id: 1, type: "player", x: 0, y: 0, w: 32, h: 48, vx: 0, vy: 0, color: 0xffffff, solid: false,
    gravityScale: 1, facing: 1, onGround: true, health: 100, owner: "", data: {},
    ...over,
  } as Entity;
}

describe("FollowCam", () => {
  it("looks ahead in the direction of travel and flips with it", () => {
    const cam = new FollowCam();
    let la = 0;
    for (let i = 0; i < 120; i++) la = cam.lookahead({ vx: 300 }, 1 / 60);
    expect(la).toBeGreaterThan(40);
    expect(la).toBeLessThanOrEqual(FollowCam.LOOKAHEAD);
    for (let i = 0; i < 240; i++) la = cam.lookahead({ vx: -300 }, 1 / 60);
    expect(la).toBeLessThan(-40);
  });

  it("ignores small vertical moves while airborne but follows big ones", () => {
    const cam = new FollowCam();
    expect(cam.smoothY(100, 100 - FollowCam.DEADZONE + 4, 1 / 60, false)).toBe(100);
    expect(cam.smoothY(100, 100 - 200, 1 / 60, false)).toBeLessThan(100);
  });

  it("settles exactly on the target when grounded", () => {
    const cam = new FollowCam();
    let y = 0;
    for (let i = 0; i < 600; i++) y = cam.smoothY(y, 80, 1 / 60, true);
    expect(y).toBeCloseTo(80, 1);
  });
});

describe("Feel", () => {
  it("squashes on landing, springs back to rest, and kicks up dust without touching the entity", () => {
    const feel = new Feel(new Container(), () => {});
    const p = ent({ onGround: false, vy: 700, y: 100 });
    feel.update([p], 1 / 60);
    p.onGround = true;
    const before = JSON.stringify(p);
    feel.update([p], 1 / 60);
    expect(JSON.stringify(p)).toBe(before);
    p.vy = 0;
    expect(feel.scaleOf(1).sy).toBeLessThan(0.9);
    expect(feel.scaleOf(1).sx).toBeGreaterThan(1.1);
    for (let i = 0; i < 120; i++) feel.update([p], 1 / 60);
    expect(feel.scaleOf(1).sy).toBeCloseTo(1, 1);
    expect(feel.scaleOf(1).sx).toBeCloseTo(1, 1);
  });

  it("flashes on damage and shakes only on a big hit", () => {
    const kicks: number[] = [];
    const feel = new Feel(new Container(), (a) => kicks.push(a));
    const e = ent({ id: 7, type: "goblin" });
    feel.update([e], 1 / 60);
    e.health = 95;
    feel.update([e], 1 / 60);
    expect(feel.tintOf(7)).not.toBe(0xffffff);
    expect(kicks).toHaveLength(0);
    e.health = 50;
    feel.update([e], 1 / 60);
    expect(kicks.length).toBe(1);
    for (let i = 0; i < 20; i++) feel.update([e], 1 / 60);
    expect(feel.tintOf(7)).toBe(0xffffff);
  });

  it("stays silent when shake is off", () => {
    const kicks: number[] = [];
    const feel = new Feel(new Container(), (a) => kicks.push(a), false);
    const e = ent({ id: 3, type: "goblin" });
    feel.update([e], 1 / 60);
    e.health = 10;
    feel.update([e], 1 / 60);
    expect(kicks).toHaveLength(0);
  });

  it("pops a collected coin only when the player is near, and forgets removed entities", () => {
    const feel = new Feel(new Container(), () => {});
    const player = ent({ id: 1, x: 100, y: 100 });
    const coin = ent({ id: 2, type: "coin", x: 110, y: 110, w: 16, h: 16, gravityScale: 0 });
    const far = ent({ id: 3, type: "coin", x: 900, y: 100, w: 16, h: 16, gravityScale: 0 });
    feel.update([player, coin, far], 1 / 60);
    feel.update([player], 1 / 60);
    // one ring + nine sparks from the near coin only
    const g = (feel as unknown as { parts: unknown[] }).parts;
    expect(g.length).toBe(10);
    expect(feel.scaleOf(2)).toEqual({ sx: 1, sy: 1 });
  });

  it("turns the player red, blinks and flashes the screen edges when they are hit (bead r8n)", () => {
    const feel = new Feel(new Container(), () => {});
    const player = ent({ id: 1, x: 100, y: 100 });
    feel.update([player], 1 / 60);
    player.health = 80;
    feel.update([player], 1 / 60);

    expect(feel.tintOf(1)).toBe(HURT_TINT); // a red player, not the brief white flash
    const pulse = (feel as unknown as { hurtPulse: number }).hurtPulse;
    expect(pulse).toBeGreaterThan(0.9);

    // The blink runs while the sim window is open, then the player is solid and normal again.
    expect(feel.alphaOf(1)).toBe(blinkAlpha(INVULN_SECONDS - 1 / 60));
    for (let i = 0; i < Math.ceil(INVULN_SECONDS * 60) + 4; i++) feel.update([player], 1 / 60);
    expect(feel.alphaOf(1)).toBe(1);
    expect(feel.tintOf(1)).toBe(0xffffff);
    expect((feel as unknown as { hurtPulse: number }).hurtPulse).toBe(0);
  });

  it("does not blink or wash the screen for a creature that got hit", () => {
    const feel = new Feel(new Container(), () => {});
    const goblin = ent({ id: 9, type: "goblin", x: 300 });
    feel.update([goblin], 1 / 60);
    goblin.health = 70;
    feel.update([goblin], 1 / 60);
    expect(feel.alphaOf(9)).toBe(1);
    expect((feel as unknown as { hurtPulse: number }).hurtPulse).toBe(0);
  });

  it("blinks on and off while invulnerable, and the flash fades to nothing", () => {
    const left = INVULN_SECONDS;
    const seen = new Set<number>();
    for (let t = left; t > 0; t -= 1 / 60) seen.add(blinkAlpha(t));
    expect(seen.has(1)).toBe(true);
    expect([...seen].some((a) => a < 1)).toBe(true);
    expect(blinkAlpha(0)).toBe(1);
    expect(hurtFlashAlpha(0)).toBe(0);
    expect(hurtFlashAlpha(1)).toBe(1);
    expect(hurtFlashAlpha(-1)).toBe(0);
    expect(hurtFlashAlpha(2)).toBe(1);
  });
});
