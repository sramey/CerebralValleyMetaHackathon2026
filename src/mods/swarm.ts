import type { ModDefinition, WaveController } from "../contract";
import { WaveController as WaveControllerClass } from "../sim/waves";

let activeController: WaveController | undefined;

export const swarmMod: ModDefinition = {
  id: "swarm",
  title: "Swarm waves",
  knobs: {
    baseWaveSize: { value: 5, min: 3, max: 20, label: "Starting wave size" },
    baseSpeed: { value: 75, min: 30, max: 200, label: "Enemy base speed" },
  },
  setup(api, knobs) {
    const baseWaveSize = Number(knobs.baseWaveSize) || 5;
    const baseSpeed = Number(knobs.baseSpeed) || 75;

    activeController = api.createWaveController
      ? api.createWaveController({
          baseWaveSize,
          baseSpeed,
          killsPerLevel: 5,
        })
      : new WaveControllerClass(api, {
          baseWaveSize,
          baseSpeed,
          killsPerLevel: 5,
        });
  },
  dispose(api) {
    if (activeController) {
      activeController.dispose();
      activeController = undefined;
    }
    for (const e of api.entities()) {
      if (e.data.swarm === true || e.owner === "swarm") {
        api.despawn(e.id);
      }
    }
  },
  test(t) {
    // Verifier runs in an empty world: spawn ground and player first
    t.api.spawn({ type: "ground", x: -200, y: 400, w: 1400, h: 48, solid: true, gravityScale: 0 });
    t.api.spawn({ type: "player", x: 400, y: 360, w: 26, h: 34, color: 0x3fd06a, solid: false, gravityScale: 1 });

    t.step(10);
    const enemies = t.api.entities().filter((e) => e.data.swarm === true || e.owner === "swarm");
    t.expect(enemies.length > 0, "swarm enemies spawned");

    // Level progression must be paced by real kills, never runaway per frame
    t.expect(!!activeController, "wave controller initialized");
    if (activeController) {
      t.step(60);
      t.expect(activeController.getLevel() === 1, "level stays at 1 without defeats (no runaway timer)");

      // Defeat 4 enemies: must remain level 1
      for (let i = 0; i < 4; i++) {
        activeController.recordKill();
      }
      t.step(2);
      t.expect(activeController.getLevel() === 1, "level stays at 1 with 4 kills");

      // 5th kill triggers Level 2
      activeController.recordKill();
      t.step(2);
      t.expect(activeController.getLevel() === 2, "levels up to 2 after 5 kills");
      const hud = t.api.hud("wave");
      t.expect(!!hud && hud.kind === "banner", "wave HUD banner announced level up");
    }
  },
};

export default swarmMod;
