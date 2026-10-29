import type { ModDefinition } from "../contract";

export const groundMod: ModDefinition = {
  id: "ground",
  title: "Ground",
  knobs: {
    width: { value: 2400, min: 600, max: 6000, label: "Ground width" },
    overhang: { value: true, label: "Rock overhang (a tunnel to duck under)" },
  },
  setup(api, knobs) {
    // The slab runs 3000 px further left than the "width" knob's right edge (x=-200+width), so the camera never shows its left end at any screen size.
    const w = Number(knobs.width) + 3000;
    api.spawn({ type: "ground", x: -3200, y: 400, w, h: 48, color: 0x3f9e4d, solid: true, gravityScale: 0 });
    api.spawn({ type: "platform", x: 420, y: 300, w: 150, h: 20, color: 0x8a6b46, solid: true, gravityScale: 0, data: { oneWay: true } });
    api.spawn({ type: "platform", x: 720, y: 220, w: 150, h: 20, color: 0x8a6b46, solid: true, gravityScale: 0, data: { oneWay: true } });
    // Cliff overhang: a 200 px tunnel with 100 px of clearance. The playtest uses it to tell whether the player still fits through the level (ADR 0013).
    if (knobs.overhang !== false) api.spawn({ type: "platform", x: 950, y: -600, w: 200, h: 900, color: 0x6b5236, solid: true, gravityScale: 0 });
  },
  dispose(api) {
    for (const e of [...api.byType("ground"), ...api.byType("platform")]) api.despawn(e.id);
  },
  test(t) {
    t.expect(t.api.byType("ground").length === 1, "ground spawns");
    t.step(120);
    t.expect(t.api.entities().every((e) => Number.isFinite(e.x + e.y)), "positions stay finite");
  },
};
export default groundMod;
