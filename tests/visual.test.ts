import { describe, expect, it } from "vitest";
import { fallbackVisual, lookFor, parseShape, parseVisual } from "../server/visual";
import { kindOf, registerLook, clearLooks } from "../src/client/shapes";
import { pickArtType } from "../server/art";

describe("visual kind (ADR 0015)", () => {
  it("parses only known kinds and shapes", () => {
    expect(parseVisual("shape")).toBe("shape");
    expect(parseVisual("nonsense")).toBeUndefined();
    expect(parseShape("ring")).toBe("ring");
    expect(parseShape("hexagon")).toBeUndefined();
  });

  it("fallback calls a bouncing ball a circle shape and weather an effect", () => {
    expect(fallbackVisual("add a bouncing ball")).toEqual({ visual: "shape", shape: "circle" });
    expect(fallbackVisual("add a red ring")?.shape).toBe("ring");
    expect(fallbackVisual("add spikes")?.shape).toBe("spikes");
    expect(fallbackVisual("make it foggy")?.visual).toBeUndefined(); // "foggy" is Spark's job, not the word list's
    expect(fallbackVisual("make it rain")?.visual).toBe("effect");
    expect(fallbackVisual("add a treasure chest")).toBeUndefined();
    expect(fallbackVisual("add a dragon")).toBeUndefined();
  });

  it("only shapes and effects get a look; props and creatures keep their art", () => {
    expect(lookFor("shape", undefined, ["ball"])).toEqual({ visual: "shape", shape: "circle", types: ["ball"] });
    expect(lookFor("effect", undefined, ["fog"])).toEqual({ visual: "effect", types: ["fog"] });
    expect(lookFor("prop", undefined, ["chest"])).toBeUndefined();
    expect(lookFor("creature", undefined, ["dragon"])).toBeUndefined();
  });

  it("weather and effect types never ask for a sprite sheet", () => {
    for (const t of ["fog", "mist", "smoke", "snow", "explosion", "spark"]) {
      expect(pickArtType(`api.spawn({ type: "${t}", x: 0 })`)).toBeNull();
    }
  });

  it("client draws shapes for balls and effects for rain, sprites stay with creatures", () => {
    clearLooks();
    expect(kindOf("bouncing-ball")).toEqual({ kind: "shape", shape: "circle" });
    expect(kindOf("spike-trap")).toEqual({ kind: "shape", shape: "spikes" });
    expect(kindOf("raindrop")).toEqual({ kind: "effect" });
    expect(kindOf("fog-bank")).toEqual({ kind: "effect" });
    expect(kindOf("dragon")).toBeUndefined();
    expect(kindOf("player")).toBeUndefined();
    registerLook({ visual: "shape", shape: "diamond", types: ["gem-thing"] });
    expect(kindOf("gem-thing")).toEqual({ kind: "shape", shape: "diamond" });
    clearLooks();
  });
});
