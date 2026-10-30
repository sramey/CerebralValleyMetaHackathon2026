// Late art (bead 8zu): the sprite sheets load *behind* the running render loop, so a stalled
// sheet can no longer hold the stage black. These tests pin the rules that keep that safe:
// the frame map is usable (empty) before any sheet lands, the reference the loop holds never
// changes, every sheet is requested at once, and a late sheet never overwrites art that won
// the race. No DOM and no Pixi: `Texture` is a type only.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Texture } from "pixi.js";
import { loadAll, mergeFrames, startLateArt } from "../src/client/art-late";
import type { Frames } from "../src/client/art-late";

/** A stand-in sheet: only `length` matters to the merge rules. */
const sheet = (n: number): Texture[] => Array.from({ length: n }, (_, i) => ({ id: i })) as unknown as Texture[];

describe("late art", () => {
  it("hands the loop an empty map that fills in place, never replaced", async () => {
    let land: (frames: Frames) => void = () => {};
    const art = startLateArt(() => new Promise<Frames>((resolve) => { land = resolve; }));
    const live = art.frames;
    // First frame: no sheets yet — `framesFor` finds nothing and every entity draws its shape.
    expect(live).toEqual({});
    land({ ninja: sheet(4), chicken: sheet(3) });
    await art.settled;
    expect(live).toBe(art.frames); // the loop's reference sees the sprites, no re-render plumbing
    expect(live.ninja).toHaveLength(4);
    expect(live.chicken).toHaveLength(3);
  });

  it("settles on a failed or rejected load and leaves the map empty", async () => {
    const art = startLateArt(() => Promise.reject(new Error("sheet 404")));
    await expect(art.settled).resolves.toEqual({});
    expect(art.frames).toEqual({});
  });

  it("keeps art that already landed: a boot sheet must not overwrite a restyle", async () => {
    const restyled = sheet(5);
    const target: Frames = { ninja: restyled };
    const filled = mergeFrames(target, { ninja: sheet(4), chicken: sheet(2) });
    expect(target.ninja).toBe(restyled); // the mood's sheet wins
    expect(target.chicken).toHaveLength(2); // the late arrival still fills what was missing
    expect(filled).toEqual(["chicken"]);
  });

  it("records a failed sheet as empty but does not report it as loaded", () => {
    const target: Frames = {};
    const filled = mergeFrames(target, { ninja: [], chicken: sheet(2) });
    expect(filled).toEqual(["chicken"]);
    expect(target.ninja).toEqual([]);
    // Empty means "no sprite", so a retry (or a restyle) may fill the same key later.
    mergeFrames(target, { ninja: sheet(4) });
    expect(target.ninja).toHaveLength(4);
  });

  it("requests every sheet at once and keeps the map's key order", async () => {
    const started: string[] = [];
    const finish: (() => void)[] = [];
    const load = (url: string): Promise<number> => new Promise<number>((resolve) => {
      started.push(url);
      finish.push(() => resolve(url.length));
    });
    const all = loadAll({ ninja: "aa", chicken: "bbbb" }, load);
    // Both were asked for before either answered: one stalled sheet cannot delay the other.
    expect(started).toEqual(["aa", "bbbb"]);
    finish[1](); // the slow one answers first…
    finish[0]();
    expect(Object.keys(await all)).toEqual(["ninja", "chicken"]);
    expect(await all).toEqual({ ninja: 2, chicken: 4 });
  });

  it("main.ts starts the render loop without waiting for the boot sheets", () => {
    const src = readFileSync("src/client/main.ts", "utf8");
    expect(src).not.toMatch(/await loadSubjects\(/); // the old black-stage gate
    expect(src).not.toMatch(/await lateArt\.settled/); // nor any other wait before the loop
    expect(src.indexOf("startLateArt(")).toBeGreaterThan(-1);
    expect(src.indexOf("startLateArt(")).toBeLessThan(src.indexOf("requestAnimationFrame(frame);"));
  });
});
