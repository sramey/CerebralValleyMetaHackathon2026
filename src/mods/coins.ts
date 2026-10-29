import type { ModDefinition } from "../contract";

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
    api.setHud("score", { kind: "stat", label: "Coins", icon: "🪙", value: 0, position: "top-left" });
    api.onTick(() => {
      const player = api.player();
      if (!player) return;
      if (typeof player.data.score !== "number") player.data.score = 0;
      for (const c of api.byType("coin")) {
        if (api.touches(player, c)) {
          api.burst(c.x + c.w / 2, c.y + c.h / 2, 0xffd94d, 12);
          api.despawn(c.id);
          player.data.score = Number(player.data.score) + 1;
        }
      }
      // Live score HUD (ADR 0019): updates the moment a coin is collected.
      api.setHud("score", { kind: "stat", label: "Coins", icon: "🪙", value: Number(player.data.score), position: "top-left" });
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
    const scoreHud = t.api.hud("score");
    t.expect(!!scoreHud && scoreHud.value === 1, "score HUD shows 1 after collecting");
  },
};

export default coinsMod;
