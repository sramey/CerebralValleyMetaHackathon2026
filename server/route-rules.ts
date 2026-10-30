// What a command means, after the router has spoken (ADR 0059). Every deterministic guard the
// server applies on top of Spark's answer lives here as one named rule, in order, as a pure
// function: (command, Spark's route, the loaded mods, short-term memory) -> final route + the
// rules that fired. handleSingle only carries the result out. Before this the guards were
// inlined in handleSingle between side effects, so their order could not be tested.
import type { CreatureOrder, KnobDefs, KnobValue, ShapeName } from "../src/contract";
import { CREATURE_ORDERS } from "../src/contract";
import { detectMoodCommand, isPlayerAbilityCommand, isPlayerCommand } from "../src/ontology";
import type { Recent } from "./context";
import { resolvePronoun } from "./context";
import { parseRelativeAsk, pronounAskMeansRecent, relativeTweak, stemOf } from "./relative-tweak";
import { parseShape, parseVisual } from "./visual";
import type { Visual } from "./visual";

export type RouteAction = "new" | "tweak" | "edit" | "undo" | "mood" | "question" | "order";
export interface Route {
  action: RouteAction;
  target?: string;
  knob?: string;
  value?: KnobValue;
  answer?: string;
  mood?: string;
  visual?: Visual;
  shape?: ShapeName;
  order?: CreatureOrder;
}

/** What the rules may know about a loaded mod. `types` are the entity types its source spawns. */
export interface RouteMod { id: string; title: string; knobs: KnobDefs; types?: string[] }

export interface RouteCtx {
  command: string;
  /** The server's verified mods: what tweak, edit and undo may target. */
  mods: ReadonlyMap<string, RouteMod>;
  /** Everything the player's world holds, the client's own built-ins too: what an order may target. Defaults to `mods`. */
  world?: ReadonlyMap<string, RouteMod>;
  recent: Recent;
  /** The client asked to edit this mod ("change this" from the radial menu). */
  forceEditModId?: string;
}

export interface Resolved { route: Route | null; rules: string[] }

const ACTIONS: RouteAction[] = ["new", "tweak", "edit", "undo", "mood", "question", "order"];
const BUILD_VERB = /^(add|make|create|spawn|give|put|build)\b/i;
const STRICT_BUILD_VERB = /^(add|make|create|spawn|build)\b/i;

/** Spark's JSON reply as a Route, or null when it is not one. */
export function parseRoute(text: string): Route | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    const action = obj.action as RouteAction;
    if (!ACTIONS.includes(action)) return null;
    const r: Route = { action };
    if (typeof obj.target === "string") r.target = obj.target;
    if (typeof obj.knob === "string") r.knob = obj.knob;
    if (typeof obj.value === "number" || typeof obj.value === "string" || typeof obj.value === "boolean") {
      r.value = obj.value as KnobValue;
    }
    if (typeof obj.answer === "string") r.answer = obj.answer;
    if (typeof obj.mood === "string") r.mood = obj.mood.slice(0, 60);
    if (typeof obj.order === "string" && (CREATURE_ORDERS as readonly string[]).includes(obj.order)) r.order = obj.order as CreatureOrder;
    const visual = parseVisual(obj.visual);
    if (visual) r.visual = visual;
    const shape = parseShape(obj.shape);
    if (shape) r.shape = shape;
    return r;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Orders: "chickens, follow me", "dragon stay", "everyone come here", "tell the dog to sit".

