import type { ModDefinition } from "../contract";

export const enemyMod: ModDefinition = {
  id: "enemies",
  title: "Walker enemies",
  knobs: { speed: { value: 70, min: 20, max: 240, label: "Walker speed" } },
  setup(api, knobs) {
    const speed = Number(knobs.speed);
    for (const x of [520, 860]) {
      const e = api.spawn({ type: "enemy", x, y: 360, w: 28, h: 28, color: 0xe2483d, gravityScale: 1, data: { minX: x - 90, maxX: x + 90 } });
      e.facing = 1;
    }
    api.onTick(() => {
      const player = api.player();
      for (const e of api.byType("enemy")) {
        e.vx = e.facing * speed;
        if (e.x < Number(e.data.minX)) e.facing = 1;
        if (e.x > Number(e.data.maxX)) e.facing = -1;
        if (player && player.vy > 0 && overlap(player, e) && player.y + player.h - e.y < 18) {
          api.burst(e.x + e.w / 2, e.y, 0xe2483d, 14);
          api.despawn(e.id);
          player.vy = -420;
        }
      }
    });
  },
  dispose(api) {
    for (const e of api.byType("enemy")) api.despawn(e.id);
  },
  test(t) {
    const before = t.api.byType("enemy").length;
    t.expect(before === 2, "two walkers spawn");
    t.step(60);
    t.expect(t.api.byType("enemy").every((e) => e.vx !== 0), "walkers move");
  },
};
function overlap(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
export default enemyMod;
