import type { ModDefinition } from "../contract";

export const movingPlatformMod: ModDefinition = {
  id: "moving-platform",
  title: "Moving platform",
  knobs: {
    range: { value: 120, min: 20, max: 400, label: "Travel range (px)" },
    period: { value: 3, min: 1, max: 10, label: "Oscillation period (s)" },
  },
  setup(api, knobs) {
    const range = Number(knobs.range);
    const period = Math.max(0.25, Number(knobs.period));
    const plat = api.spawn({
      type: "moving-platform",
      x: 560, y: 280, w: 140, h: 18,
      color: 0x7a5cff, solid: true, gravityScale: 0,
      data: { baseX: 560 },
    });
    api.onTick(() => {
      // Deterministic kinematic motion from the seeded tick clock only.
      const time = api.tick() / 60;
      plat.x = Number(plat.data.baseX) + Math.sin((time / period) * Math.PI * 2) * range;
    });
  },
  dispose(api) {
    for (const e of api.byType("moving-platform")) api.despawn(e.id);
  },
  test(t) {
    const plats = t.api.byType("moving-platform");
    t.expect(plats.length === 1, "one moving platform spawns");
    t.expect(plats[0]?.solid === true, "platform is solid");
    const x0 = plats[0]?.x ?? 0;
    t.step(30);
    const x1 = t.api.byType("moving-platform")[0]?.x ?? 0;
    t.expect(Number.isFinite(x1), "platform position stays finite");
    t.expect(x1 !== x0, "platform oscillates over time");
    t.step(120);
    const x2 = t.api.byType("moving-platform")[0]?.x ?? 0;
    t.expect(Number.isFinite(x2), "platform stays finite over longer runs");
  },
};

export default movingPlatformMod;
