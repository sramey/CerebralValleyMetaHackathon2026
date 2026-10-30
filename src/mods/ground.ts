import type { ModDefinition } from "../contract";

/**
 * The starter ground. The slab is centred on the play area (the platform-and-overhang stretch
 * around x = 120..1150), so the "Ground width" knob moves BOTH ends: narrowing brings a visible
 * cliff in beside the spawn, widening pushes it out and adds ground to run along. The whole knob
 * range stays within about two screens of the spawn, because a ground whose ends are both off
 * screen looks identical at every setting.
 *
 * It used to be anchored at x = -3200 with `width + 3000`, which put its right end at
 * `width - 200`: at the default 2400 that end was 2200 px away and at 6000 it was 5800 px away,
 * both far outside the ~960 px the camera shows, so the knob looked dead (bead r8n).
 */
const PLAY_MID = 575;
/** Shortest ground that still holds the whole starter level (the overhang tunnel ends at x = 1150). */
const MIN_WIDTH = 1200;
export const GROUND_DEFAULT_WIDTH = 2100;

export const groundMod: ModDefinition = {
  id: "ground",
  title: "Ground",
  knobs: {
    width: { value: GROUND_DEFAULT_WIDTH, min: MIN_WIDTH, max: 2800, label: "Ground width" },
    overhang: { value: true, label: "Rock overhang (a tunnel to duck under)" },
  },
  setup(api, knobs) {
    // Never narrower than the level: below the minimum the floor would end under the platforms.
    const w = Math.max(MIN_WIDTH, Number(knobs.width) || GROUND_DEFAULT_WIDTH);
    api.spawn({ type: "ground", x: PLAY_MID - w / 2, y: 400, w, h: 48, color: 0x3f9e4d, solid: true, gravityScale: 0 });
    api.spawn({ type: "platform", x: 420, y: 300, w: 150, h: 20, color: 0x8a6b46, solid: true, gravityScale: 0, data: { oneWay: true } });
    api.spawn({ type: "platform", x: 720, y: 220, w: 150, h: 20, color: 0x8a6b46, solid: true, gravityScale: 0, data: { oneWay: true } });
    // Stacked ledges for vertical play: one above the first ledge and a high perch above the second (a ledge low enough to hop on would slow the playtest bot and weaken the "too big" check, ADR 0023). All clear of the overhang tunnel (x 950-1150).
    api.spawn({ type: "platform", x: 360, y: 235, w: 100, h: 20, color: 0x8a6b46, solid: true, gravityScale: 0, data: { oneWay: true } });
    api.spawn({ type: "platform", x: 560, y: 145, w: 120, h: 20, color: 0x8a6b46, solid: true, gravityScale: 0, data: { oneWay: true } });
    // Cliff overhang: a 200 px tunnel with 72 px of clearance (ADR 0023): the 34 px player and anything up to about 2x fits, a "huge" 100 px one does not. The playtest uses it to tell whether the player still fits through the level (ADR 0013).
    if (knobs.overhang !== false) api.spawn({ type: "platform", x: 950, y: -600, w: 200, h: 928, color: 0x6b5236, solid: true, gravityScale: 0 });
  },
  dispose(api) {
    for (const e of [...api.byType("ground"), ...api.byType("platform")]) api.despawn(e.id);
  },
  test(t) {
    const ground = t.api.byType("ground");
    t.expect(ground.length === 1, "ground spawns");
    // The knob's default covers the whole starter level, tunnel included.
    if (ground[0]) {
      t.expect(ground[0].x <= 120 && ground[0].x + ground[0].w >= 1150, "default ground covers the level");
      t.expect(ground[0].w >= MIN_WIDTH && ground[0].w <= 2800, "default width is inside the knob's range");
    }
    t.step(120);
    t.expect(t.api.entities().every((e) => Number.isFinite(e.x + e.y)), "positions stay finite");
  },
};
export default groundMod;
