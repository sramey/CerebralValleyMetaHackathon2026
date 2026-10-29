import { describe, expect, it } from "vitest";
import { Container } from "pixi.js";
import { Portal, isProjectileOrAttachment } from "../src/client/portal";
import { computePrimaries, framesFor, isProjectileType } from "../src/client/sprites";
import { kindOf } from "../src/client/shapes";
import { World } from "../src/sim/world";
import type { Entity } from "../src/contract";

describe("metabuild-ideation-38u: portal cleanup, spawn gating, and projectile visibility", () => {
  it("Bug A: Portal clears and hides masks when rips expire", () => {
    const stage = new Container();
    const portal = new Portal(stage);
    const world = new World(1);

    // Initial world prime
    portal.render(world, 0, 0, 0.016, () => false);
    expect(portal.ripCount).toBe(0);

    // Spawn an entity to trigger a portal rip
    const ent: Entity = {
      id: 101,
      type: "alien",
      x: 100,
      y: 100,
      w: 48,
      h: 48,
      vx: 0,
      vy: 0,
      color: 0x00ff00,
      solid: true,
      gravityScale: 1,
      facing: 1,
      onGround: true,
      health: 100,
      owner: "mod-alien",
      data: {},
    };
    world.entities.push(ent);

    // Render 1 frame: rip opens, mask should be active
    portal.render(world, 0, 0, 0.016, () => false);
    expect(portal.ripCount).toBe(1);
    expect(portal.activeMaskCount).toBe(1);

    // Advance 25 frames (25 * 0.04s = 1.0s > LIFE of 0.8s) so the rip expires
    for (let f = 0; f < 25; f++) {
      portal.render(world, 0, 0, 0.04, () => false);
    }
    expect(portal.ripCount).toBe(0);
    // Unused mask slot must be cleared and hidden (visible === false) so no white dot blob remains!
    expect(portal.activeMaskCount).toBe(0);
  });

  it("Bug B: Portals only trigger once on initial entrance; repeated projectiles/shots never trigger portals", () => {
    const stage = new Container();
    const portal = new Portal(stage);
    const world = new World(1);

    // Initial prime
    portal.render(world, 0, 0, 0.016, () => false);

    // 1. Projectiles are recognized by isProjectileOrAttachment
    expect(isProjectileOrAttachment({ type: "boss-bullet" })).toBe(true);
    expect(isProjectileOrAttachment({ type: "player-bullet" })).toBe(true);
    expect(isProjectileOrAttachment({ type: "fire-arrow" })).toBe(true);
    expect(isProjectileOrAttachment({ type: "magic-missile" })).toBe(true);
    expect(isProjectileOrAttachment({ type: "laser-beam" })).toBe(true);
    expect(isProjectileOrAttachment({ type: "plasma-shot" })).toBe(true);
    expect(isProjectileOrAttachment({ type: "custom-ball", data: { fromPlayer: true } })).toBe(true);
    expect(isProjectileOrAttachment({ type: "custom-sword", data: { heldByPlayer: true } })).toBe(true);
    expect(isProjectileOrAttachment({ type: "evil-boss" })).toBe(false);

    // 2. Boss spawns initially -> rip opens
    const boss: Entity = {
      id: 201,
      type: "evil-boss",
      x: 200,
      y: 200,
      w: 80,
      h: 80,
      vx: 0,
      vy: 0,
      color: 0xff0000,
      solid: true,
      gravityScale: 0,
      facing: 1,
      onGround: false,
      health: 100,
      owner: "evil-boss-mod",
      data: {},
    };
    world.entities.push(boss);
    portal.render(world, 0, 0, 0.016, () => false);
    expect(portal.ripCount).toBe(1);

    // 3. Boss shoots "boss-bullet" repeatedly -> must NEVER trigger another portal
    for (let bulletId = 202; bulletId <= 210; bulletId++) {
      world.entities.push({
        id: bulletId,
        type: "boss-bullet",
        x: 240,
        y: 240,
        w: 12,
        h: 12,
        vx: -200,
        vy: 0,
        color: 0xff4400,
        solid: false,
        gravityScale: 0,
        facing: -1,
        onGround: false,
        health: 1,
        owner: "evil-boss-mod",
        data: {},
      });
      portal.render(world, 0, 0, 0.016, () => false);
      // Rip count should not increase due to bullet
      expect(portal.ripCount).toBe(1);
    }

    // 4. A minion with same type as previously seen does not open a second portal
    world.entities.push({
      id: 211,
      type: "evil-boss",
      x: 200,
      y: 200,
      w: 80,
      h: 80,
      vx: 0,
      vy: 0,
      color: 0xff0000,
      solid: true,
      gravityScale: 0,
      facing: 1,
      onGround: false,
      health: 100,
      owner: "evil-boss-mod",
      data: {},
    });
    portal.render(world, 0, 0, 0.016, () => false);
    expect(portal.ripCount).toBe(1);
  });

  it("Bug C: 'boss-bullet' is never matched to creature spritesheet and always treated as projectile", () => {
    // Projectile matcher
    expect(isProjectileType("boss-bullet")).toBe(true);
    expect(isProjectileType("player-bullet")).toBe(true);
    expect(isProjectileType("laser")).toBe(true);
    expect(isProjectileType("evil-boss")).toBe(false);

    // framesFor: mock textures
    const mockTex = {} as any;
    const framesBySubject: Record<string, any[]> = {
      boss: [mockTex, mockTex],
    };

    // "evil-boss" contains "boss" and is NOT a projectile -> returns frames
    const bossFrames = framesFor(framesBySubject, "evil-boss", false);
    expect(bossFrames.length).toBe(2);

    // "boss-bullet" contains "boss" BUT is a projectile -> MUST return []!
    const bulletFrames = framesFor(framesBySubject, "boss-bullet", false);
    expect(bulletFrames.length).toBe(0);

    // kindOf for boss-bullet must be undefined (not intercepted by shape fallback)
    expect(kindOf("boss-bullet")).toBeUndefined();

    // computePrimaries test
    const entities = [
      { id: 1, owner: "boss-mod", type: "evil-boss", w: 120, h: 120 },
      { id: 2, owner: "boss-mod", type: "boss-bullet", w: 12, h: 12 },
    ];
    const primaries = computePrimaries(entities, framesBySubject);
    expect(primaries.has(1)).toBe(true);
    expect(primaries.has(2)).toBe(false); // bullet is not in primaries
  });
});
