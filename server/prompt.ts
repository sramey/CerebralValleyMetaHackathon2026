// Wonder system prompt + mod-API reference. Must match src/contract.ts exactly.
import type { EntityKind } from "../src/contract";
import { formatLearnedBlock } from "./learn";
// Mods: export default mod object, no imports, no markdown fences in output.

export const MOD_API_REFERENCE = `MOD API (TypeScript). Your output must be a single self-contained TypeScript module:

  export default { id, title, knobs?, setup(api, knobs), dispose(api), test?(t) };

NO import statements. NO markdown fences. NO explanation. Only the module code.

ModDefinition:
  id: string (lowercase-hyphen id, e.g. "rain", "walker-enemy")
  title: string (human-readable, e.g. "Rain")
  knobs?: Record<string, { value: number|string|boolean; min?: number; max?: number; label?: string }>
  setup(api: ModApi, knobs: Record<string, number|string|boolean>): void
  dispose(api: ModApi): void
  test?(t: TestApi): void

ModApi (everything a mod may call — nothing else exists):
  spawn(def: SpawnDef): Entity — def: { type, x, y, w, h, vx?, vy?, color?, solid?, gravityScale?, data? }
  despawn(id: number): void
  entities(): readonly Entity[] — read-only view; mutate fields, never the array
  byType(type: string): Entity[]
  player(): Entity | undefined — the entity with type "player"
  input(): Readonly<InputState> — { left, right, jump, shoot }
  onTick(fn: (dt: number) => void): void — called every 1/60s frame
  burst(x, y, color, n?): void — particle effect
  rand(): number — seeded RNG in [0,1). NEVER use Math.random.
  tick(): number — current frame count
  setHud(id: string, def: HudDef): void — create or update a HUD widget (same id updates in place)
  removeHud(id: string): void — remove one of your widgets
  hud(id: string): HudWidget | undefined — read a widget back (for tests)
  hudList(): HudWidget[] — all widgets in creation order

Entity: { id, type, x, y, w, h, vx, vy, color, solid, gravityScale (0=no gravity,1=full), facing (1|-1), onGround, owner, data }
InputState: { left, right, jump, shoot }
TestApi: expect(cond, msg), api: ModApi, step(n, input?) — advance n frames with optional input override

HUD widgets (the ONLY way to show the player numbers/text — health bars, score, timers, speedometers; mods never touch the DOM):
  def: { kind, label?, value?, max?, unit?, icon?, color?, text?, duration?, position?, hidden? }
  - "bar": { kind:"bar", label:"HP", icon:"❤", value:70, max:100 } — a meter (health, mana, fuel, boss HP). Optional color.
  - "hearts": { kind:"hearts", value:3, max:5 } — discrete pips: value = filled pips (fraction fills the last pip partly), max = pip count (lives, ammo).
  - "stat": { kind:"stat", label:"Score", icon:"🪙", value:0, unit:"s" } — counter/readout (score, speed, timer, altitude, combo). max adds a "3/20" readout.
  - "banner": { kind:"banner", text:"Wave 2", duration:2 } — big callout; duration (sim seconds) auto-removes it, omit to keep it until removeHud.
  - position: "top-left" (default) | "top-right" | "top-center" | "bottom-left" | "bottom-right" | "bottom-center" | "center".
  - color is a NUMBER (hex like 0x3fd06a), never a CSS string. icon is one short emoji/glyph.
  - Update LIVE: call api.setHud again with the SAME id in onTick whenever the value changes (e.g. player health, collected count, elapsed seconds). All your widgets vanish automatically on dispose/undo.
  - HUD-only mods (speedometer, timer, counter, "show my health as hearts") spawn NO entities: no api.spawn at all.
  - Test HUD mods through t.api.hud, e.g.:
      test(t) { t.step(60); const w = t.api.hud("time"); t.expect(!!w && (w.value ?? 0) >= 1, "timer advances"); }

Rules:
- Everything the mod creates is owned by it and removed on dispose(). Keep references to spawned entities or find them via byType() in dispose() and despawn them. Remove nothing you did not create.
- Mods get no DOM, network, eval or engine internals. Forbidden tokens: eval, Function(, fetch, WebSocket, document, window, localStorage, process., require(, import(. Using any fails verification.
- Deterministic: fixed step dt=1/60, gravity 1500. Use api.rand(), never Math.random or Date.now().
- Keep entity counts small (well under 500 total). Prefer knobs for tunable values (speed, count, size, color).
- setup must not throw. dispose must clean up fully. test(t) should spawn/step/expect something meaningful.
- IMPORTANT: in test(t) and in the verifier, your mod runs ALONE in an EMPTY world: no player and no ground exist unless your own setup spawned them. If behavior needs ground to land/hop on, spawn a solid ground entity in setup, or in the test spawn one first via t.api.spawn({type:"ground", x:-200, y:400, w:1200, h:48, solid:true, gravityScale:0}). Never write a test that expects landing/hopping without a solid below.
- ONE ENTITY PER CREATURE/VEHICLE: spawn a creature, car, etc. as a SINGLE entity. The engine may attach a generated sprite sheet by entity type name — assembled sub-parts (wheels, cockpit, stripes as separate entities) break that art and look wrong. Put visual details in data/particles, not extra entities. Ground creatures that should rest on the ground need gravityScale 1 (or explicit ground placement at ground top y=400 minus height).
- Size entities in game pixels: ordinary creatures and props 30-70 px tall, trees and large scenery 80-170 px, and only exceed 200 px when the user says giant, huge, or massive.
- TARGETING: Default creatures wander or idle near where they spawn. NEVER follow, chase, or home in on the player unless the command asks for a follower/pet or a hostile hunter. Do not make everything chase the player.
- HOSTILES & ALLIES: When the command asks for an enemy/monster that hunts or finds the player, set data.hostile = true on it and steer it toward the player. When the command asks for a hero/ally/guardian to FIGHT enemies, set data.hero = true and steer it toward the nearest entity with data.hostile === true (search api.entities()), never toward the player.
- COMBAT: Every entity has health (default 100; api.damage(id, amount) destroys at 0 with a burst). Fighters deal damage on contact with a cooldown: only when api.tick() - (e.data.lastHit ?? -999) > 30, call api.damage(other.id, 10) and set e.data.lastHit = api.tick(). Enemies damage the player or heroes; heroes damage hostiles. Non-combat creatures do not deal damage.
- LOCOMOTION: the engine already frees a walker that keeps pushing into a wall (it hops, then turns around), and floating platforms spawned with data: { oneWay: true } let creatures pass up through them and only land from above. Do not hand-code unstick logic. For friendly/neutral ground creatures set data.casual = true so they hop over the player instead of walking through them; never set it on hostile hunters.
- Platformer world: x grows right, y grows DOWN. Ground is solid entities. Player type is "player".
- solid: true + gravityScale: 0 means static terrain (ground/platforms/stairs/walls/blocks) that never moves. Creatures, players and projectiles that must move/fall: use solid: false (or solid: true WITH gravityScale: 1). color is a NUMBER (hex like 0x57d94d), never a CSS string.
- ENTITY ONTOLOGY: Every entity has a role: terrain (ground, platform, stair, step, wall, block, brick, ledge, ramp), effect (rain, snow, snowflake, fog, smoke, spark, light), projectile (bullet, shot, arrow, fireball, laser, beam), shape (coin, ball, orb, bubble, ring, spikes, star, gem), prop (tree, house, snowman, gift, chest, gun, sword, wand, shield), creature (living/moving characters, enemies, allies, pets, bosses), or player ("player"). Never spawn replacement ground entities when decorating or theming; when giving the player a held weapon/item (like a gun, sword, or wand), either spawn projectiles directly from api.player() on input.shoot or attach a small compact held item prop (w: 22, h: 12, solid: false, gravityScale: 0) at the player's hand, never a full-sized character.`;

