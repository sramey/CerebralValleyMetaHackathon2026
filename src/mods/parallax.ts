import type { ModDefinition } from "../contract";

const PARALLAX_TYPES = ["parallax-mountain", "cloud", "parallax-hill", "parallax-forest"] as const;

export const parallaxMod: ModDefinition = {
  id: "parallax",
  title: "Parallax vista",
  knobs: {
    layers: { value: 4, min: 2, max: 4, label: "Depth layers" },
    speed: { value: 100, min: 25, max: 200, label: "Scroll depth (%)" },
  },
  setup(api, knobs) {
    const layers = Math.max(2, Math.min(4, Math.round(Number(knobs.layers) || 4)));
    const scale = Math.max(0.25, Math.min(2.0, (Number(knobs.speed) || 100) / 100));
    const wrapWidth = 1920;

    // Layer 1: Distant jagged mountain peaks (0.14x camera scroll)
    for (let i = 0; i < 4; i++) {
      api.spawn({
        type: "parallax-mountain",
        x: i * 480,
        y: 140,
        w: 520,
        h: 230 + (i % 2) * 45,
        color: 0x162c3a,
        gravityScale: 0,
        data: { parallax: Math.min(0.9, 0.14 * scale), wrapWidth },
      });
    }

    // Layer 2: High drifting clouds (0.20x camera scroll)
    if (layers >= 2) {
      for (let i = 0; i < 4; i++) {
        api.spawn({
          type: "cloud",
          x: i * 460 + 80,
          y: -340 + (i % 3) * 48,
          w: 130 + (i % 2) * 36,
          h: 44 + (i % 2) * 10,
          vx: 8 + (i % 3) * 3,
          color: 0xdceeff,
          gravityScale: 0,
          data: { parallax: Math.min(0.9, 0.20 * scale), wrapWidth },
        });
      }
    }

    // Layer 3: Mid-distance rolling hills (0.34x camera scroll)
    if (layers >= 3) {
      for (let i = 0; i < 5; i++) {
        api.spawn({
          type: "parallax-hill",
          x: i * 384,
          y: 240,
          w: 440,
          h: 135 + (i % 3) * 24,
          color: 0x1b3a46,
          gravityScale: 0,
          data: { parallax: Math.min(0.9, 0.34 * scale), wrapWidth },
        });
      }
    }

    // Layer 4: Near-distance pine forest treeline (0.54x camera scroll)
    if (layers >= 4) {
      for (let i = 0; i < 6; i++) {
        api.spawn({
          type: "parallax-forest",
          x: i * 320,
          y: 280,
          w: 300,
          h: 115 + (i % 2) * 28,
          color: 0x1d463a,
          gravityScale: 0,
          data: { parallax: Math.min(0.9, 0.54 * scale), wrapWidth },
        });
      }
    }
  },
  dispose(api) {
    for (const t of PARALLAX_TYPES) {
      for (const e of api.byType(t)) api.despawn(e.id);
    }
  },
  test(t) {
    const mountains = t.api.byType("parallax-mountain");
    const clouds = t.api.byType("cloud");
    const hills = t.api.byType("parallax-hill");
    const forest = t.api.byType("parallax-forest");
    t.expect(mountains.length >= 2, "distant mountains spawn");
    t.expect(clouds.length >= 2, "clouds spawn in upper sky");
    t.expect(hills.length >= 2, "mid hills spawn");
    t.expect(forest.length >= 2, "near forest treeline spawns");
    t.expect(
      Number(mountains[0].data.parallax) < Number(hills[0].data.parallax) &&
        Number(hills[0].data.parallax) < Number(forest[0].data.parallax),
      "parallax factors increase from far to near",
    );
    t.step(60);
    t.expect(t.api.entities().every((e) => Number.isFinite(e.x + e.y)), "positions remain finite");
  },
};

export default parallaxMod;
