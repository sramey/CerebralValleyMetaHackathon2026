import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cleanWebp, moodKey, moodPrompt, moodSpecFor, parseMoodSpec, pool, restyledUrl, sheetPath, softenAnchor } from "../server/mood";

describe("mood (ADR 0017)", () => {
  it("known moods use hand-tuned presets, with aliases", async () => {
    expect((await moodSpecFor("spooky")).name).toBe("spooky");
    expect((await moodSpecFor("really scary")).name).toBe("spooky");
    expect((await moodSpecFor("snowy")).ambient).toBe("snow");
    expect((await moodSpecFor("cyberpunk")).name).toBe("neon");
    expect((await moodSpecFor("daytime")).name).toBe("daytime");
    expect((await moodSpecFor("sunny")).name).toBe("daytime");
    expect((await moodSpecFor("sunset")).name).toBe("sunset");
    expect((await moodSpecFor("dusk")).name).toBe("sunset");
  });

  it("validates Spark's palette JSON and clamps bad values", () => {
    const spec = parseMoodSpec('{"anchor":"sunny desert at golden hour, warm oranges","skyTop":"#ff8800","skyBottom":"ffd9a0","grade":9,"dim":0,"ambient":"lava","fog":0.3}', "Desert Sunset!");
    expect(spec?.name).toBe("desert-sunset");
    expect(spec?.skyTop).toBe(0xff8800);
    expect(spec?.skyBottom).toBe(0xffd9a0);
    expect(spec?.grade).toBe(0.6);
    expect(spec?.dim).toBe(0.5);
    expect(spec?.ambient).toBe("none");
    expect(parseMoodSpec("not json", "x")).toBeNull();
    expect(parseMoodSpec('{"anchor":"x"}', "x")).toBeNull();
  });

  it("only edits sheets we own, never photos, traversal or already-restyled files", () => {
    expect(sheetPath("../.env")).toBeNull();
    expect(sheetPath("photo-1")).toBeNull();
    expect(sheetPath("robot--spooky")).toBeNull();
    expect(sheetPath("ninja")).not.toBeNull();
    expect(sheetPath("chicken")).not.toBeNull();
    expect(sheetPath("definitely-not-there")).toBeNull();
  });

  it("builds a stable url and an anchored prompt aware of subject, orientation and actions", () => {
    expect(restyledUrl("robot", "Spooky!")).toBe("/art/gen/robot--spooky.webp");
    expect(moodKey("")).toBe("mood");
    expect(moodPrompt("haunted night")).toContain("haunted night");
    expect(moodPrompt("x")).toContain("#FF00FF");

    // Aware of character subject, side-scrolling orientation, and 4 sequential action poses
    const ninjaPrompt = moodPrompt("spooky night", "ninja");
    expect(ninjaPrompt).toContain("ninja");
    expect(ninjaPrompt).toContain("2D side-scrolling platformer");
    expect(ninjaPrompt).toContain("facing right");
    expect(ninjaPrompt).toContain("NEVER face backwards or away from camera");
    expect(ninjaPrompt).toContain("NEVER multiple rows");
    expect(ninjaPrompt).toContain("idle standing");
    expect(ninjaPrompt).toContain("running forward");
    expect(ninjaPrompt).toContain("jumping mid-air");

    // Aware of flying creatures: airborne poses
    const flierPrompt = moodPrompt("spooky night", "dragon-fly");
    expect(flierPrompt).toContain("dragon");
    expect(flierPrompt).toContain("AIRBORNE");
    expect(flierPrompt).toContain("hovering");
    expect(flierPrompt).toContain("gliding");
    expect(flierPrompt).toContain("diving");
    expect(flierPrompt).toContain("facing right");
    expect(flierPrompt).toContain("NEVER face backwards");

    // Aware of held items: pointing right, no body
    const gunPrompt = moodPrompt("neon glow", "gun");
    expect(gunPrompt).toContain("held item icon sheet");
    expect(gunPrompt).toContain("pointing right");
    expect(gunPrompt).toContain("NO character");

    // Aware of scenery: static objects
    const chestPrompt = moodPrompt("snowy frost", "chest");
    expect(chestPrompt).toContain("scenery sprite sheet");
    expect(chestPrompt).toContain("static variants");
  });

  it("strips VP8X/XMP metadata from chicken.webp and softens risky anchor words on retry", () => {
    const raw = readFileSync(join(process.cwd(), "public", "art", "chicken.webp"));
    expect(raw.toString("ascii", 12, 16)).toBe("VP8X");
    const cleaned = cleanWebp(raw);
    expect(cleaned.toString("ascii", 0, 4)).toBe("RIFF");
    expect(cleaned.toString("ascii", 8, 12)).toBe("WEBP");
    expect(cleaned.toString("ascii", 12, 16)).toBe("VP8 ");
    expect(cleaned.length).toBeLessThan(raw.length);
    expect(softenAnchor("haunted graveyard at night: tattered and creepy fog", "spooky")).not.toMatch(/graveyard|tattered|creepy|haunted/i);
  });

  it("pool never runs more than the limit at once", async () => {
    let live = 0, peak = 0;
    await pool([1, 2, 3, 4, 5, 6, 7], 3, async () => { live++; peak = Math.max(peak, live); await new Promise((r) => setTimeout(r, 5)); live--; });
    expect(peak).toBe(3);
  });
});
