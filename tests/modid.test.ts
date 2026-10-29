import { describe, expect, it } from "vitest";
import { forceModId } from "../server/modid";

describe("forceModId", () => {
  it("rewrites the mod's own id and nothing else", () => {
    const src = `export default { id: "huge-player", title: "Huge", setup(api) { api.spawn({ type: "player", x: 0, y: 0, w: 1, h: 1, data: { id: "x" } }); } };`;
    const out = forceModId(src, "player");
    expect(out).toContain(`id: "player"`);
    expect(out).toContain(`data: { id: "x" }`);
  });
  it("keeps the quote style and leaves id-less source alone", () => {
    expect(forceModId(`export default { id: 'a', title: 'A' }`, "b")).toContain(`id: 'b'`);
    expect(forceModId(`const x = 1`, "b")).toBe(`const x = 1`);
  });
});