const ORDER_PHRASES: [CreatureOrder, RegExp][] = [
  ["follow", /^(?:follow me|come with me|stick with me|tag along|heel|keep up)$/],
  ["come", /^(?:come here|come to me|come back|come over here|over here|get over here)$/],
  ["stay", /^(?:stay|stay here|stay there|stay put|sit|sit down|wait|wait here|wait there|hold still|freeze|halt|don'?t move)$/],
  ["flee", /^(?:go away|run away|scatter|shoo|back off|flee|get lost)$/],
  ["free", /^(?:as you were|carry on|go free|be free|you'?re free|dismissed|at ease|do your thing|stop following(?: me)?|you can go)$/],
];
const EVERYONE = /^(?:everyone|everybody|all|all of you|you all|y'?all|guys|everything|every creature|all creatures)$/;
const PRONOUN_WHO = /^(?:it|them|they|you|he|she|him|her|that|those|these|that one|this one)$/;
/** Words that make it a permanent behaviour, which is a build, not an order. */
const STANDING = /\b(?:always|forever|whenever|when|if|every|that|who|which|a|an|some|new)\b/;

export interface OrderAsk { order: CreatureOrder; who: string }

/** The order a command gives, and who it is addressed to ("" when nobody is named), or null. */
export function parseOrder(command: string): OrderAsk | null {
  let c = command.toLowerCase().replace(/[.!?]+/g, " ").replace(/\s+/g, " ").trim();
  c = c.replace(/^(?:hey|ok|okay|yo|oi)\b[ ,]*/, "").replace(/^please\s+/, "").replace(/\s+please$/, "").trim();
  if (c.split(" ").length > 9) return null;
  for (const [order, phrase] of ORDER_PHRASES) {
    // Try every split point: the tail must be the whole order phrase.
    const words = c.split(" ");
    for (let i = 0; i < words.length; i++) {
      const tail = words.slice(i).join(" ").replace(/^,\s*/, "");
      if (!phrase.test(tail)) continue;
      let who = words.slice(0, i).join(" ").replace(/,/g, " ").replace(/\s+/g, " ").trim();
      const told = /^(?:make|tell|have|let|get|ask)\b/.test(who);
      who = who.replace(/^(?:make|tell|have|let|get|ask)\s*/, "").replace(/\s+to$/, "").trim();
      if (STANDING.test(who.replace(/^(?:all\s+)?(?:the|my|our|your|that|this|those|these)\s+/, ""))) return null;
      if (who === "me" || who === "us") return null;
      // "make it stay" is fine; "make stay" is not a sentence.
      if (told && !who) return null;
      if (who.split(" ").length > 4) return null;
      return { order, who };
    }
  }
  return null;
}

/**
 * The mod an order is for: a named thing ("the chickens") must match a loaded mod's id, title or
 * spawned types; nobody named or a pronoun means the thing touched last; "everyone" means "*".
 * Null when a named thing matches nothing, so the router can still read the command.
 */
export function orderTarget(who: string, mods: ReadonlyMap<string, RouteMod>, recent: Recent): string | null {
  const w = who.replace(/^(?:all\s+)?(?:the|my|our|your|that|this|those|these)\s+/, "").trim();
  if (EVERYONE.test(w)) return "*";
  if (!w || PRONOUN_WHO.test(w)) {
    const last = recent.touched.find((id) => mods.has(id));
    return last ?? "*";
  }
  const stem = stemOf(w.split(" ").at(-1)!);
  if (stem.length < 2) return null;
  const hit = (s: string) => s.toLowerCase().split(/[^a-z]+/).some((part) => part === stem || stemOf(part) === stem);
  for (const m of [...mods.values()].reverse()) {
    if (hit(m.id) || hit(m.title) || (m.types ?? []).some(hit)) return m.id;
  }
  return null;
}

/** An order route for this command, answered with no model call, or null. */
export function orderRoute(ctx: RouteCtx): Route | null {
  if (detectMoodCommand(ctx.command)) return null;
  const ask = parseOrder(ctx.command);
  if (!ask) return null;
  const target = orderTarget(ask.who, ctx.world ?? ctx.mods, ctx.recent);
  return target ? { action: "order", target, order: ask.order } : null;
}

// ---------------------------------------------------------------------------------------------
// The rules, in order. Each returns the route it leaves (possibly unchanged).

type Rule = (route: Route | null, ctx: RouteCtx, note: (s: string) => void) => Route | null;

const RULES: [string, Rule][] = [
  ["force-edit", (r, ctx) => (ctx.forceEditModId && ctx.mods.has(ctx.forceEditModId)
    ? { ...(r ?? { action: "edit" }), action: "edit", target: ctx.forceEditModId } : r)],
  // A build-shaped command never dead-ends on a router miss.
  ["build-fallback", (r, ctx, note) => {
    if (r || !BUILD_VERB.test(ctx.command.trim())) return r;
    note("fallback to new");
    return { action: "new" };
  }],
  // A whole-world mood phrase Spark routed as a build is still a mood (ADR 0017).
  ["mood", (r, ctx, note) => {
    const word = detectMoodCommand(ctx.command);
    if (!word || (r && !["new", "edit", "question"].includes(r.action))) return r;
    note(`mood ${word}`);
    return { action: "mood", mood: word };
  }],
  // Player abilities are always new standalone mods hooking api.player(), never an NPC edit.
  ["player-ability", (r, ctx, note) => {
    if (!isPlayerAbilityCommand(ctx.command) || (r && r.action !== "edit" && r.action !== "tweak")) return r;
    note("player ability -> new");
    return { action: "new" };
  }],
  // An order Spark recognised, checked against what is loaded; one that names nothing loaded is a question.
  ["order-check", (r, ctx, note) => {
    if (r?.action !== "order") return r;
    const local = orderRoute(ctx);
    if (local) return local;
    const target = r.target && (r.target === "*" || (ctx.world ?? ctx.mods).has(r.target)) ? r.target : undefined;
    if (r.order && target) return { action: "order", target, order: r.order };
    note("order with no creature -> question");
    return { action: "question", answer: "Nothing here can take that order yet. Add a creature first!" };
  }],
  // Pronoun commands ("make it bigger") act on the mod touched last, not on a fresh build.
  ["pronoun-edit", (r, ctx, note) => {
    const id = resolvePronoun(ctx.command, ctx.recent);
    if (!r || r.action !== "new" || !id || !ctx.mods.has(id)) return r;
    note(`pronoun -> edit ${id}`);
    return { action: "edit", target: id };
  }],
  // "add/make/create ..." is always a build, never a tweak or a question.
  ["build-verb", (r, ctx, note) => {
    if (!r || !STRICT_BUILD_VERB.test(ctx.command.trim())) return r;
    if (["new", "edit", "undo", "mood", "order"].includes(r.action)) return r;
    if (resolvePronoun(ctx.command, ctx.recent) && r.action === "tweak") return r;
    note(`coerced ${r.action} -> new`);
    return { action: "new" };
  }],
  // Pronoun memory (ADR 0016): "it"/"them" with no target means the mod touched last.
  ["pronoun-target", (r, ctx) => {
    if (!r || !["tweak", "edit", "undo"].includes(r.action) || (r.target && ctx.mods.has(r.target))) return r;
    const id = resolvePronoun(ctx.command, ctx.recent);
    return id && (ctx.mods.has(id) || r.action === "tweak") ? { ...r, target: id } : r;
  }],
  // Relative knob asks ("make them faster", "more chickens") are instant tweaks whatever the router said (ADR 0058).
  ["relative-tweak", (r, ctx, note) => {
    if (!r || !["edit", "tweak", "new"].includes(r.action)) return r;
    const ask = parseRelativeAsk(ctx.command);
    if (!ask) return r;
    const pronounId = resolvePronoun(ctx.command, ctx.recent);
    // A pronoun ask ("make them faster") is about the mod touched last, even when the router
    // aimed it at the player: "them/they/those" never means the player (bug cps). "me/my/I" is
    // not a pronoun ask, so it still lands on the player. The router's own target stays as the
    // second choice, so "make them jump higher" on a mod with no jump knob still moves the player.
    const byPronoun = pronounAskMeansRecent(ctx.command, ask)
      && (!r.target || r.target === "player")
      && !!pronounId && ctx.mods.has(pronounId);
    // A NAMED thing ("make the slimes faster") that matches a loaded mod outranks a router target of
    // the player, the same way a pronoun does (bead 1e6). "me/my character" names no mod, so it stays.
    const named = ask.noun && !byPronoun && (!r.target || r.target === "player") ? orderTarget(ask.noun, ctx.mods, ctx.recent) : null;
    const nounId = named && named !== "*" && named !== "player" && ctx.mods.has(named) ? named : undefined;
    if (nounId) {
      const rec = ctx.mods.get(nounId)!;
      const rel = relativeTweak(ctx.command, rec.knobs, `${rec.id} ${rec.title}`, true);
      if (rel) {
        note(`relative ${r.action} -> tweak ${nounId}.${rel.knob}=${rel.value} (named ${ask.noun}, not the router's player)`);
        return { action: "tweak", target: nounId, knob: rel.knob, value: rel.value };
      }
      // No knob for the ask (or already at its limit): a rewrite of the NAMED mod, never of the player.
      note(`named ${ask.noun} -> edit ${nounId}`);
      return { action: "edit", target: nounId };
    }
    const tid = (byPronoun ? pronounId : undefined)
      ?? (r.target && ctx.mods.has(r.target) ? r.target : undefined)
      ?? (isPlayerCommand(ctx.command) && ctx.mods.has("player") ? "player" : undefined)
      ?? pronounId;
    const ids = byPronoun ? [pronounId, tid, "player"] : [tid];
    const trusted = [...new Set(ids.filter((id): id is string => !!id && ctx.mods.has(id)))];
    const chosen = trusted.length > 0;
    const candidates = chosen ? trusted.map((id) => ctx.mods.get(id)!) : ask.noun ? [...ctx.mods.values()] : [];
    for (const rec of candidates) {
      const rel = relativeTweak(ctx.command, rec.knobs, `${rec.id} ${rec.title}`, chosen);
      if (!rel) continue;
      note(`relative ${r.action} -> tweak ${rec.id}.${rel.knob}=${rel.value}${byPronoun && rec.id === pronounId ? " (pronoun, not the router's player)" : ""}`);
      return { action: "tweak", target: rec.id, knob: rel.knob, value: rel.value };
    }
    return r;
  }],
];

/** Apply every rule in order to Spark's route. `rules` names each rule that changed something, with why. */
export function resolveRoute(raw: Route | null, ctx: RouteCtx): Resolved {
  const rules: string[] = [];
  let route = raw;
  for (const [name, rule] of RULES) {
    let why = "";
    const next = rule(route, ctx, (s) => { why = s; });
    if (next !== route) rules.push(why ? `${name}: ${why}` : name);
    route = next;
  }
  return { route, rules };
}
