# ADR 0011: Combat targeting and health

- **Status:** Accepted (owner, 2026-10-29)
- **Date:** 2026-10-28

## Context

Everything used to chase the player, so any spawned creature immediately became a threat regardless of what the user asked for. A greedy client matcher also swallowed creative commands — "add a superhero to fight that enemy" loaded patrol walkers instead of building the superhero. And nothing could be destroyed: entities had no health lifecycle, so combat could be requested but never resolved.

## Decision

1. Targeting is opt-in by command intent: the default is wander/idle. Hostiles (`data.hostile`) hunt the player only when asked; heroes (`data.hero`) fight hostiles, never the player.
2. Every entity defaults to 100 health; `api.damage` destroys at 0 with a burst, and health bars show when damaged.
3. Simple commands route to hand-written built-in mods by EXACT match (client + server); everything else goes to Wonder.
4. Mods may only despawn their own entities; the entity cap evicts a spawner's own oldest entities before touching the level.

## Consequences

- Combat emerges from flags + damage without an engine combat system — mods compose `hostile`/`hero`, movement, and `api.damage` into fights.
- Wonder's prompt carries the targeting rules, so behavior varies per write; the same command can produce different combat code each time.
- Health and destruction are uniform: anything can be damaged, and health bars make damage visible without per-mod UI.
- Exact-match routing keeps simple commands instant and predictable, at the cost of creative phrasings falling through to Wonder's slower path.
- Player death is now possible, so the client needs the auto-respawn (loader still has the player mod, no player entity for ~90 ticks → reload it once) to avoid a dead world.

## Alternatives considered

- **Engine-level faction/combat system:** heavier, and mods couldn't improvise beyond the factions and rules the engine shipped.
- **All-chase default (the old chaos):** every creature hunted the player whether asked or not, making peaceful or heroic spawns impossible.
