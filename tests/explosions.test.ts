import { describe, expect, it } from "vitest";
import { Container } from "pixi.js";
import { Fx } from "../src/client/fx";
import { World } from "../src/sim/world";
import { ModLoader } from "../src/sim/loader";
import type { ModDefinition } from "../src/contract";

describe("explosions and bursts (bead metabuild-ideation-epl)", () => {
  it("only shakes screen for on-screen explosion bursts, ignoring off-screen bursts", () => {
    const stage = new Container();
    const fx = new Fx(stage);
    const world = new World(1);

    // Initial render to establish camera at camX = 100, camY = 100, W = 800, H = 600
    fx.render(world, 100, 100, 800, 600, 1 / 60, () => false);
    expect(fx.shakeX).toBe(0);
    expect(fx.shakeY).toBe(0);

    // Spawn an off-screen burst cluster far to the right (x = 3000, y = 200)
    world.burst(3000, 200, 0xff5500, 18);
    // Render: off-screen burst must NOT trigger camera shake
    fx.render(world, 100, 100, 800, 600, 1 / 60, () => false);
    expect(fx.shakeX).toBe(0);
    expect(fx.shakeY).toBe(0);

    // Spawn an on-screen burst cluster (x = 400, y = 300, well inside 100..900)
    world.burst(400, 300, 0xff5500, 18);
    // Render: on-screen burst triggers camera shake
    fx.render(world, 100, 100, 800, 600, 1 / 60, () => false);
    expect(Math.abs(fx.shakeX) + Math.abs(fx.shakeY)).toBeGreaterThan(0);
  });

  it("regression: off-screen falling debris does not shake the player viewport", () => {
    const stage = new Container();
    const fx = new Fx(stage);
    const world = new World(1);

    // Player viewport centered near x = 200
    fx.render(world, 0, 0, 960, 540, 1 / 60, () => false);

    // An off-screen debris impact at x = -800, y = 400
    world.burst(-800, 400, 0xff7733, 20);
    fx.render(world, 0, 0, 960, 540, 1 / 60, () => false);

    expect(fx.shakeX).toBe(0);
    expect(fx.shakeY).toBe(0);
  });

  it("projectiles despawn cleanly on expiration without triggering bursts", () => {
    const world = new World(1);
    const loader = new ModLoader(world);

    // A mod following prompt rules: fires a projectile that despawns quietly on expiration
    const mod: ModDefinition = {
      id: "silent-despawn",
      title: "Silent Despawn",
      dispose(api) { for (const e of api.byType("laser-bolt")) api.despawn(e.id); },
      setup(api) {
        api.spawn({
          type: "laser-bolt",
          x: 100,
          y: 200,
          w: 12,
          h: 4,
          vx: 400,
          vy: 0,
          solid: false,
          gravityScale: 0,
          data: { life: 5, visual: "projectile" },
        });

        api.onTick(() => {
          for (const b of api.byType("laser-bolt")) {
            b.data.life = Number(b.data.life ?? 5) - 1;
            if (b.data.life <= 0) {
              // Quiet despawn without api.burst
              api.despawn(b.id);
            }
          }
        });
      },
    };

    loader.load(mod);
    expect(world.entities.filter((e) => e.type === "laser-bolt")).toHaveLength(1);
    expect(world.particles).toHaveLength(0);

    // Step 10 frames: projectile expires and despawns silently
    for (let i = 0; i < 10; i++) world.step();

    expect(world.entities.filter((e) => e.type === "laser-bolt")).toHaveLength(0);
    // No bursts or particles were spawned
    expect(world.particles).toHaveLength(0);
  });
});
