import { describe, expect, it } from "vitest";
import type { Texture } from "pixi.js";
import { spritePrompt, subjectArtPrompt } from "../server/art";
import { skinFlightOfSource, skinKeyOf, skinSheetKey } from "../src/sim/scene";
import { skinIsPending, framesFor } from "../src/client/sprites";
import { World } from "../src/sim/world";
import { ModLoader } from "../src/sim/loader";

// ADR 0083: a plain "make my character an elephant" draws a walker; only a flight scene draws the flight sheet.

describe("skin art form follows the scene", () => {
  it("the ground prompt is the platformer pose sheet, the flight prompt is the thrust sheet", () => {
    const ground = subjectArtPrompt("elephant", "elephant-walk-skin", false, false, "ground");
    expect(ground).toContain("the player's own character");
    expect(ground).toContain("idle standing facing right");
    expect(ground).toContain("jumping mid-air leap pose");
    expect(ground).not.toMatch(/thrust|hovering|banking|diving/);
    const flight = subjectArtPrompt("elephant", "elephant-skin", false, false, "flight");
    expect(flight).toContain("flying forward with thrust");
    expect(flight).not.toContain("idle standing");
    expect(spritePrompt("elephant", { held: false, scenery: false, skin: "ground" })).toBe(ground);
  });

  it("reads the form from the setScene call in the mod source", () => {
    expect(skinFlightOfSource('api.setScene({ playerSkin: "elephant" });')).toBe(false);
    expect(skinFlightOfSource('api.setScene({ hideScenery: true, playerSkin: "elephant" });')).toBe(false);
    expect(skinFlightOfSource('api.setScene({ hideTerrain: true, hideScenery: true, backdrop: "space", playerSkin: "spaceship" });')).toBe(true);
    expect(skinFlightOfSource('api.setScene({ backdrop: "space", playerSkin: "ship" })')).toBe(true);
    expect(skinFlightOfSource("api.spawn({})")).toBe(false);
  });

  it("a walking and a flying elephant never share a cache key", () => {
    expect(skinSheetKey("elephant", false)).toBe("elephant-walk-skin");
    expect(skinSheetKey("elephant", true)).toBe("elephant-skin"); // ADR 0066 sheets stay valid
    expect(skinSheetKey("space-ship", false)).toBe("space-ship-walk-skin"); // hyphenated words keep their whole name
  });

  it("the scene state carries the form, and an undone scene gives it back", () => {
    const world = new World(7);
    const loader = new ModLoader(world);
    loader.load({ id: "swap", title: "swap", setup(api) { api.setScene!({ playerSkin: "elephant" }); }, dispose() {} });
    expect(skinKeyOf(world.scene)).toBe("elephant-walk-skin");
    loader.load({ id: "space", title: "space", setup(api) { api.setScene!({ hideTerrain: true, playerSkin: "spaceship" }); }, dispose() {} });
    expect(skinKeyOf(world.scene)).toBe("spaceship-skin");
    loader.unload("space");
    expect(skinKeyOf(world.scene)).toBe("elephant-walk-skin");
    loader.unload("swap");
    expect(skinKeyOf(world.scene)).toBeUndefined();
  });
});

describe("the player digitizes while its skin draws", () => {
  const tex = (n: number): Texture[] => Array.from({ length: n }, () => ({}) as Texture);
  it("shows the effect only for the player, only while pending, and stops when the sheet lands", () => {
    const pending = new Set(["elephant-walk-skin"]);
    const frames: Record<string, Texture[]> = { ninja: tex(4) };
    expect(skinIsPending(true, "elephant-walk-skin", pending, frames)).toBe(true);
    expect(skinIsPending(false, "elephant-walk-skin", pending, frames)).toBe(false);
    expect(skinIsPending(true, undefined, pending, frames)).toBe(false);
    expect(framesFor(frames, "player", true, "elephant-walk-skin")).toBe(frames.ninja); // ninja until the art lands
    frames["elephant-walk-skin"] = tex(4);
    expect(skinIsPending(true, "elephant-walk-skin", pending, frames)).toBe(false);
    expect(framesFor(frames, "player", true, "elephant-walk-skin")).toBe(frames["elephant-walk-skin"]);
    pending.delete("elephant-walk-skin"); // failure: back to the old look
    delete frames["elephant-walk-skin"];
    expect(skinIsPending(true, "elephant-walk-skin", pending, frames)).toBe(false);
    expect(framesFor(frames, "player", true, "elephant-walk-skin")).toBe(frames.ninja);
  });
});

describe("the generated walking elephant sheet", () => {
  it("cuts into 4 poses that share one baseline (feet on the ground line like the ninja)", async () => {
    const { readFileSync } = await import("node:fs");
    const { findPoseBounds, alignPoseBounds } = await import("../src/client/sprites");
    const raw = JSON.parse(readFileSync(new URL("./fixtures/elephant-walk-sheet.mask.json", import.meta.url), "utf8")) as { w: number; h: number; rows: number[][][] };
    const px = new Uint8ClampedArray(raw.w * raw.h * 4);
    raw.rows.forEach((runs, y) => { for (const [x0, len] of runs) for (let x = x0; x < x0 + len; x++) px[(y * raw.w + x) * 4 + 3] = 255; });
    const bounds = findPoseBounds(raw.w, raw.h, px);
    expect(bounds).toHaveLength(4);
    const aligned = alignPoseBounds(bounds);
    expect(new Set(aligned.map((b) => b.y + b.h)).size).toBe(1); // every frame ends on the same bottom line
    // The standing and running poses each have their feet near that line, not floating above it.
    const base = Math.max(...bounds.map((b) => b.y + b.h));
    const commonH = aligned[0].h;
    for (const b of bounds.slice(0, 3)) expect(base - (b.y + b.h)).toBeLessThan(commonH * 0.12);
  });
});
