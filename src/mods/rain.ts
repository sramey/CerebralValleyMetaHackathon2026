import type { ModDefinition } from "../contract";

export const rainMod: ModDefinition = {
  id: "rain",
  title: "Rain",
  knobs: { rate: { value: 3, min: 1, max: 10, label: "Rain rate" } },
  setup(api, knobs) {
    api.onTick(() => {
      // Cleanup runs every tick: onGround is only set for the tick a drop
      // lands (vy is zeroed and physics resets it next tick), so gating
      // cleanup behind the spawn cadence would miss most landed drops.
      const p0 = api.player();
      for (const d of api.byType("raindrop")) if (d.onGround || d.y > (p0 ? p0.y + 260 : 460)) api.despawn(d.id);
      if (api.tick() % 3 !== 0) return;
      const p = api.player();
      const cx = p ? p.x + p.w / 2 : 200;
      const topY = p ? p.y - 560 : -560;
      for (let i = 0; i < Number(knobs.rate); i++) {
        const drop = api.spawn({
          type: "raindrop", x: cx - 750 + api.rand() * 1500, y: topY + api.rand() * 40, w: 3, h: 14,
          color: 0x6ec6ff, gravityScale: 0, data: {},
        });
        drop.vy = 620;
        drop.vx = -60;
      }
      for (const d of api.byType("raindrop")) if (d.onGround || d.y > (p ? p.y + 260 : 460)) api.despawn(d.id);
    });
  },
  dispose(api) {
    for (const e of api.byType("raindrop")) api.despawn(e.id);
  },
  test(t) {
    t.step(30);
    t.expect(t.api.byType("raindrop").length > 0, "rain falls");
  },
};
export default rainMod;
