import type { ModDefinition } from "../contract";

function overlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export const coinsMod: ModDefinition = {
  id: "coins",
  title: "Coins + score",
  knobs: {
    count: { value: 6, min: 1, max: 20, label: "Coin count" },
  },
  setup(api, knobs) {
    const n = Math.max(1, Math.floor(Number(knobs.count)));
    for (let i = 0; i < n; i++) {
      api.spawn({
        type: "coin",
        x: 300 + i * 140, y: 340, w: 16, h: 16,
        color: 0xffd94d, gravityScale: 0,
        data: { spin: i },
      });
    }
    api.onTick(() => {
      const player = api.player();
      if (!player) return;
      if (typeof player.data.score !== "number") player.data.score = 0;
      for (const c of api.byType("coin")) {
        if (overlap(player, c)) {
          api.burst(c.x + c.w / 2, c.y + c.h / 2, 0xffd94d, 12);
          api.despawn(c.id);
          player.data.score = Number(player.data.score) + 1;
        }
      }
    });
  },
  dispose(api) {
    for (const e of api.byType("coin")) api.despawn(e.id);
  },
  test(t) {
    t.expect(t.api.byType("coin").length >= 1, "coins spawn");
    // No player yet: stepping must be a safe no-op, never a crash.
    t.step(5);
    t.expect(t.api.byType("coin").length >= 1, "coins wait without player");
    const before = t.api.byType("coin").length;
    const coin = t.api.byType("coin")[0];
    t.api.spawn({
      type: "player", x: coin.x, y: coin.y, w: 26, h: 34,
      color: 0xffffff, gravityScale: 1,
    });
    t.step(5);
    t.expect(t.api.byType("coin").length === before - 1, "touching a coin collects it");
    t.expect(Number(t.api.player()?.data.score) === 1, "collect adds 1 to player score");
  },
};

export default coinsMod;
