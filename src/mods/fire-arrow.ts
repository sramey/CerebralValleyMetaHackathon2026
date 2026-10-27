import type { ModDefinition } from "../contract";

function overlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export const fireArrowMod: ModDefinition = {
  id: "fire-arrow",
  title: "Fire arrow",
  knobs: {
    speed: { value: 560, min: 200, max: 1000, label: "Arrow speed" },
    cooldown: { value: 18, min: 1, max: 120, label: "Cooldown (ticks)" },
  },
  setup(api, knobs) {
    const speed = Number(knobs.speed);
    const cooldown = Math.max(1, Math.floor(Number(knobs.cooldown)));
    let lastShot = -100000;
    api.onTick(() => {
      for (const a of api.byType("fire-arrow")) {
        a.data.age = Number(a.data.age ?? 0) + 1;
        if (Number(a.data.age) % 2 === 0) {
          api.burst(a.x + a.w / 2, a.y + a.h / 2, 0xffa030, 1);
        }
        let hit = Number(a.data.age) > 0 && a.vx === 0;
        if (!hit) {
          for (const s of api.entities()) {
            if (s.solid && overlap(a, s)) { hit = true; break; }
          }
        }
        if (hit) {
          api.burst(a.x + a.w / 2, a.y + a.h / 2, 0xff6a00, 12);
          api.despawn(a.id);
          continue;
        }
        if (Number(a.data.age) > 180) api.despawn(a.id);
      }
      const player = api.player();
      if (!player) return;
      if (!api.input().shoot) return;
      if (api.tick() - lastShot < cooldown) return;
      lastShot = api.tick();
      const dir = player.facing;
      api.spawn({
        type: "fire-arrow",
        x: dir > 0 ? player.x + player.w : player.x - 12,
        y: player.y + player.h / 2 - 3,
        w: 12, h: 6, vx: dir * speed, vy: 0,
        color: 0xff6a00, gravityScale: 0,
        data: { age: 0 },
      });
    });
  },
  dispose(api) {
    for (const e of api.byType("fire-arrow")) api.despawn(e.id);
  },
  test(t) {
    // No player: shooting must be a safe no-op, never a crash.
    t.step(10, { shoot: true });
    t.expect(t.api.byType("fire-arrow").length === 0, "no arrows without a player");
    const p = t.api.spawn({
      type: "player", x: 100, y: 300, w: 26, h: 34,
      color: 0xffffff, gravityScale: 0,
    });
    p.facing = 1;
    t.api.spawn({
      type: "wall", x: 300, y: 0, w: 40, h: 600,
      color: 0x888888, solid: true, gravityScale: 0,
    });
    t.step(1, { shoot: true });
    t.expect(t.api.byType("fire-arrow").length >= 1, "shoot input spawns an arrow");
    t.step(120);
    t.expect(t.api.byType("fire-arrow").length === 0, "arrow bursts and despawns on solid impact");
  },
};

export default fireArrowMod;
