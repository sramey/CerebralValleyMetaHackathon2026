import type { ModDefinition } from "../contract";

const MIN_X = 200;
const MAX_X = 900;
const PECK_TICKS = 20;

export const chickenMod: ModDefinition = {
  id: "chicken",
  title: "Chicken",
  knobs: {
    count: { value: 2, min: 1, max: 6, label: "Chicken count" },
    speed: { value: 60, min: 20, max: 200, label: "Chicken speed" },
  },
  setup(api, knobs) {
    const n = Math.min(6, Math.max(1, Math.floor(Number(knobs.count))));
    const speed = Number(knobs.speed);
    for (let i = 0; i < n; i++) {
      const x = n === 1 ? 500 : 300 + (400 * i) / (n - 1);
      const e = api.spawn({
        type: "chicken",
        x, y: 360, w: 30, h: 26,
        color: 0xfff3c4, gravityScale: 1,
        data: {
          speed,
          turnCd: 60 + Math.floor(api.rand() * 120),
          peckCd: 120 + Math.floor(api.rand() * 120),
          peckT: 0,
          peck: 0,
        },
      });
      e.facing = api.rand() < 0.5 ? 1 : -1;
    }
    api.onTick(() => {
      for (const c of api.byType("chicken")) {
        const spd = Number(c.data.speed ?? speed);
        if (typeof c.data.turnCd !== "number") c.data.turnCd = 60;
        if (typeof c.data.peckCd !== "number") c.data.peckCd = 180;
        if (typeof c.data.peckT !== "number") c.data.peckT = 0;
        // Pecking: short pause.
        if (Number(c.data.peckT) > 0) {
          c.data.peckT = Number(c.data.peckT) - 1;
          c.vx = 0;
          c.data.peck = 1;
          continue;
        }
        c.data.peck = 0;
        c.vx = c.facing * spd;
        // Random-ish turnarounds.
        c.data.turnCd = Number(c.data.turnCd) - 1;
        if (Number(c.data.turnCd) <= 0) {
          if (api.rand() < 0.5) c.facing = c.facing === 1 ? -1 : 1;
          c.data.turnCd = 60 + Math.floor(api.rand() * 120);
        }
        // Hard bounds.
        if (c.x < MIN_X) c.facing = 1;
        if (c.x > MAX_X) c.facing = -1;
        // Peck timer.
        c.data.peckCd = Number(c.data.peckCd) - 1;
        if (Number(c.data.peckCd) <= 0) {
          c.data.peckT = PECK_TICKS;
          c.data.peckCd = 150 + Math.floor(api.rand() * 60);
          c.vx = 0;
          c.data.peck = 1;
        }
      }
    });
  },
  dispose(api) {
    for (const e of api.byType("chicken")) api.despawn(e.id);
  },
  test(t) {
    t.api.spawn({
      type: "ground", x: -200, y: 400, w: 1600, h: 40,
      solid: true, gravityScale: 0,
    });
    const before = t.api.byType("chicken").map((e) => e.x);
    t.expect(before.length >= 1, "chickens spawn");
    t.step(120);
    const after = t.api.byType("chicken");
    t.expect(after.length === before.length && after.length >= 1, "chickens survive 120 steps");
    const moved = after.some((e, i) => Math.abs(e.x - before[i]) > 1);
    t.expect(moved, "at least one chicken moved horizontally after 120 steps");
  },
};

export default chickenMod;
