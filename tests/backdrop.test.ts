import { describe, expect, it } from "vitest";
import type { Graphics } from "pixi.js";
import { BACKDROP_MOTIFS } from "../src/contract";
import { detectBackdropCommand, detectMoodCommand } from "../src/ontology";
import { drawBackdrop, drawScenery, skylineAmplitude } from "../src/client/scenery";
import { BACKDROP_PRESETS, moodSpecFor, parseBackdrop, parseMoodSpec } from "../server/mood";
import { sanitizeMood } from "../server/worlds";
import { newRecent } from "../server/context";
import { resolveRoute } from "../server/route-rules";

function counter(): { gfx: Graphics; calls: () => number } {
  let calls = 0;
  const chain: Record<string, unknown> = new Proxy({}, { get: () => (..._a: unknown[]) => { calls++; return chain; } });
  return { gfx: chain as unknown as Graphics, calls: () => calls };
}
const pal = { grass: 0x45d66b, ridgeNear: 0x0d1b20, moon: 0xf2ead0 };

describe("themed backdrops (ADR 0066)", () => {
  it.each([
    ["Change the background to medevil paralax background", "medevil"],
    ["Change the background to medieval parallax background", "medieval"],
    ["Change the background to be in an indiana farm", "indiana farm"],
    ["set the background to look like an Indiana farm", "indiana farm"],
    ["make the background a medieval village", "medieval village"],
    ["medieval parallax background", "medieval"],
    ["I want a farm background", "farm"],
    ["change the setting to ancient egypt", "ancient egypt"],
  ])("%s -> %s", (cmd, words) => {
    expect(detectBackdropCommand(cmd)).toBe(words);
    expect(detectMoodCommand(cmd)).toBe(words);
  });

  it.each(["add a castle in the background", "add a parallax background", "parallax background", "change the background", "make the background darker", "add a tree", "make it spooky"])(
    "%s is not a backdrop",
    (cmd) => expect(detectBackdropCommand(cmd)).toBeNull(),
  );

  it("routes a backdrop ask to a mood whatever Spark said, but keeps an undo", () => {
    const ctx = { command: "Change the background to medieval parallax background", mods: new Map(), recent: newRecent() };
    expect(resolveRoute({ action: "tweak", target: "parallax", knob: "layers", value: 4 }, ctx).route).toEqual({ action: "mood", mood: "medieval" });
    expect(resolveRoute(null, ctx).route).toEqual({ action: "mood", mood: "medieval" });
    expect(resolveRoute({ action: "undo" }, ctx).route).toEqual({ action: "undo" });
  });

  it("medieval and farm are presets with scenery; background scope keeps sprites' colours", async () => {
    const med = await moodSpecFor("medevil", { background: true });
    expect(med.backdrop?.landmark).toBe("castle");
    expect(med.backdrop?.far).toContain("village");
    expect(med.scope).toBe("background");
    expect(med.grade).toBeLessThanOrEqual(0.1);
    const farm = await moodSpecFor("indiana farm", { background: true });
    expect(farm.name).toBe("farm");
    expect(farm.backdrop?.skyline).toBe("flat");
    expect(farm.backdrop?.landmark).toBe("barn");
    // A mood word plus a place wears the mood's palette with the place's scenery.
    const spooky = await moodSpecFor("spooky castle");
    expect(spooky.name).toBe("spooky-medieval");
    expect(spooky.backdrop?.landmark).toBe("castle");
    expect(spooky.scope).toBeUndefined();
    // Plain moods are unchanged.
    expect((await moodSpecFor("spooky")).backdrop).toBeUndefined();
  });

  it("keeps only known motifs from Spark and from saved worlds", () => {
    expect(parseBackdrop({ skyline: "flat", landmark: "spaceship", far: ["barn", "laser"], mid: [], near: ["FENCE"] }))
      .toEqual({ skyline: "flat", far: ["barn"], mid: [], near: ["fence"] });
    expect(parseBackdrop({ far: ["laser"] })).toBeUndefined();
    const spec = parseMoodSpec('{"anchor":"a jungle temple deep in the rainforest","backdrop":{"skyline":"hills","landmark":"pyramid","far":["palm"],"mid":["palm","rock"],"near":["bush"]}}', "jungle");
    expect(spec?.backdrop?.landmark).toBe("pyramid");
    const saved = sanitizeMood({ ...BACKDROP_PRESETS.farm, scope: "background", backdrop: { ...BACKDROP_PRESETS.farm.backdrop, near: ["fence", "<script>"] } });
    expect(saved?.backdrop?.near).toEqual(["fence"]);
    expect(saved?.scope).toBe("background");
  });

  it("draws every motif at any camera position, and the landmark is on screen at spawn", () => {
    for (const m of BACKDROP_MOTIFS) {
      for (const camX of [-500, 0, 4321.5]) {
        const c = counter();
        drawBackdrop(c.gfx, camX, 0, 1280, pal, 0x9be2ff, 0.2, camX !== 0, { skyline: "hills", landmark: m, far: [m], mid: [m], near: [m] });
        expect(c.calls()).toBeGreaterThan(10);
      }
    }
    const plain = counter(), castle = counter();
    drawScenery(plain.gfx, 0, 0, 1280, pal, 0x9be2ff, 0.2, true);
    drawBackdrop(castle.gfx, 0, 0, 1280, pal, 0x9be2ff, 0.2, true, BACKDROP_PRESETS.medieval.backdrop!);
    expect(castle.calls()).toBeGreaterThan(plain.calls());
    expect(skylineAmplitude(undefined)).toBe(1);
    expect(skylineAmplitude(BACKDROP_PRESETS.farm.backdrop)).toBeLessThan(0.5);
  });
});
