import type { ModDefinition } from "../contract";

export const playerMod: ModDefinition = {
  id: "player",
  title: "Player",
  knobs: {
    speed: { value: 260, min: 80, max: 600, label: "Move speed" },
    jump: { value: 720, min: 300, max: 1100, label: "Jump power" },
  },
  setup(api, knobs) {
    const p = api.spawn({ type: "player", x: 120, y: 40, w: 26, h: 34, color: 0xffc94d, gravityScale: 1 });
    api.onTick(() => {
      const input = api.input();
      const speed = Number(knobs.speed);
      p.vx = input.left ? -speed : input.right ? speed : 0;
      if (p.vx !== 0) p.facing = p.vx > 0 ? 1 : -1;
      if (input.jump && p.onGround) p.vy = -Number(knobs.jump);
    });
  },
  dispose(api) {
    for (const e of api.byType("player")) api.despawn(e.id);
  },
  test(t) {
    t.step(90);
    const p = t.api.player();
    t.expect(!!p, "player spawns");
    if (p) t.expect(Number.isFinite(p.x) && Number.isFinite(p.y), "player position is finite");
  },
};
export default playerMod;