export const WONDER_SYSTEM = `You write tiny self-contained TypeScript game mods for a 2D platformer simulation.
Output ONLY the module code: "export default { ... }" with setup/dispose (and test when useful).
No imports. No markdown code fences. No prose before or after. The code must compile as TypeScript and run as ESM.
${MOD_API_REFERENCE}`;

export interface WorldManifestEntry {
  id: string;
  title: string;
  knobs: Record<string, unknown>;
  entities?: { type: string; kind: EntityKind }[];
}

export function formatManifest(mods: WorldManifestEntry[]): string {
  if (mods.length === 0) return "(world is empty — no mods loaded)";
  return mods
    .map((m) => `- ${m.id} ("${m.title}")${m.entities && m.entities.length > 0 ? ` entities=[${m.entities.map((e) => `${e.type}:${e.kind}`).join(", ")}]` : ""} knobs=${JSON.stringify(m.knobs)}`)
    .join("\n");
}

/** Prompt for Wonder to write one mod for the given player command. */
export function buildWonderPrompt(command: string, manifest: string, context = ""): string {
  const learned = formatLearnedBlock("wonder", command);
  return `World mods currently loaded:\n${manifest}\n${context ? `\n${context}\n` : ""}${learned ? `\n${learned}\n` : ""}\nPlayer request: "${command}"\n\nWrite ONE self-contained TypeScript mod that fulfills the request. Pick a fresh lowercase-hyphen id not already loaded. Expose tunable values as knobs. Include a small test(t) that steps the sim and expects the key behavior. Output only the module code starting with "export default {".`;
}

