// ADR 0053 / bead 2yt: a compound command splits only when it names independent things.
// The superhero-cat prompt below is the live bug: it used to become four parallel builds
// that overwrote one mod id in front of the player.
import { describe, expect, it } from "vitest";
import { MAX_PARTS, splitCompound } from "../server/compound";

/** One build: the splitter must hand the whole request to one Wonder call. */
const ONE_BUILD = [
  "add a superhero cat that flies around dropping coins",
  "add a superhero cat that flies around, dropping coins",
  "add a superhero cat that flies and drops coins",
  "add a superhero cat wearing a cape and a mask",
  "add a superhero cat with a cape, a mask and glowing red eyes",
  "add a dragon that flies around breathing fire",
  "add a cat that patrols the sky and drops coins when the player walks under it",
  "add a castle and a dragon that guards it",
  "add a superhero cat and make it fly",
  "add a cat and give it a jetpack",
  "add some ground and make it bouncy",
  "make it rain and make it faster",
  "add a player",
  "make it rain",
  "make the cat bigger",
  "add a coin and make it sparkle",
  "",
];

/** Genuinely separate things: one build each. */
const SPLITS: [command: string, parts: string[]][] = [
  ["add a castle and add a dragon", ["add a castle", "add a dragon"]],
  ["add a castle and a dragon", ["add a castle", "add a dragon"]],
  ["make it rain and add some platforms", ["make it rain", "add some platforms"]],
  [
    "add a dragon, add a castle and add some coins",
    ["add a dragon", "add a castle", "add some coins"],
  ],
  ["add a superhero cat and add a castle", ["add a superhero cat", "add a castle"]],
  ["add some platforms plus a bouncy ball", ["add some platforms", "add a bouncy ball"]],
  ["make it spooky and add some ghosts", ["make it spooky", "add some ghosts"]],
];

describe("compound splitting (ADR 0053, bead 2yt)", () => {
  it.each(ONE_BUILD)("keeps one subject's traits and behaviors in one build: %s", (command) => {
    expect(splitCompound(command)).toBeNull();
  });

  it("never splits the superhero-cat prompt into separate builds", () => {
    const parts = splitCompound("add a superhero cat that flies around dropping coins");
    expect(parts).toBeNull();
  });

  it.each(SPLITS)("splits independent requests: %s", (command, expected) => {
    expect(splitCompound(command)).toEqual(expected);
  });

  it("gives every part a build verb, so each part routes as a standalone build", () => {
    for (const [command] of SPLITS) {
      for (const part of splitCompound(command) ?? []) {
        expect(part, `${command} -> ${part}`).toMatch(/^(?:add|make|create|spawn|build|put|place|give)\b/i);
      }
    }
  });

  it("keeps a later part that points back at an earlier one in the same build", () => {
    expect(splitCompound("add a castle and add a dragon that guards the castle")).toBeNull();
    expect(splitCompound("add a coin and add a chest that holds the coin")).toBeNull();
  });

  it("caps the parts and never drops a request", () => {
    const parts = splitCompound("add a, add b, add c, add d, add e, add f");
    expect(parts).not.toBeNull();
    expect(parts!.length).toBe(MAX_PARTS);
    // The overflow clauses stay in the last part instead of disappearing.
    expect(parts!.join(", ")).toContain("add a");
    expect(parts!.join(", ")).toContain("add f");
  });

  it("is deterministic for the same command", () => {
    const command = "add a dragon, add a castle and add some coins";
    expect(splitCompound(command)).toEqual(splitCompound(command));
    expect(splitCompound(command)).toEqual(splitCompound(`  ${command}  `));
  });

  it("does not split tweaks, undos or questions", () => {
    expect(splitCompound("undo the rain and the fog")).toBeNull();
    expect(splitCompound("what does the cat do?")).toBeNull();
    expect(splitCompound("make the cat bigger and faster")).toBeNull();
  });
});
