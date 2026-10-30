import { describe, expect, it } from "vitest";
import { newRecent, noteTouched } from "../server/context";
import { orderRoute, parseOrder, parseRoute, resolveRoute } from "../server/route-rules";
import type { RouteCtx, RouteMod } from "../server/route-rules";

const mod = (id: string, title: string, knobs: RouteMod["knobs"] = {}, types: string[] = []): RouteMod => ({ id, title, knobs, types });
const ctx = (command: string, mods: RouteMod[] = [], touched: string[] = [], extra: Partial<RouteCtx> = {}): RouteCtx => {
  const recent = newRecent();
  for (const t of [...touched].reverse()) noteTouched(recent, t);
  return { command, mods: new Map(mods.map((m) => [m.id, m])), recent, ...extra };
};

describe("parseOrder", () => {
  it.each([
    ["chickens, follow me", "follow", "chickens"],
    ["Hey dragon, stay!", "stay", "dragon"],
    ["tell the dog to sit", "stay", "the dog"],
    ["make the slimes go away", "flee", "the slimes"],
    ["everyone come here", "come", "everyone"],
    ["come here", "come", ""],
    ["make it stay", "stay", "it"],
    ["as you were", "free", ""],
  ])("%s -> %s", (cmd, order, who) => {
    expect(parseOrder(cmd)).toEqual({ order, who });
  });

  it.each([
    "add a dog that follows me",
    "make a cat follow me",
    "make the dog always follow me",
    "make it rain",
    "make me stay",
    "make enemies stop when I jump",
  ])("is not an order: %s", (cmd) => {
    expect(parseOrder(cmd)).toBeNull();
  });
});

describe("orderRoute", () => {
  const chickens = mod("chicken-flock", "Chicken flock", {}, ["chicken"]);
  const dragon = mod("dragon", "Dragon", {}, ["dragon"]);

  it("finds the mod by a plural, its title or its spawned types", () => {
    expect(orderRoute(ctx("chickens, follow me", [chickens, dragon]))).toEqual({ action: "order", target: "chicken-flock", order: "follow" });
    expect(orderRoute(ctx("dragon stay", [chickens, dragon]))?.target).toBe("dragon");
  });

  it("a pronoun or no name means the thing touched last; everyone means every mod", () => {
    expect(orderRoute(ctx("come here", [chickens, dragon], ["dragon"]))?.target).toBe("dragon");
    expect(orderRoute(ctx("everybody scatter", [chickens, dragon]))?.target).toBe("*");
  });

  it("a name nothing matches is left to the router", () => {
    expect(orderRoute(ctx("unicorn, follow me", [chickens]))).toBeNull();
  });

  it("can order the client's own built-ins through `world`", () => {
    const c = ctx("chickens follow me", [], [], { world: new Map([["chicken", mod("chicken", "chicken")]]) });
    expect(orderRoute(c)?.target).toBe("chicken");
  });
});

describe("resolveRoute keeps the guards it replaced, in order", () => {
  const enemies = mod("enemies", "Enemies", { speed: { value: 80, min: 10, max: 400 } }, ["slime"]);

  it("a router miss on a build-shaped command builds", () => {
    expect(resolveRoute(null, ctx("add a tree"))).toEqual({ route: { action: "new" }, rules: ["build-fallback: fallback to new"] });
  });

  it("a mood phrase routed as a build is a mood", () => {
    expect(resolveRoute({ action: "new" }, ctx("make it spooky")).route).toEqual({ action: "mood", mood: "spooky" });
  });

  it("a player ability is never an NPC edit", () => {
    expect(resolveRoute({ action: "edit", target: "enemies" }, ctx("let me double jump", [enemies])).route).toEqual({ action: "new" });
  });

  it("a pronoun build edits the thing touched last", () => {
    expect(resolveRoute({ action: "new" }, ctx("make it purple", [enemies], ["enemies"])).route).toEqual({ action: "edit", target: "enemies" });
  });

  it("an add is never a question", () => {
    expect(resolveRoute({ action: "question", answer: "hi" }, ctx("add rain")).route).toEqual({ action: "new" });
  });

  it("a relative ask becomes an instant knob tweak", () => {
    const r = resolveRoute({ action: "edit", target: "enemies" }, ctx("make the enemies faster", [enemies]));
    expect(r.route).toMatchObject({ action: "tweak", target: "enemies", knob: "speed" });
    expect(r.rules[0]).toMatch(/^relative-tweak/);
  });

  it("force-edit wins over what the router said", () => {
    expect(resolveRoute({ action: "new" }, ctx("make this blue", [enemies], [], { forceEditModId: "enemies" })).route).toMatchObject({ action: "edit", target: "enemies" });
  });

  it("Spark's order is checked against the world: none loaded becomes a friendly question", () => {
    expect(resolveRoute(parseRoute('{"action":"order","target":"dragon","order":"follow"}'), ctx("dragon, heel boy")).route?.action).toBe("question");
    expect(resolveRoute(parseRoute('{"action":"order","target":"enemies","order":"stay"}'), ctx("enemies hold your ground", [enemies])).route)
      .toEqual({ action: "order", target: "enemies", order: "stay" });
  });


  it("coerces visual: shape to prop or creature when ontology dictates art", () => {
    // Asteroid is an ontological prop
    const r1 = resolveRoute({ action: "new", visual: "shape", shape: "block" }, ctx("add some asteroids I can shoot"));
    expect(r1.route?.visual).toBe("prop");
    expect(r1.route?.shape).toBeUndefined();
    expect(r1.rules.some((rule) => rule.includes("visual-ontology"))).toBe(true);

    // Dragon is an ontological creature
    const r2 = resolveRoute({ action: "new", visual: "shape", shape: "circle" }, ctx("add a flying dragon"));
    expect(r2.route?.visual).toBe("creature");
    expect(r2.route?.shape).toBeUndefined();

    // Plain ball stays a shape
    const r3 = resolveRoute({ action: "new", visual: "shape", shape: "circle" }, ctx("add a bouncing ball"));
    expect(r3.route?.visual).toBe("shape");
    expect(r3.route?.shape).toBe("circle");
  });
  it("an unchanged route reports no rules", () => {
    expect(resolveRoute({ action: "new", visual: "creature" }, ctx("a sleepy owl"))).toEqual({ route: { action: "new", visual: "creature" }, rules: [] });
  });
});
