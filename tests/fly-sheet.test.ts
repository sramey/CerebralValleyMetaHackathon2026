import { describe, expect, it } from "vitest";
import { framesFor } from "../src/client/sprites";
import { artKeyForType } from "../server/art";

// A flying subject's sheet is keyed "<base>-fly" (ADR 0053); the client must still find it.
describe("flying sprite sheets reach the entity", () => {
  const walk = ["walk"] as never[];
  const fly = ["fly"] as never[];
  it("server key for a flying cat is cat-fly", () => {
    expect(artKeyForType("superhero-cat", "fly")).toBe("cat-fly");
  });
  it("a cat-fly sheet draws a superhero-cat", () => {
    expect(framesFor({ "cat-fly": fly }, "superhero-cat", false)).toBe(fly);
  });
  it("a dragon-fly sheet draws a dragon", () => {
    expect(framesFor({ "dragon-fly": fly }, "dragon", false)).toBe(fly);
  });
  it("the flying sheet wins over a cached walking sheet of the same subject", () => {
    expect(framesFor({ cat: walk, "cat-fly": fly }, "superhero-cat", false)).toBe(fly);
  });
  it("a plain walking sheet still matches", () => {
    expect(framesFor({ cat: walk }, "superhero-cat", false)).toBe(walk);
  });
});

describe("a floating place is not a flying subject", () => {
  it("slime on a floating platform walks; a floating ghost flies", async () => {
    const { isFlyingRequest } = await import("../server/art");
    expect(isFlyingRequest("add a green slime on the floating platform", "slime")).toBe(false);
    expect(isFlyingRequest("add a floating ghost", "ghost")).toBe(true);
    expect(isFlyingRequest("add a superhero cat that flies around", "superhero-cat")).toBe(true);
  });
});
