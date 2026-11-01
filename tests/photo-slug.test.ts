import { describe, expect, it } from "vitest";
import { slugDrawsAsPhoto } from "../src/client/photo-slug";

describe("photo slug keeps the cut-out visible (ADR 0082)", () => {
  it("rejects names the renderer would draw as backdrop, shape or landmark", () => {
    for (const s of ["speak-spell-toy", "pineapple", "skyline-toy", "gem", "ball"]) expect(slugDrawsAsPhoto(s), s).toBe(false);
  });
  it("keeps ordinary object names", () => {
    for (const s of ["learning-toy", "handheld-game-console", "my-cat", "mug"]) expect(slugDrawsAsPhoto(s), s).toBe(true);
  });
});
