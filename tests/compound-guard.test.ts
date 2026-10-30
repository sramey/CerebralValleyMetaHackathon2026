import { describe, expect, it } from "vitest";
import { mergeDependentParts, mightBeCompound, splitCompound } from "../server/compound";

// Spark splits compound commands; this deterministic guard keeps one subject in one build (ADR 0053).
describe("guard on Spark's split", () => {
  it("keeps the demo's three independent builds", () => {
    expect(mergeDependentParts(["add a dragon", "add some coins", "make it rain"])).toEqual(["add a dragon", "add some coins", "make it rain"]);
  });
  it("folds behaviors of one subject back into one build (the superhero-cat over-split)", () => {
    const parts = mergeDependentParts([
      "add a superhero cat character wearing a cape",
      "add flying patrol behavior for the superhero cat",
      "add coin dropping ability to the superhero cat",
      "make it drop collectible coins",
    ]);
    expect(parts).toHaveLength(1);
  });
  it("a pronoun part joins the part before it", () => {
    expect(mergeDependentParts(["add a castle", "make it glow"])).toEqual(["add a castle, make it glow"]);
  });
  it("weather and mood idioms are not pronoun references", () => {
    expect(mergeDependentParts(["add a castle", "make it snow"])).toEqual(["add a castle", "make it snow"]);
    expect(mergeDependentParts(["add a slime", "make it spooky"])).toEqual(["add a slime", "make it spooky"]);
  });
  it("only asks Spark when the command could hold more than one request", () => {
    expect(mightBeCompound("add a bouncing green slime")).toBe(false);
    expect(mightBeCompound("add a dragon, some coins, and make it rain")).toBe(true);
  });
  it("fallback word splitter splits the demo command three ways", () => {
    expect(splitCompound("add a dragon, some coins, and make it rain")).toEqual(["add a dragon", "add some coins", "make it rain"]);
  });
});
