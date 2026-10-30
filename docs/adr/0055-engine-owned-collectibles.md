# 0055: The engine owns collectibles; a mod only tags `data.collectible`

- **Status:** Draft
- **Date:** 2026-10-29
- **Context:** After ADR 0053 a dropped coin fell and settled, but it was still dead weight:
  every mod that wanted pickups had to hand-roll the contact test (a raw AABB test failed
  until it was replaced with `api.touches`), the despawn, the particle burst, and its own
  counter. The same world therefore grew several score widgets that each counted part of
  the truth, and one mod could spend a whole build cycle getting "coins you can collect"
  wrong. Pickup is a law of nature, not a mod's job: the engine already owns physics,
  collision, reach and the HUD.
- **Decision:**
  1. A mod **tags** and nothing else: any entity whose `data.collectible` is truthy is a
     pickup. `true` is worth `data.value` (default 1), a number is that many points, and a
     string is the HUD id to count into (`data.collectibleHud` does the same for the
     boolean/number form). Values are finite, positive and capped at 1000; a malformed tag
     falls back to 1 point rather than corrupting the widget.
  2. Every tick, after physics, the engine collects the tagged entities inside the player's
     pickup reach (`reach.ts`, ADR 0039): it bursts them, despawns them and adds the value
     to **one** shared stat HUD (`score` unless the tag names another id) that the engine
     owns (`owner: "engine"`), so undo cannot delete the banked total. The engine keeps the
     running total in `world.collected`; if a mod reuses a counter id and is undone, the
     widget comes back with the engine's total on the next tick.
  3. No double counting: mod tick handlers run before physics in `World.step`, so a mod that
     still collects by hand has already despawned its drop when the engine looks. A mod that
     keeps the entity around can set `data.collected = true` to opt an instance out.
  4. The logic lives in `src/sim/collect.ts`; `World.step` gets one call. The client's
     existing coin observer (`feel.ts`) treats a tagged pickup like a coin, so an
     engine-collected pickup still pops and plays the coin sound with no new sound API.
  5. The Wonder prompt's DROPPED PICKUPS section now asks for the tag and one new
     ENGINE-OWNED PICKUPS section says the engine, not the mod, does the collecting.
- **Consequences:**
  - A mod that only drops and tags is now correct: "a cat that drops coins you can collect"
    needs no contact code, no despawn loop and no counter.
  - One world shows one score no matter how many mods feed it; two mods that tag the same
    HUD id share it by construction.
  - A mod that writes `setHud("score", ...)` itself while also tagging pickups will have its
    value overwritten on each collect: the tag owns the id. Mods that collect fully by hand
    and never tag are untouched (the built-in `coins` mod is one).
  - Banked pickups outlive the mod that dropped them until the world is rebuilt; the score
    is the engine's state, like the ground.
  - `data.collectible` is plain spawn data: no contract type, no wire change, no new API
    surface. Only a comment in `contract.ts` documents it.
- **Alternatives considered:** Keep teaching mods the hand-rolled loop (the bug returns the
  first time Wonder writes a raw box test). A `api.collect(...)` helper mods must call (still
  per-mod code, still per-mod counters, and a forgotten call silently breaks the pickup).
  Nested `data.collectible: { value, hud }` objects (the wire `data` map is flat numbers,
  strings and booleans; widening it would ripple through every consumer for no gain).
