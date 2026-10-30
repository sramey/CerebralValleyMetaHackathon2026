import { describe, expect, it } from "vitest";
import { resolvePronoun } from "../server/context";

// Live check 10-29: "add a superhero cat that flies..." was routed as an edit of the ground mod.
describe("relative clauses on a new subject are not pronoun references", () => {
  const r = { commands: ["add some ground"], touched: ["ground"] };
  it("a new subject with 'that' is a new build", () => {
    expect(resolvePronoun("add a superhero cat that flies around dropping coins", r)).toBeUndefined();
    expect(resolvePronoun("add a dragon which breathes fire", r)).toBeUndefined();
  });
  it("a real reference still edits the last thing touched", () => {
    expect(resolvePronoun("make it bigger", r)).toBe("ground");
    expect(resolvePronoun("add a hat to it", r)).toBe("ground");
    expect(resolvePronoun("make that blue", r)).toBe("ground");
  });
});
