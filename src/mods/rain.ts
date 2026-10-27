import type { ModDefinition } from "../contract";

export const rainMod: ModDefinition = {
  id: "rain",
  title: "Rain",
  knobs: { rate: { value: 3, min: 1, max: 10, label: "Rain rate" } },
  setup(api, knobs) {
    api.onTick(() => {
      if (api.tick() % 3 !== 0) return;
      const camX = api.player()?.x ?? 200;
      for (let i = 0; i < Number(knobs.rate); i++) {
        const drop = api.spawn({
          type: "raindrop", x: camX - 400 + api.rand() * 900, y: -20, w: 3, h: 14,
          color: 0x6ec6ff, gravityScale: 0, data: {},
        });
        drop.vy = 620;
        drop.vx = -60;
      }
      for (const d of api.byType("raindrop")) if (d.y > 420) api.despawn(d.id);
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
