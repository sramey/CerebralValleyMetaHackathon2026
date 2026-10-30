import { describe, expect, it } from "vitest";
import { parseRelativeAsk, relativeTweak, stemOf } from "../server/relative-tweak";

const player = { speed: { value: 260, min: 80, max: 600 }, jump: { value: 720, min: 300, max: 1100 } };
const chickens = { count: { value: 2, min: 1, max: 6, label: "Chicken count" }, speed: { value: 60, min: 20, max: 200 } };

describe("relative knob asks become tweaks (ADR 0058)", () => {
  it("reads speed, jump and count asks", () => {
    expect(parseRelativeAsk("make them faster")).toMatchObject({ dim: "speed", up: true });
    expect(parseRelativeAsk("Make the enemies a lot slower!")).toMatchObject({ dim: "speed", up: false, strength: 2 });
    expect(parseRelativeAsk("make me go a bit faster")).toMatchObject({ dim: "speed", up: true, strength: 1.25 });
    expect(parseRelativeAsk("speed them up")).toMatchObject({ dim: "speed", up: true });
    expect(parseRelativeAsk("make the player jump higher")).toMatchObject({ dim: "jump", up: true });
    expect(parseRelativeAsk("jump higher")).toMatchObject({ dim: "jump", up: true });
    expect(parseRelativeAsk("more chickens")).toMatchObject({ dim: "count", up: true, noun: "chickens" });
  });

  it("leaves everything else to the router", () => {
    for (const c of ["make me huge", "make me giant", "make it rain", "make it spooky", "add more chickens",
      "make them faster and shoot fire", "make the enemies faster when I jump", "make it so my character can double jump", "let me shoot fireballs"]) {
      expect(parseRelativeAsk(c), c).toBeNull();
    }
  });

  it("scales the matching knob within its limits", () => {
    expect(relativeTweak("make me faster", player)).toEqual({ knob: "speed", value: 390 });
    expect(relativeTweak("make me a lot faster", player)).toEqual({ knob: "speed", value: 520 });
    expect(relativeTweak("make me way faster", { speed: { value: 500, max: 600 } })).toEqual({ knob: "speed", value: 600 });
    expect(relativeTweak("make me jump higher", player)).toEqual({ knob: "jump", value: 1080 });
    expect(relativeTweak("more chickens", chickens, "chicken Chickens")).toEqual({ knob: "count", value: 3 });
    expect(relativeTweak("fewer chickens", chickens, "chicken Chickens")).toEqual({ knob: "count", value: 1 });
  });

  it("matches the named thing against the mod, unless the target was already chosen", () => {
    const walker = { speed: { value: 70, min: 20, max: 240 } };
    expect(relativeTweak("make the enemies faster", walker, "walker-enemy Walker enemy")).toEqual({ knob: "speed", value: 105 });
    expect(relativeTweak("make the slimes faster", walker, "walker-enemy Walker enemy")).toBeNull();
    expect(relativeTweak("make the slimes faster", walker, "walker-enemy Walker enemy", true)).toEqual({ knob: "speed", value: 105 });
    expect(relativeTweak("more chickens", { count: { value: 40 } }, "rain Rain", true)).toBeNull();
    expect(["enemies", "boxes", "slimes", "bushes", "coins"].map(stemOf)).toEqual(["enemy", "box", "slime", "bush", "coin"]);
  });

  it("returns null when it cannot help, so the rewrite path still runs", () => {
    expect(relativeTweak("make it faster", { size: { value: 3 } })).toBeNull();
    expect(relativeTweak("make me faster", { speed: { value: 600, max: 600 } })).toBeNull();
    expect(relativeTweak("more coins", chickens, "chicken Chickens")).toBeNull();
    expect(relativeTweak("make it more spooky", chickens, "chicken Chickens")).toBeNull();
    expect(relativeTweak("make it faster", { speed: { value: "fast" } })).toBeNull();
  });
});