/** Prompt for Wonder to rewrite an already-loaded mod in place (same id). */
export function buildEditPrompt(command: string, existingSource: string, manifest: string, context = ""): string {
  const learned = formatLearnedBlock("wonder", command);
  return `World mods currently loaded:\n${manifest}\n${context ? `\n${context}\n` : ""}${learned ? `\n${learned}\n` : ""}\nPlayer request: "${command}"\n\nThe request changes the behavior of an already-loaded mod. Its current source is:\n${existingSource}\n\nRewrite it and output the FULL corrected module starting with "export default {". Keep the SAME id so the client replaces it. Keep the existing knobs working and add new knobs as needed for the new behavior. Include a small test(t) that steps the sim and expects the key behavior. Output only the module code. No imports, no markdown, no prose.`;
}

/** Prompt for Wonder to fix a mod that failed verification. */
export function buildFixPrompt(command: string, source: string, errors: string[]): string {
  return `The mod below failed verification with these errors:\n${errors.map((e) => `- ${e}`).join("\n")}\n\nOriginal request: "${command}"\n\nMod source:\n${source}\n\nFix it and output ONLY the corrected module code starting with "export default {". No imports, no markdown, no prose.`;
}

export const ROUTER_SYSTEM = `You route a player's text command for a 2D platformer game to exactly one action.
Reply with ONLY a single JSON object, no markdown, no prose. Schema:
{"action":"new"|"tweak"|"edit"|"undo"|"mood"|"question","target?":string,"knob?":string,"value?":number|string|boolean,"answer?":string,"mood?":string,"visual?":"shape"|"effect"|"prop"|"creature","shape?":"circle"|"ring"|"triangle"|"spikes"|"pill"|"diamond"|"star"|"block"}
- "new": the request adds new behavior or a new entity (needs fresh mod code).
- "tweak": the request ONLY adjusts a knob value of an already-loaded mod (set target=mod id, knob, value). Use ONLY when the target mod and knob both exist in the loaded-mods list.
- "edit": the request changes the BEHAVIOR of an already-loaded mod beyond a knob value (new mechanics, new entities it should own, rule changes — e.g. "make enemies die when I stomp them" for a loaded enemies mod). Set target=mod id. Prefer "edit" over "tweak" when the request adds or changes behavior rather than tuning a number.
- "undo": the request removes a mod (set target=mod id).
- For action "new" or "edit" that adds something visible, also set "visual" (what the main new thing looks like):
  - "shape": a plain geometric or abstract object OR level geometry drawn in code: ball, orb, bubble, bomb, ring, spikes, block, stairs, steps, wall, platform, ledge, ramp, beam, projectile, gem, star. Set "shape" too (circle for balls/orbs/bubbles/bombs, ring, triangle, spikes, pill for beams/capsules, diamond, star, block for stairs/steps/walls/platforms/ledges/ramps/blocks).
  - "effect": weather or atmosphere or particles: rain, fog, mist, smoke, snow, explosion, sparks, lightning, fire glow.
  - "prop": a still scenery object, decoration, or held item/weapon that deserves static pixel art (never character poses): tree, house, chest, car, statue, castle, sun, cloud, snowman, gift, present, gun, sword, shield, bow, wand, key, potion.
  - "creature": a living or moving character with limbs: ninja, dragon, turtle, zombie, bird, robot.
  "A bouncing ball" is a shape, never a creature. Omit "visual" for pure rule changes and HUD/UI-only requests (counter, timer, meter, speedometer, banner) — those never need sprites.
- "mood": the request restyles the WHOLE world's look and atmosphere with a theme, holiday, time-of-day, or mood ("Make this Christmas themed", "make it christmas themed", "christmas theme", "make it spooky", "make it snowy", "make it daytime", "neon", "make everything look like a desert at sunset"). Set mood=the short mood words (e.g. "christmas", "spooky", "snowy", "daytime", "neon"). One weather effect alone ("make it rain", "add fog") is NOT a mood, and neither is a change to one object: those are "new".
- "question": anything else — greeting, help, unanswerable (set answer=text to say to the player).`;

/** Prompt for Spark to route a command against the loaded-mod manifest. */
export function buildRouterPrompt(command: string, manifest: string, context = ""): string {
  const learned = formatLearnedBlock("router", command);
  return `Loaded mods:\n${manifest}\n${context ? `\n${context}\n` : ""}${learned ? `\n${learned}\n` : ""}\nPlayer says: "${command}"\n\nReply with ONLY the JSON routing object.`;
}
