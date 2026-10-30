import { describe, expect, it } from "vitest";
import { newRecent, noteTouched } from "../server/context";
import { parseRelativeAsk, pronounAskMeansRecent } from "../server/relative-tweak";
import { resolveRoute } from "../server/route-rules";
import type { RouteCtx, RouteMod } from "../server/route-rules";

// Rehearsal 10-30 (bug cps): "add a bouncing green slime", then "make them faster" -> the player
// sped up and the slime kept its speed. The router aimed the pronoun at `player`; a pronoun means
// the mod touched last, and "them/they/those" never means the player.

const mod = (id: string, title: string, knobs: RouteMod["knobs"] = {}, types: string[] = []): RouteMod => ({ id, title, knobs, types });
const ctx = (command: string, mods: RouteMod[] = [], touched: string[] = []): RouteCtx => {
  const recent = newRecent();
  for (const t of [...touched].reverse()) noteTouched(recent, t);
  return { command, mods: new Map(mods.map((m) => [m.id, m])), recent };
};

const player = mod("player", "Player", { speed: { value: 260, min: 80, max: 600 }, jump: { value: 720, min: 300, max: 1100 } });
const slime = mod("bouncing-slime", "Bouncing slime", { speed: { value: 60, min: 10, max: 200 } }, ["slime"]);
const world = [player, slime];

describe("a pronoun ask outranks the router's 'player' target (bug cps)", () => {
  it("recognises a pronoun ask, and only when it is not first-person", () => {
    expect(pronounAskMeansRecent("make them faster")).toBe(true);
    expect(pronounAskMeansRecent("make it a lot faster")).toBe(true);
    expect(pronounAskMeansRecent("make those jump higher")).toBe(true);
    expect(pronounAskMeansRecent("make me faster")).toBe(false);
    expect(pronounAskMeansRecent("make my guy faster")).toBe(false);
    expect(pronounAskMeansRecent("make the slimes faster")).toBe(false);
    expect(pronounAskMeansRecent("make it rain")).toBe(false);
    expect(pronounAskMeansRecent("make them faster", parseRelativeAsk("make them faster"))).toBe(true);
  });

  it("tweaks the slime, not the player, when the router says tweak target player", () => {
    const r = resolveRoute({ action: "tweak", target: "player", knob: "speed", value: 390 }, ctx("make them faster", world, ["bouncing-slime"]));
    expect(r.route).toEqual({ action: "tweak", target: "bouncing-slime", knob: "speed", value: 90 });
    expect(r.rules[0]).toMatch(/pronoun, not the router's player/);
  });

  it("tweaks the slime when the router wanted a full edit of the player", () => {
    const r = resolveRoute({ action: "edit", target: "player" }, ctx("make them faster", world, ["bouncing-slime"]));
    expect(r.route).toMatchObject({ action: "tweak", target: "bouncing-slime", knob: "speed" });
  });

  it("still speeds the player up when the ask says me/my/I", () => {
    expect(resolveRoute({ action: "tweak", target: "player" }, ctx("make me faster", world, ["bouncing-slime"])).route)
      .toMatchObject({ action: "tweak", target: "player", knob: "speed" });
    expect(resolveRoute({ action: "tweak", target: "player" }, ctx("make my character jump higher", world, ["bouncing-slime"])).route)
      .toMatchObject({ action: "tweak", target: "player", knob: "jump" });
  });

  it("keeps a target the router named itself", () => {
    expect(resolveRoute({ action: "tweak", target: "bouncing-slime" }, ctx("make them faster", world, ["player"])).route)
      .toMatchObject({ action: "tweak", target: "bouncing-slime" });
  });

  it("falls back to the router's target when the mod touched last is gone", () => {
    expect(resolveRoute({ action: "tweak", target: "player" }, ctx("make them faster", world, ["deleted-mod"])).route)
      .toMatchObject({ action: "tweak", target: "player" });
  });

  it("keeps the player as the second choice when the newest mod has no knob for the ask", () => {
    expect(resolveRoute({ action: "tweak", target: "player" }, ctx("make them jump higher", world, ["bouncing-slime"])).route)
      .toEqual({ action: "tweak", target: "player", knob: "jump", value: 1080 });
  });
});

describe("a named noun outranks the router's 'player' target (bead 1e6)", () => {
  it("tweaks the slime for 'make the slimes faster' when the router says player", () => {
    const r = resolveRoute({ action: "tweak", target: "player", knob: "speed", value: 390 }, ctx("make the slimes faster", world, ["player"]));
    expect(r.route).toEqual({ action: "tweak", target: "bouncing-slime", knob: "speed", value: 90 });
    expect(r.rules.join(" ")).toMatch(/named slimes, not the router's player/);
  });

  it("works with no router target and with a full edit aimed at the player", () => {
    expect(resolveRoute({ action: "tweak" }, ctx("make the slimes faster", world)).route).toMatchObject({ action: "tweak", target: "bouncing-slime" });
    expect(resolveRoute({ action: "edit", target: "player" }, ctx("make the slime faster", world)).route).toMatchObject({ action: "tweak", target: "bouncing-slime" });
  });

  it("edits the NAMED mod, not the player, when it has no knob for the ask", () => {
    expect(resolveRoute({ action: "tweak", target: "player", knob: "jump", value: 1080 }, ctx("make the slimes jump higher", world)).route)
      .toEqual({ action: "edit", target: "bouncing-slime" });
  });

  it("keeps 'me / my character' on the player", () => {
    expect(resolveRoute({ action: "tweak", target: "player" }, ctx("make me faster", world, ["bouncing-slime"])).route)
      .toMatchObject({ action: "tweak", target: "player" });
    expect(resolveRoute({ action: "tweak", target: "player" }, ctx("make my character faster", world, ["bouncing-slime"])).route)
      .toMatchObject({ action: "tweak", target: "player" });
  });

  it("does not touch the player for a noun that matches no loaded mod", () => {
    // No dragon is loaded: the existing build-verb rule reads "make the dragons ..." as a build.
    expect(resolveRoute({ action: "tweak", target: "player" }, ctx("make the dragons faster", world)).route)
      .toEqual({ action: "new" });
  });
});
